import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * Adversarial probes at the master page, the inbox and the offered times.
 *
 * Each of these is a thing a real home would hit in its first fortnight,
 * written as the accident rather than as a unit of implementation. Most of
 * them are about a screen telling somebody something that is no longer true,
 * which is the failure mode this product can least afford: a director who
 * stops believing the dashboard stops opening it.
 */

const daysFromNow = (days: number, hour = 11) => {
  const when = new Date();
  when.setUTCDate(when.getUTCDate() + days);
  when.setUTCHours(hour, 0, 0, 0);
  return when;
};

describe("the dashboard stops counting things that are over", () => {
  it("does not keep asking about a family who never answered a closed case", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    await staff.agent
      .post(`/api/cases/${row.id}/service-offers`)
      .send({ startsAt: daysFromNow(5).toISOString() })
      .expect(201);

    const before = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(before.body.offersAwaitingChoice).toBe(1);

    /*
     * The ordinary ending: the family rang, the director typed the date on
     * the case, and the offers were never answered. Closing the case has to
     * take them off the count -- otherwise the tile reads "1 family has times
     * to choose from" for the rest of the home's subscription.
     */
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: daysFromNow(5).toISOString() })
      .expect(200);
    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    const after = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(after.body.offersAwaitingChoice).toBe(0);
  });

  it("stops asking once the home has set the date itself", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    await staff.agent
      .post(`/api/cases/${row.id}/service-offers`)
      .send({ startsAt: daysFromNow(5).toISOString() })
      .expect(201);

    // The family rang. The director wrote the time on the case rather than
    // going back to mark an offer chosen, which is what actually happens.
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: daysFromNow(6).toISOString() })
      .expect(200);

    const res = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(res.body.offersAwaitingChoice).toBe(0);
  });
});

describe("the family is never asked something already settled", () => {
  it("does not ask for a choice the home has already made on the case", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id as number);

    await staff.agent
      .post(`/api/cases/${row.id}/service-offers`)
      .send({ startsAt: daysFromNow(5).toISOString() })
      .expect(201);

    const asked = await asFamily(family.token)
      .get("/api/family/session")
      .expect(200);
    expect(asked.body.awaitingServiceChoice).toBe(true);

    // The director confirms a time directly on the case.
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: daysFromNow(6).toISOString() })
      .expect(200);

    /*
     * The hub must now agree with the page behind it. The choosing screen
     * reads a confirmed `serviceAt` as settled, so a hub that still says
     * "choose a time" sends a grieving family to a screen that tells them
     * there is nothing to choose.
     */
    const settled = await asFamily(family.token)
      .get("/api/family/session")
      .expect(200);
    expect(settled.body.awaitingServiceChoice).toBe(false);
  });

  it("will not let a family move the date of a case that has closed", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id as number);

    const offer = await staff.agent
      .post(`/api/cases/${row.id}/service-offers`)
      .send({ startsAt: daysFromNow(5).toISOString() })
      .expect(201);

    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: daysFromNow(-2).toISOString() })
      .expect(200);
    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    // The funeral has happened. A stale tab must not rewrite the date of a
    // service that is over and rebuild a timeline behind it.
    await asFamily(family.token)
      .post(`/api/family/service-offers/${offer.body.id}/choose`)
      .expect(409);
  });
});

describe("a time nobody can attend is not a time", () => {
  it("refuses an offer in the past", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    // A director typing 2025 instead of 2026 on the date field, which is a
    // keystroke, not a hypothetical.
    await staff.agent
      .post(`/api/cases/${row.id}/service-offers`)
      .send({ startsAt: daysFromNow(-3).toISOString() })
      .expect(400);
  });

  it("still lets the home confirm a time that has since passed", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const offer = await staff.agent
      .post(`/api/cases/${row.id}/service-offers`)
      .send({ startsAt: daysFromNow(1).toISOString() })
      .expect(201);

    /*
     * Recording what a family already agreed to is not the same as offering
     * it. A director catching up on paperwork after the service must still be
     * able to say which time was taken.
     */
    await staff.agent
      .post(`/api/cases/${row.id}/service-offers/${offer.body.id}/confirm`)
      .expect(200);
  });
});

describe("the inbox stays a screen rather than a database dump", () => {
  it("caps what it returns, however many families have written", async () => {
    const staff = await signUpHome();

    for (let index = 0; index < 8; index += 1) {
      const row = await createCase(staff, { decedentLastName: `Case${index}` });
      const family = await inviteFamily(staff, row.id as number);
      await asFamily(family.token)
        .post("/api/family/messages")
        .send({ body: `Message from family ${index}` })
        .expect(201);
    }

    const res = await staff.agent.get("/api/home/inbox").expect(200);

    // A home three years in has hundreds of these, and this screen is opened
    // every morning.
    expect(res.body.length).toBeLessThanOrEqual(50);
    expect(res.body.length).toBe(8);
  });
});

