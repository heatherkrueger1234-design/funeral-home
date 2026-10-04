import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  describeAccount,
  describeContract,
  formatDate,
  formatDay,
  formatMoney,
  isForbidden,
  isNotFound,
  isUnauthorized,
  toCents,
  toDollars,
  worthRetrying,
} from "./api";

describe("what a failed request means", () => {
  it("counts only a 401 from the API as signed out", () => {
    expect(isUnauthorized(new ApiError(401, "Please sign in."))).toBe(true);
    expect(isUnauthorized(new ApiError(403, "Not yours."))).toBe(false);
    expect(isUnauthorized(new ApiError(0, "Offline."))).toBe(false);
    expect(isUnauthorized(new Error("boom"))).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
  });

  it("tells a refusal and a missing page apart from everything else", () => {
    expect(isForbidden(new ApiError(403, "Not yours."))).toBe(true);
    expect(isForbidden(new ApiError(401, "Please sign in."))).toBe(false);
    expect(isNotFound(new ApiError(404, "No such home."))).toBe(true);
    expect(isNotFound(new ApiError(500, "Broken."))).toBe(false);
    expect(isForbidden(null)).toBe(false);
    expect(isNotFound(undefined)).toBe(false);
  });

  it("asks once more after a failure, but never after a 401 or a 403", () => {
    expect(worthRetrying(0, new ApiError(500, "Broken."))).toBe(true);
    expect(worthRetrying(0, new ApiError(0, "Offline."))).toBe(true);
    expect(worthRetrying(1, new ApiError(500, "Broken."))).toBe(false);
    expect(worthRetrying(0, new ApiError(401, "Please sign in."))).toBe(false);
    expect(worthRetrying(0, new ApiError(403, "Not yours."))).toBe(false);
  });
});

/**
 * The wrapper every screen talks through. `fetch` is the boundary, so it is
 * the one thing replaced: what comes back is a real `Response`, read the way
 * a browser would read it.
 */
