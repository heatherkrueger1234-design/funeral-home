import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * Offering a family two or three times, and what happens when one is picked.
 *
 * The interesting assertions are not that a row is written. They are that
 * picking a time *builds the timeline*, which is the entire reason the
 * feature exists, and that a second answer is refused rather than applied —
 * a brother and a sister in the same kitchen must not move a funeral between
 * them.
 */

const AT = (days: number, hour = 11) => {
  const when = new Date();
  when.setUTCDate(when.getUTCDate() + days);
  when.setUTCHours(hour, 0, 0, 0);
  return when.toISOString();
};

async function caseWithOffers(times = [AT(7), AT(9, 14)]) {
  const staff = await signUpHome();
  const row = await createCase(staff);
  const family = await inviteFamily(staff, row.id as number);

  const offers = [];
  for (const [index, startsAt] of times.entries()) {
    const res = await staff.agent
      .post(`/api/cases/${row.id}/service-offers`)
      .send({
        startsAt,
        location: index === 0 ? "The chapel" : null,
        note: index === 0 ? "Father Reilly can do this one" : null,
      })
      .expect(201);
    offers.push(res.body);
  }

  return { staff, caseId: row.id as number, family, offers };
}

describe("offering a family a time", () => {
  it("shows the family the options, soonest first", async () => {
    const { family } = await caseWithOffers([AT(9, 14), AT(7)]);

    const res = await asFamily(family.token)
      .get("/api/family/service-offers")
      .expect(200);

    expect(res.body.offers).toHaveLength(2);
    expect(new Date(res.body.offers[0].startsAt).getTime()).toBeLessThan(
      new Date(res.body.offers[1].startsAt).getTime(),
    );
    expect(res.body.chosenOfferId).toBeNull();
    expect(res.body.serviceAt).toBeNull();
  });

  it("builds the timeline the moment the family picks one", async () => {
    const { staff, caseId, family, offers } = await caseWithOffers();

    // Nothing is due, because nothing can be dated yet.
    const before = await staff.agent
      .get(`/api/cases/${caseId}/deadlines`)
      .expect(200);
    expect(before.body).toHaveLength(0);

    await asFamily(family.token)
      .post(`/api/family/service-offers/${offers[0].id}/choose`)
      .expect(200);

    const after = await staff.agent
      .get(`/api/cases/${caseId}/deadlines`)
      .expect(200);

    // The home's seeded standard schedule, now dated off the chosen time.
    expect(after.body.length).toBeGreaterThan(0);

    const detail = await staff.agent.get(`/api/cases/${caseId}`).expect(200);
    expect(detail.body.serviceAt).not.toBeNull();
    expect(detail.body.serviceLocation).toBe("The chapel");
  });

  it("refuses a second answer instead of moving the funeral", async () => {
    const { family, offers } = await caseWithOffers();

    await asFamily(family.token)
      .post(`/api/family/service-offers/${offers[0].id}/choose`)
      .expect(200);

    const second = await asFamily(family.token)
      .post(`/api/family/service-offers/${offers[1].id}/choose`)
      .expect(409);

    // And it tells them what to do instead, rather than just refusing.
    expect(second.body.error).toMatch(/ring the funeral home/i);
  });

  it("does not blank a location the case already had", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceLocation: "St Mary's" })
      .expect(200);

    // An option with no location of its own: a different time, same place.
    const offer = await staff.agent
      .post(`/api/cases/${row.id}/service-offers`)
      .send({ startsAt: AT(5) })
      .expect(201);

    await staff.agent
      .post(`/api/cases/${row.id}/service-offers/${offer.body.id}/confirm`)
      .expect(200);

    const detail = await staff.agent.get(`/api/cases/${row.id}`).expect(200);
    expect(detail.body.serviceLocation).toBe("St Mary's");
  });

  it("lets the director record the family who rang instead of tapping", async () => {
    const { staff, caseId, family, offers } = await caseWithOffers();

    const res = await staff.agent
      .post(`/api/cases/${caseId}/service-offers/${offers[1].id}/confirm`)
      .expect(200);

    expect(res.body.scheduleCreated).toBeGreaterThan(0);

    // Nobody is credited with a tap they never made.
    const seen = await asFamily(family.token)
      .get("/api/family/service-offers")
      .expect(200);
    expect(seen.body.chosenOfferId).toBe(offers[1].id);
    expect(seen.body.offers.find((o: { id: number }) => o.id === offers[1].id).chosenByName).toBeNull();
  });

  it("will not withdraw the time the family chose", async () => {
    const { staff, family, offers } = await caseWithOffers();

    await asFamily(family.token)
      .post(`/api/family/service-offers/${offers[0].id}/choose`)
      .expect(200);

    await staff.agent
      .delete(`/api/service-offers/${offers[0].id}`)
      .expect(409);

    // The one nobody picked is still withdrawable.
    await staff.agent
      .delete(`/api/service-offers/${offers[1].id}`)
      .expect(204);
  });

  it("stops offering more once the family has answered", async () => {
    const { staff, caseId, family, offers } = await caseWithOffers();

    await asFamily(family.token)
      .post(`/api/family/service-offers/${offers[0].id}/choose`)
      .expect(200);

    await staff.agent
      .post(`/api/cases/${caseId}/service-offers`)
      .send({ startsAt: AT(12) })
      .expect(409);
  });

  it("puts the unanswered choice on the family's hub, and takes it off again", async () => {
    const { family, offers } = await caseWithOffers();

    const before = await asFamily(family.token)
      .get("/api/family/session")
      .expect(200);
    expect(before.body.awaitingServiceChoice).toBe(true);

    await asFamily(family.token)
      .post(`/api/family/service-offers/${offers[0].id}/choose`)
      .expect(200);

    const after = await asFamily(family.token)
      .get("/api/family/session")
      .expect(200);
    expect(after.body.awaitingServiceChoice).toBe(false);
  });

  it("will not let one home offer a time on another home's case", async () => {
    const { offers } = await caseWithOffers();
    const stranger = await signUpHome("Elm Street Chapel");
    const theirCase = await createCase(stranger);

    await stranger.agent
      .get(`/api/cases/${theirCase.id}/service-offers`)
      .expect(200);

    // The id is real; the tenant filter is the whole of what stops this.
    await stranger.agent.delete(`/api/service-offers/${offers[0].id}`).expect(404);
  });

  it("will not let a family choose an offer that is not on their case", async () => {
    const { offers } = await caseWithOffers();

    const other = await signUpHome("Elm Street Chapel");
    const otherCase = await createCase(other);
    const otherFamily = await inviteFamily(other, otherCase.id as number);

    await asFamily(otherFamily.token)
      .post(`/api/family/service-offers/${offers[0].id}/choose`)
      .expect(404);
  });
});
