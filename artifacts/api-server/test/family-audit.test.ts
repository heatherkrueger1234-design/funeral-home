import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  aftercareEnrollmentsTable,
  caseServiceOffersTable,
  funeralHomesTable,
} from "@workspace/db";
import { readSignedId, signId } from "@workspace/db/crypto";
import {
  AFTERCARE_UNSUBSCRIBE_PURPOSE,
  aftercareUnsubscribeUrl,
} from "@workspace/mailer/aftercare";
import app from "../src/app";
import { logger } from "../src/lib/logger";
import {
  asFamily,
  createCase,
  inviteFamily,
  PNG_BYTES,
  signUpHome,
} from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Regressions from walking the family's side of the product end to end: the
 * texted link, the photo bin, choosing a service time, the aftercare consent
 * and the way out of it, and the public request form. Each one is something
 * a family could actually run into.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the family's link is a credential, and stays out of the log", () => {
  it("masks the token when the text is logged instead of sent", async () => {
    const warn = vi.spyOn(logger, "warn");
    const staff = await signUpHome();
    const row = await createCase(staff);
    const contact = await staff.agent
      .post(`/api/cases/${row.id}/contacts`)
      .send({ name: "Anne Hale", phone: "303-555-0142" })
      .expect(201);

    const sent = await staff.agent
      .post(`/api/contacts/${contact.body.id}/send-link`)
      .expect(200);

    // The director is still handed the working link to paste...
    const token = String(sent.body.link).split("/f/")[1]!;
    expect(token.length).toBeGreaterThan(20);

    // ...but nothing written to the log can open the case.
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("/f/REDACTED");
    expect(logged).not.toContain(token);
  });
});

describe("a family with a big photo bin is not locked out by its own pictures", () => {
  it("lets far more reads through than the write ceiling", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    // One page of thumbnails for a bin of 300 is 300 GETs. Under the old
    // single bucket the 241st and everything after it — including the
    // session — came back 429.
    for (let i = 0; i < 300; i += 1) {
      await asFamily(token).get("/api/family/deadlines").expect(200);
    }
    await asFamily(token).get("/api/family/session").expect(200);
  });

  it("still holds writes to the ceiling", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    let limited = 0;
    for (let i = 0; i < 245; i += 1) {
      const res = await asFamily(token)
        .post("/api/family/messages")
        .send({ body: `note ${i}` });
      if (res.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });
});

describe("choosing a service time", () => {
  async function offered(serviceAt: string | null) {
    const staff = await signUpHome();
    const row = await createCase(staff, serviceAt ? { serviceAt } : {});
    const { token } = await inviteFamily(staff, row.id);
    const offer = await staff.agent
      .post(`/api/cases/${row.id}/service-offers`)
      .send({ startsAt: new Date(Date.now() + 3 * DAY).toISOString() })
      .expect(201);
    return { staff, row, token, offerId: offer.body.id as number };
  }

  it("cannot move a service the home has already set", async () => {
    const booked = new Date(Date.now() + 5 * DAY).toISOString();
    const { staff, row, token, offerId } = await offered(booked);

    await asFamily(token)
      .post(`/api/family/service-offers/${offerId}/choose`)
      .expect(409);

    const detail = await staff.agent.get(`/api/cases/${row.id}`).expect(200);
    expect(new Date(detail.body.serviceAt).toISOString()).toBe(booked);
  });

  it("cannot pick a time that has already gone by", async () => {
    const { staff, row, token, offerId } = await offered(null);

    // The API refuses to create a past offer, so age this one in place, as
    // a list the director left up through the date would be.
    await db
      .update(caseServiceOffersTable)
      .set({ startsAt: new Date(Date.now() - DAY) })
      .where(eq(caseServiceOffersTable.id, offerId));

    await asFamily(token)
      .post(`/api/family/service-offers/${offerId}/choose`)
      .expect(409);

    const detail = await staff.agent.get(`/api/cases/${row.id}`).expect(200);
    expect(detail.body.serviceAt).toBeNull();
  });

  it("still takes an ordinary choice", async () => {
    const { token, offerId } = await offered(null);
    const res = await asFamily(token)
      .post(`/api/family/service-offers/${offerId}/choose`)
      .expect(200);
    expect(res.body.chosenOfferId).toBe(offerId);
  });
});

describe("aftercare consent needs somewhere to send to", () => {
  async function closedWith(contact: Record<string, unknown>) {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: new Date(Date.now() - 2 * DAY).toISOString(),
    });
    const { token } = await inviteFamily(staff, row.id, contact);
    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);
    return { staff, row, token };
  }

  it("refuses a yes from somebody with no email on file and none given", async () => {
    const { token } = await closedWith({ phone: "303-555-0142" });

    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true })
      .expect(400);

    const session = await asFamily(token).get("/api/family/session").expect(200);
    expect(session.body.aftercare.status).toBe("pending");
  });

  it("takes the address given with the yes", async () => {
    const { token } = await closedWith({ phone: "303-555-0142" });

    const res = await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true, email: "anne@example.com" })
      .expect(200);
    expect(res.body.status).toBe("active");
    expect(res.body.email).toBe("anne@example.com");
  });

  it("refuses an address that is not one", async () => {
    const { token } = await closedWith({ email: "anne@example.com" });

    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true, email: "anne at home" })
      .expect(400);
  });
});