describe("a bad number is a bad request, not a broken server", () => {
  /*
   * OpenAPI's `integer` does not survive into a zod `.int()`, so a fraction
   * passes validation and Postgres refuses it. That is true of every integer
   * field in this API, not only the ones this branch added — so these probe
   * one of each and the fix lives in the error handler rather than in a list
   * of field names that would go stale.
   */
  it("refuses a fraction where a whole number belongs", async () => {
    const staff = await signUpHome();

    for (const body of [
      { messageLockDays: 1.5 },
      { slideshowTarget: 2.5 },
      { officeOpensMinute: 61.5 },
    ]) {
      const res = await staff.agent.put("/api/home").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).not.toMatch(/internal/i);
    }

    const price = await staff.agent
      .post("/api/home/price-list")
      .send({ category: "Services", label: "Graveside", amountCents: 12.7 });
    expect(price.status).toBe(400);

    const template = await staff.agent
      .post("/api/home/timeline-template")
      .send({ title: "Something", offsetMinutes: -4320.5 });
    expect(template.status).toBe(400);
  });

  it("still takes the whole numbers next to them", async () => {
    const staff = await signUpHome();

    await staff.agent
      .put("/api/home")
      .send({ messageLockDays: 30, slideshowTarget: 80, officeOpensMinute: 540 })
      .expect(200);
  });
});

describe("the past-due list shows what can still be chased", () => {
  it("is not permanently filled by one case somebody forgot to close", async () => {
    const staff = await signUpHome();

    /*
     * The case nobody closed. Its steps went past due a long time ago and
     * will stay that way. There are deliberately more of them than the
     * dashboard will return, because that is the whole point: with the
     * oldest first, they fill every slot and nothing newer is ever reachable.
     */
    const stale = await createCase(staff, { decedentLastName: "Forgotten" });
    await staff.agent
      .put(`/api/cases/${stale.id}`)
      .send({ serviceAt: daysFromNow(-400).toISOString() })
      .expect(200);

    for (let index = 0; index < 12; index += 1) {
      await staff.agent
        .post(`/api/cases/${stale.id}/deadlines`)
        .send({
          title: `Long forgotten step ${index}`,
          dueAt: daysFromNow(-400 + index).toISOString(),
        })
        .expect(201);
    }

    // This week's case, whose photographs were due yesterday.
    const live = await createCase(staff, { decedentLastName: "Thisweek" });
    await staff.agent
      .put(`/api/cases/${live.id}`)
      .send({ serviceAt: daysFromNow(2).toISOString() })
      .expect(200);
    await staff.agent
      .post(`/api/cases/${live.id}/deadlines`)
      .send({ title: "Photographs in", dueAt: daysFromNow(-1).toISOString() })
      .expect(201);

    const res = await staff.agent.get("/api/home/dashboard").expect(200);

    const names = res.body.overdue.map(
      (row: { decedentName: string }) => row.decedentName,
    );
    expect(names.join(" "), "yesterday's slip is buried under a dead case").toContain(
      "Thisweek",
    );
  });
});

describe("a number nobody can clear is not put on the screen", () => {
  it("stops counting a family the home can no longer reply to", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id as number);

    await asFamily(family.token)
      .post("/api/family/messages")
      .send({ body: "Are we still on for Friday?" })
      .expect(201);

    const waiting = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(waiting.body.casesWaitingOnReply).toBe(1);

    /*
     * The director never opened the thread and closed the case well after
     * the service, so it locks at once. The message is still unread and now
     * unanswerable — a tile reading "1 family is waiting on a reply" would
     * point at an inbox row with no reply box on it, for ever.
     */
    const longAgo = new Date();
    longAgo.setUTCDate(longAgo.getUTCDate() - 60);
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: longAgo.toISOString() })
      .expect(200);
    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    const after = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(after.body.casesWaitingOnReply).toBe(0);
    expect(after.body.unansweredMessages).toBe(0);

    // The thread is still listed, and still honest about what is in it.
    const inbox = await staff.agent.get("/api/home/inbox").expect(200);
    expect(inbox.body[0].locked).toBe(true);
  });

  it("still counts a family in the fortnight after a case closes", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id as number);

    await asFamily(family.token)
      .post("/api/family/messages")
      .send({ body: "One last thing" })
      .expect(201);

    // Closed yesterday's service: the thread stays open for a fortnight and
    // the director can still answer, so they should still be told to.
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: yesterday.toISOString() })
      .expect(200);
    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    const after = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(after.body.casesWaitingOnReply).toBe(1);
  });
});