describe("talking to the API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answer(status: number, body: string | null = null) {
    const fetch = vi.fn(async () => new Response(body, { status }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  async function refusal(request: Promise<unknown>): Promise<ApiError> {
    const error = await request.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }

  it("sends the session cookie every time, and JSON only with something to send", async () => {
    // The session is an httpOnly cookie, so it only travels when asked for.
    const fetch = answer(200, "{}");
    await api.get("/admin/homes?limit=25");
    await api.post("/auth/logout");

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/admin/homes?limit=25", {
      method: "GET",
      credentials: "include",
      headers: {},
      body: undefined,
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  });

  it("keeps a 401's status, so the gate can tell signed out from broken", async () => {
    answer(401, '{"error":"Please sign in."}');
    const error = await refusal(api.get("/auth/me"));
    expect(error.status).toBe(401);
    expect(isUnauthorized(error)).toBe(true);
  });

  it("says in words that the server could not be reached, and never that the session ended", async () => {
    // The browser's own words are "Failed to fetch", which is what every
    // error card on the page used to say when the wifi dropped.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const error = await refusal(api.get("/auth/me"));
    expect(error.status).toBe(0);
    expect(error.message).toBe(
      "The server could not be reached. Please check your connection and try again.",
    );
    expect(isUnauthorized(error)).toBe(false);
  });

  it("never puts a server error's own words on the screen", async () => {
    answer(500, '{"error":"relation \\"funeral_homes\\" does not exist"}');
    const error = await refusal(api.get("/admin/overview"));
    expect(error.status).toBe(500);
    expect(error.message).toBe(
      "Something went wrong on our side. Please try again in a moment.",
    );
  });

  it("reads a proxy's HTML error page as a failure, not as broken JSON", async () => {
    // A deploy in progress answers with nginx's page, not the API's JSON;
    // parsing it threw "Unexpected token '<'" into the middle of the screen.
    answer(502, "<html><body><h1>502 Bad Gateway</h1></body></html>");
    const error = await refusal(api.get("/admin/homes"));
    expect(error.status).toBe(502);
    expect(error.message).toBe(
      "Something went wrong on our side. Please try again in a moment.",
    );
  });

  it("passes on a refusal written for a person, and rewords the ones written for a log", async () => {
    answer(409, '{"error":"That address already has access."}');
    expect((await refusal(api.post("/admin/admins", {}))).message).toBe(
      "That address already has access.",
    );

    for (const logWords of ["Invalid request body", "Invalid query parameters"]) {
      answer(400, JSON.stringify({ error: logWords }));
      expect((await refusal(api.put("/admin/homes/4/crm", {}))).message).toBe(
        "Something in that could not be saved as written. Please check each field and try again.",
      );
    }
  });
});

describe("money", () => {
  it("writes whole dollars without cents, and cents only when there are some", () => {
    expect(formatMoney(4900)).toBe("$49");
    expect(formatMoney(115_000)).toBe("$1,150");
    expect(formatMoney(1999)).toBe("$19.99");
    expect(formatMoney(1250)).toBe("$12.50");
    expect(formatMoney(0)).toBe("$0");
    // Profit, in a month where the platform cost more than it brought in.
    expect(formatMoney(-1250)).toBe("-$12.50");
    expect(formatMoney(null)).toBe("—");
  });

  it("reads typed dollars as cents without losing one to binary arithmetic", () => {
    expect(toCents("19.99")).toBe(1999);
    expect(toCents("0.29")).toBe(29);
    expect(toCents("49")).toBe(4900);
    expect(toCents("479.88")).toBe(47988);
  });

  it("gives back every amount unchanged when a form is opened and saved", () => {
    // Every price up to $1,000, and a few large ones: an edit that does not
    // touch the amount must not move it by a cent.
    const moved: number[] = [];
    for (let cents = 0; cents <= 100_000; cents += 1) {
      if (toCents(toDollars(cents)) !== cents) moved.push(cents);
    }
    for (const cents of [1_000_001, 9_999_999, 100_000_000]) {
      if (toCents(toDollars(cents)) !== cents) moved.push(cents);
    }
    expect(moved).toEqual([]);
  });
});

/**
 * Dates, read on a Denver clock (see vitest.config.ts). The two helpers are
 * for two different things, and the evening is where they disagree.
 */
describe("dates", () => {
  it("keeps a calendar date on its own day, though midnight UTC is the evening before here", () => {
    expect(formatDate("2027-06-30")).toBe("June 30, 2027");
    expect(formatDate("2026-10-01T00:00:00.000Z")).toBe("October 1, 2026");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("soon")).toBe("soon");
  });

  it("gives the reader's day for an instant, not Greenwich's", () => {
    // A trial that ends at nine in the evening in Denver on 30 September.
    expect(formatDay("2026-10-01T03:00:00.000Z")).toBe("September 30, 2026");
    expect(formatDay(null)).toBe("—");
  });

  it("dates a group's trial and renewal by the reader's day, not the next morning in Greenwich", () => {
    // Both are moments: a trial set up at nine in the evening ends at nine in
    // the evening, and Stripe's period ends when it ends.
    expect(
      describeContract({
        subscriptionStatus: "trial",
        trialEndsAt: "2026-10-01T03:00:00.000Z",
        currentPeriodEndsAt: null,
      }),
    ).toBe("On trial until September 30, 2026");
    expect(
      describeContract({
        subscriptionStatus: "active",
        trialEndsAt: null,
        currentPeriodEndsAt: "2026-11-04T02:00:00.000Z",
      }),
    ).toBe("Subscribed, renews November 3, 2026");
  });
});

describe("how an account is doing, in words", () => {
  const home = (
    subscriptionStatus: string,
    trialDaysLeft: number | null = null,
    suspendedAt: string | null = null,
  ) => ({ subscriptionStatus, trialDaysLeft, suspendedAt });

  it("puts a suspension first, whatever the subscription says", () => {
    expect(describeAccount(home("active", null, "2026-09-01T12:00:00Z"))).toBe(
      "Suspended",
    );
  });

  it("counts a trial's days, says when it has finished, and names every other state", () => {
    expect(describeAccount(home("trial", 3))).toBe("On trial, 3 days left");
    expect(describeAccount(home("trial", 1))).toBe("On trial, 1 day left");
    expect(describeAccount(home("trial", 0))).toBe("Trial finished");
    expect(describeAccount(home("trial", null))).toBe("On trial");
    expect(describeAccount(home("active"))).toBe("Subscribed");
    expect(describeAccount(home("past_due"))).toBe("Payment outstanding");
    expect(describeAccount(home("canceled"))).toBe("Subscription ended");
  });
});