describe("the unsubscribe link at the foot of a check-in", () => {
  async function enrolled() {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: new Date(Date.now() - 2 * DAY).toISOString(),
    });
    const { token } = await inviteFamily(staff, row.id, {
      email: "anne@example.com",
    });
    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);
    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true })
      .expect(200);

    const [enrolment] = await db
      .select()
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.caseId, row.id));
    return { staff, row, token, enrolment: enrolment! };
  }

  it("is built on the portal and carries a token for this enrolment", async () => {
    const previous = process.env["FAMILY_PORTAL_URL"];
    process.env["FAMILY_PORTAL_URL"] = "https://family.example.com/";
    try {
      const url = aftercareUnsubscribeUrl(42)!;
      expect(url.startsWith("https://family.example.com/stop?token=")).toBe(true);
      const token = decodeURIComponent(url.split("token=")[1]!);
      expect(readSignedId(AFTERCARE_UNSUBSCRIBE_PURPOSE, token)).toBe(42);
    } finally {
      if (previous === undefined) delete process.env["FAMILY_PORTAL_URL"];
      else process.env["FAMILY_PORTAL_URL"] = previous;
    }
  });

  it("changes nothing on a GET, which is what a mail scanner sends", async () => {
    const { enrolment } = await enrolled();
    const token = signId(AFTERCARE_UNSUBSCRIBE_PURPOSE, enrolment.id);

    const res = await request(app)
      .get("/api/public/aftercare/unsubscribe")
      .query({ token })
      .expect(200);
    expect(res.body.stopped).toBe(false);

    const [after] = await db
      .select()
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.id, enrolment.id));
    expect(after!.status).toBe("active");
    expect(after!.unsubscribedAt).toBeNull();
  });

  it("still works when the mail provider sends its own Origin", async () => {
    const { enrolment } = await enrolled();
    const token = signId(AFTERCARE_UNSUBSCRIBE_PURPOSE, enrolment.id);

    // RFC 8058: the provider POSTs server-to-server. Some send an Origin,
    // which the cross-origin write guard would otherwise refuse.
    await request(app)
      .post(`/api/public/aftercare/unsubscribe?token=${encodeURIComponent(token)}`)
      .set("Origin", "https://mail.google.com")
      .type("form")
      .send("List-Unsubscribe=One-Click")
      .expect(200);

    const [after] = await db
      .select()
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.id, enrolment.id));
    expect(after!.unsubscribedAt).not.toBeNull();
  });

  it("stops them on a POST, for good", async () => {
    const { enrolment, token: familyToken } = await enrolled();
    const token = signId(AFTERCARE_UNSUBSCRIBE_PURPOSE, enrolment.id);

    // The one-click form a mail client sends.
    await request(app)
      .post(`/api/public/aftercare/unsubscribe?token=${encodeURIComponent(token)}`)
      .type("form")
      .send("List-Unsubscribe=One-Click")
      .expect(200);

    const [after] = await db
      .select()
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.id, enrolment.id));
    expect(after!.status).toBe("done");
    expect(after!.unsubscribedAt).not.toBeNull();

    // And the portal cannot undo it.
    await asFamily(familyToken)
      .post("/api/family/aftercare")
      .send({ consent: true })
      .expect(400);
  });

  it("will not stop somebody else's with a forged or borrowed token", async () => {
    const { enrolment } = await enrolled();

    for (const forged of [
      `${enrolment.id}.${"A".repeat(32)}`,
      // Right id, signed for a different purpose.
      signId("something-else", enrolment.id),
      "",
      "../../etc",
    ]) {
      await request(app)
        .post("/api/public/aftercare/unsubscribe")
        .query({ token: forged })
        .expect(404);
    }

    const [after] = await db
      .select()
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.id, enrolment.id));
    expect(after!.unsubscribedAt).toBeNull();
  });
});

describe("the family's side of the memory book and photo dating", () => {
  it("answers a malformed year with a 400, not a 500", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const photo = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "a.png")
      .expect(201);

    await asFamily(token)
      .patch(`/api/family/photos/${photo.body.id}`)
      .send({ takenYear: "the 1970s" })
      .expect(400);

    const ok = await asFamily(token)
      .patch(`/api/family/photos/${photo.body.id}`)
      .send({ takenYear: 1974 })
      .expect(200);
    expect(ok.body.takenYear).toBe(1974);
  });

  it("serves the rendered book under the locked-down CSP", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const res = await asFamily(token)
      .get("/api/family/memory-book/render")
      .expect(200);

    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("the public request form refuses what nobody can answer", () => {
  async function slug() {
    const staff = await signUpHome();
    const [home] = await db
      .select({ slug: funeralHomesTable.slug })
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, staff.homeId));
    return home!.slug;
  }

  const base = (homeSlug: string) => ({
    homeSlug,
    kind: "at_need",
    requesterName: "Marie Vance",
    subjectFirstName: "Eleanor",
    subjectLastName: "Vance",
  });

  it("wants a telephone number or an email", async () => {
    const homeSlug = await slug();
    await request(app).post("/api/public/intake").send(base(homeSlug)).expect(400);
  });

  it("wants an email to be an email", async () => {
    const homeSlug = await slug();
    await request(app)
      .post("/api/public/intake")
      .send({ ...base(homeSlug), requesterEmail: "marie" })
      .expect(400);
  });

  it("takes either one on its own", async () => {
    const homeSlug = await slug();
    await request(app)
      .post("/api/public/intake")
      .send({ ...base(homeSlug), requesterEmail: "marie@example.com" })
      .expect(202);
  });
});
