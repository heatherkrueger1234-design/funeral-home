import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  casePhotosTable,
  familyContactsTable,
  funeralHomesTable,
  memoryBooksTable,
  memoryEntriesTable,
  FAMILY_LINK_TTL_MS,
} from "@workspace/db";
import { runAftercare } from "@workspace/mailer/aftercare";
import { bookIsFull } from "../src/lib/memory-book";
import {
  asFamily,
  createCase,
  inviteFamily,
  signUpHome,
  PNG_BYTES,
  type StaffSession,
} from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

/**
 * The memory book: what the aftercare year is supposed to leave behind.
 *
 * Most of what is worth testing here is not "does it render" — it is the
 * handful of places where a book of a dead woman's photographs is different
 * from any other list of rows. Who may write in it, who may take something
 * out of it, what happens to it when the family asks for everything to be
 * destroyed, and whether the family can still reach it a year later.
 */

/** A case with a family member, one uploaded photograph, and a book. */
async function caseWithFamily(staff: StaffSession, overrides = {}) {
  const row = await createCase(staff, overrides);
  const { contactId, token } = await inviteFamily(staff, row.id, {
    name: "Anne Hale",
    email: "anne@example.com",
  });
  const family = asFamily(token);

  const photo = await family
    .post("/api/family/photos")
    .attach("file", PNG_BYTES, "mother.png")
    .expect(201);

  return { row, contactId, token, family, photoId: photo.body.id as number };
}

describe("writing in the book", () => {
  it("opens a book the first time anybody looks, and only one", async () => {
    const staff = await signUpHome();
    const { row, family } = await caseWithFamily(staff);

    await staff.agent.get(`/api/cases/${row.id}/memory-book`).expect(200);
    await family.get("/api/family/memory-book").expect(200);
    await staff.agent.get(`/api/cases/${row.id}/memory-book`).expect(200);

    const books = await db
      .select()
      .from(memoryBooksTable)
      .where(eq(memoryBooksTable.caseId, row.id));

    expect(books).toHaveLength(1);
    // Open, with the photographs and the obituary in, until somebody says
    // otherwise. There is no date on which a family is too late to
    // remember something.
    expect(books[0]!.closesAt).toBeNull();
    expect(books[0]!.includePhotos).toBe(true);
  });

  it("signs a memory with the contact's own name, not one they sent", async () => {
    const staff = await signUpHome();
    const { family } = await caseWithFamily(staff);

    const created = await family
      .post("/api/family/memory-book/entries")
      .send({
        body: "She answered the telephone as though it were an emergency.",
        whenText: "every Sunday, for about nine years",
        // Offered, and ignored: nobody signs somebody else's name to a
        // paragraph in a family's keepsake.
        authorName: "The Queen",
      })
      .expect(201);

    expect(created.body.authorName).toBe("Anne Hale");
    expect(created.body.whenText).toBe("every Sunday, for about nine years");
    expect(created.body.mine).toBe(true);
  });

  it("keeps the printed name even after the contact is renamed", async () => {
    const staff = await signUpHome();
    const { contactId, family } = await caseWithFamily(staff);

    await family
      .post("/api/family/memory-book/entries")
      .send({ body: "She taught me to drive in a car park in Pueblo." })
      .expect(201);

    await db
      .update(familyContactsTable)
      .set({ name: "Anne Hale (daughter, next of kin)" })
      .where(eq(familyContactsTable.id, contactId));

    const [entry] = await db.select().from(memoryEntriesTable);

    /*
     * A grandchild who signed "Katie" must not become "Katherine Hale
     * (granddaughter)" in a book somebody will keep. The snapshot is the
     * whole point of storing the name rather than joining to it.
     */
    expect(entry!.authorName).toBe("Anne Hale");
  });

  it("lets the home write down what was said at the graveside", async () => {
    const staff = await signUpHome();
    const { row } = await caseWithFamily(staff);

    const created = await staff.agent
      .post(`/api/cases/${row.id}/memory-book/entries`)
      .send({
        authorName: "Bill Hale",
        body: "Posted in a card: she never once let him win at cribbage.",
      })
      .expect(201);

    // Whose memory it is, not who typed it.
    expect(created.body.authorName).toBe("Bill Hale");
    expect(created.body.authorSide).toBe("staff");
  });

  it("refuses a photograph from somebody else's case", async () => {
    const staffA = await signUpHome("Horan & McConaty");
    const staffB = await signUpHome("Somebody Else");

    const a = await caseWithFamily(staffA);
    const b = await caseWithFamily(staffB);

    /*
     * `photoId` is a number out of a request body, and the whole tenancy
     * model rests on never trusting one. Without the check, a contact on
     * one case could name a photograph id from another home's case and have
     * it rendered into their book.
     */
    const refused = await a.family
      .post("/api/family/memory-book/entries")
      .send({ body: "Not my photograph.", photoId: b.photoId })
      .expect(400);

    expect(refused.body.error).toMatch(/not on this case/i);
  });
});

describe("whose memory it is", () => {
  it("does not let one relative edit or delete another's", async () => {
    const staff = await signUpHome();
    const { row, family } = await caseWithFamily(staff);

    const mine = await family
      .post("/api/family/memory-book/entries")
      .send({ body: "Mine." })
      .expect(201);

    const { token: otherToken } = await inviteFamily(staff, row.id, {
      name: "Bill Hale",
      email: "bill@example.com",
    });
    const other = asFamily(otherToken);

    /*
     * Enforced by the predicate on the lookup, not by an `if` after it. A
     * relative rewriting another relative's memory of their mother is not
     * something this should be one forgotten branch away from.
     */
    await other
      .put(`/api/family/memory-book/entries/${mine.body.id}`)
      .send({ body: "Rewritten." })
      .expect(404);

    await other
      .delete(`/api/family/memory-book/entries/${mine.body.id}`)
      .expect(404);

    const [unchanged] = await db.select().from(memoryEntriesTable);
    expect(unchanged!.body).toBe("Mine.");
  });

  it("lets somebody take their own words back out, for real", async () => {
    const staff = await signUpHome();
    const { family } = await caseWithFamily(staff);

    const mine = await family
      .post("/api/family/memory-book/entries")
      .send({ body: "Written at two in the morning." })
      .expect(201);

    await family
      .delete(`/api/family/memory-book/entries/${mine.body.id}`)
      .expect(204);

    // Gone, not flagged. Somebody who wrote something six weeks after their
    // mother died and wants it gone is entitled to have it gone.
    expect(await db.select().from(memoryEntriesTable)).toHaveLength(0);
  });

  it("lets the home take an entry out of the book without deleting it", async () => {
    const staff = await signUpHome();
    const { row, family } = await caseWithFamily(staff);

    const entry = await family
      .post("/api/family/memory-book/entries")
      .send({ body: "Something barbed about the widow." })
      .expect(201);

    await staff.agent
      .put(`/api/cases/${row.id}/memory-book/entries/${entry.body.id}`)
      .send({ includedInBook: false, excludedReason: "Family asked." })
      .expect(200);

    const [row2] = await db.select().from(memoryEntriesTable);
    expect(row2!.includedInBook).toBe(false);
    expect(row2!.excludedAt).not.toBeNull();

    // The author still sees their own, marked, rather than concluding the
    // software lost it and writing it again.
    const seen = await family.get("/api/family/memory-book").expect(200);
    expect(seen.body.entries).toHaveLength(1);
    expect(seen.body.entries[0].includedInBook).toBe(false);
    // But not the home's private note about why.
    expect(JSON.stringify(seen.body)).not.toMatch(/Family asked/);

    // Another relative does not see it at all.
    const { token } = await inviteFamily(staff, row.id, { name: "Bill Hale" });
    const other = await asFamily(token).get("/api/family/memory-book").expect(200);
    expect(other.body.entries).toHaveLength(0);
  });
});

describe("closing the book", () => {
  it("stops new entries but never stops anybody reading or printing it", async () => {
    const staff = await signUpHome();
    const { row, family } = await caseWithFamily(staff);

    await family
      .post("/api/family/memory-book/entries")
      .send({ body: "In before the printer." })
      .expect(201);

    await staff.agent
      .put(`/api/cases/${row.id}/memory-book`)
      .send({ closesAt: new Date(Date.now() - DAY).toISOString() })
      .expect(200);

    const refused = await family
      .post("/api/family/memory-book/entries")
      .send({ body: "Too late." })
      .expect(409);

    // And says what to do about it, rather than looking broken.
    expect(refused.body.error).toMatch(/tell the funeral home/i);

    // Reading and printing are untouched. Closing is about the printer,
    // not about taking the book away from the family.
    await family.get("/api/family/memory-book").expect(200);
    await family.get("/api/family/memory-book/render").expect(200);
  });

  it("reopens", async () => {
    const staff = await signUpHome();
    const { row, family } = await caseWithFamily(staff);

    await staff.agent
      .put(`/api/cases/${row.id}/memory-book`)
      .send({ closesAt: new Date(Date.now() - DAY).toISOString() })
      .expect(200);
    await staff.agent
      .put(`/api/cases/${row.id}/memory-book`)
      .send({ closesAt: null })
      .expect(200);

    await family
      .post("/api/family/memory-book/entries")
      .send({ body: "Remembered late." })
      .expect(201);
  });
});

describe("printing it", () => {
  it("renders one document, the same one, for the home and the family", async () => {
    const staff = await signUpHome();
    const { row, family, photoId } = await caseWithFamily(staff);

    await staff.agent
      .patch(`/api/photos/${photoId}`)
      .send({ caption: "Skegness, 1974" })
      .expect(200);
    await staff.agent
      .put(`/api/cases/${row.id}/photos/selection`)
      .send({ photoIds: [photoId] })
      .expect(200);

    await staff.agent
      .put(`/api/cases/${row.id}/memory-book`)
      .send({ title: "Remembering Margaret", dedication: "For Dad." })
      .expect(200);

    await family
      .post("/api/family/memory-book/entries")
      .send({ body: "She answered the telephone as though it were an emergency." })
      .expect(201);

    const staffCopy = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);
    const familyCopy = await family
      .get("/api/family/memory-book/render")
      .expect(200);

    // One renderer, so there is no watermarked family edition and no page
    // the family's copy is missing. Enforced by there being one function.
    expect(familyCopy.text).toBe(staffCopy.text);

    expect(staffCopy.text).toContain("Remembering Margaret");
    expect(staffCopy.text).toContain("For Dad.");
    expect(staffCopy.text).toContain("Skegness, 1974");
    expect(staffCopy.text).toContain("as though it were an emergency");
    expect(staffCopy.text).toContain("Anne Hale");
    // Half-letter, the trade size for a memorial booklet.
    expect(staffCopy.text).toContain("@page { size: 5.5in 8.5in");
    // Self-contained: the photographs are in the file, not linked.
    expect(staffCopy.text).toContain("data:image/jpeg;base64,");
  });

  it("leaves an excluded entry out of the printed book", async () => {
    const staff = await signUpHome();
    const { row, family } = await caseWithFamily(staff);

    const kept = await family
      .post("/api/family/memory-book/entries")
      .send({ body: "The one about the caravan." })
      .expect(201);
    const pulled = await family
      .post("/api/family/memory-book/entries")
      .send({ body: "The one that should not be in a widow's keepsake." })
      .expect(201);

    expect(kept.body.id).not.toBe(pulled.body.id);

    await staff.agent
      .put(`/api/cases/${row.id}/memory-book/entries/${pulled.body.id}`)
      .send({ includedInBook: false })
      .expect(200);

    const html = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    expect(html.text).toContain("the caravan");
    expect(html.text).not.toContain("widow's keepsake");
  });

  it("puts the cover and a memory's own photograph in before the plates", async () => {
    const staff = await signUpHome();
    const { row, family, photoId } = await caseWithFamily(staff);

    const second = await family
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "caravan.png")
      .expect(201);

    await staff.agent
      .put(`/api/cases/${row.id}/photos/selection`)
      .send({ photoIds: [photoId] })
      .expect(200);
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ portraitPhotoId: photoId })
      .expect(200);

    /*
     * The second photograph is attached to a memory and is deliberately
     * *not* in the slideshow selection. It must still be in the book: a
     * grandchild who chose a snapshot to go with their paragraph has made
     * a choice, and the selection is a different choice about a different
     * thing.
     */
    await family
      .post("/api/family/memory-book/entries")
      .send({ body: "The caravan at Mablethorpe.", photoId: second.body.id })
      .expect(201);

    const html = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    // Cover, plus the memory's picture, and the cover is not repeated as a
    // plate — a book that opens with the same picture twice looks broken.
    const images = html.text.match(/data:image\/jpeg;base64,/g) ?? [];
    expect(images).toHaveLength(2);
  });

  it("stops embedding on whichever ceiling comes first", () => {
    const MB = 1024 * 1024;

    expect(bookIsFull(0, 0)).toBe(false);
    expect(bookIsFull(10, 5 * MB)).toBe(false);

    /*
     * The byte budget is the one that actually bites. Real photographs run
     * about 600KB once downscaled, so a book reaches twenty-four megabytes
     * at roughly forty pictures and never gets near the count — which is
     * the point of having both, since a count alone turns "sixty
     * photographs" into anything between 2MB and 200MB.
     */
    expect(bookIsFull(40, 24 * MB)).toBe(true);
    // And the count is the backstop for a case full of small ones.
    expect(bookIsFull(60, 1 * MB)).toBe(true);
  });

  it("tells the director how many photographs will fit", async () => {
    const staff = await signUpHome();
    const { row, photoId } = await caseWithFamily(staff);

    await staff.agent
      .put(`/api/cases/${row.id}/photos/selection`)
      .send({ photoIds: [photoId] })
      .expect(200);

    const book = await staff.agent
      .get(`/api/cases/${row.id}/memory-book`)
      .expect(200);

    // So a home with two hundred selected photographs finds out from the
    // page, not from a family asking why Aunt Susan is not in the book.
    expect(book.body.photos.selected).toBe(1);
    expect(book.body.photos.limit).toBeGreaterThan(0);
  });

  it("escapes what people typed rather than rendering it", async () => {
    const staff = await signUpHome();
    const { row, family } = await caseWithFamily(staff);

    await family
      .post("/api/family/memory-book/entries")
      .send({ body: "<script>alert('x')</script> & the rest" })
      .expect(201);

    const html = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    // The book is opened in a browser, so an unescaped paragraph is a
    // script somebody's relative typed running in the director's session.
    expect(html.text).not.toContain("<script>alert");
    expect(html.text).toContain("&lt;script&gt;");
    expect(html.text).toContain("&amp; the rest");
  });

  it("still prints after the home has cancelled", async () => {
    const staff = await signUpHome();
    const { family } = await caseWithFamily(staff);

    await family
      .post("/api/family/memory-book/entries")
      .send({ body: "Ours, not theirs." })
      .expect(201);

    await db
      .update(funeralHomesTable)
      .set({
        subscriptionStatus: "canceled",
        trialEndsAt: new Date(Date.now() - DAY),
        entitlements: "",
        suspendedAt: new Date(),
      })
      .where(eq(funeralHomesTable.id, staff.homeId));

    /*
     * The book is assembled out of photographs this family uploaded of
     * their own mother and words they wrote themselves. A billing dispute
     * between us and the funeral home is not their problem, and their
     * keepsake is not our leverage in it.
     */
    const html = await family.get("/api/family/memory-book/render").expect(200);
    expect(html.text).toContain("Ours, not theirs.");
  });
});

describe("erasing the case", () => {
  it("takes the book and every memory with it", async () => {
    const staff = await signUpHome();
    const { row, family } = await caseWithFamily(staff);

    await family
      .post("/api/family/memory-book/entries")
      .send({ body: "Everything about my mother." })
      .expect(201);

    await staff.agent
      .post(`/api/cases/${row.id}/delete`)
      .send({ confirmName: "Margaret Hale", reason: "The family asked." })
      .expect(204);

    /*
     * The deliberate opposite of `billable_cases`, which holds no name and
     * outlives erasure on purpose. Everything here is family content about
     * a named person, so the cascade takes it.
     */
    expect(await db.select().from(memoryEntriesTable)).toHaveLength(0);
    expect(await db.select().from(memoryBooksTable)).toHaveLength(0);
  });
});

describe("the aftercare year filling the book", () => {
  /** Close a case so its family is enrolled, then consent on their behalf. */
  async function enrolled(staff: StaffSession) {
    const built = await caseWithFamily(staff, {
      serviceAt: new Date(Date.now() - 400 * DAY).toISOString(),
    });

    await staff.agent.post(`/api/cases/${built.row.id}/close`).send({}).expect(200);
    await built.family
      .post("/api/family/aftercare")
      .send({ consent: true })
      .expect(200);

    return built;
  }

  it("invites a memory in the check-in, when there is a book to invite to", async () => {
    const staff = await signUpHome();
    const built = await enrolled(staff);

    // The book exists because somebody opened the page.
    await staff.agent.get(`/api/cases/${built.row.id}/memory-book`).expect(200);

    const result = await runAftercare({ dryRun: true });
    expect(result.due).toBeGreaterThan(0);
  });

  it("keeps the family's link alive long enough to reach the anniversary", async () => {
    const staff = await signUpHome();
    const built = await enrolled(staff);
    await staff.agent.get(`/api/cases/${built.row.id}/memory-book`).expect(200);

    // Their link is days from lapsing, as it would be by the time the later
    // check-ins land.
    const nearlyGone = new Date(Date.now() + 2 * DAY);
    await db
      .update(familyContactsTable)
      .set({ expiresAt: nearlyGone })
      .where(eq(familyContactsTable.id, built.contactId));

    await runAftercare();

    const [contact] = await db
      .select()
      .from(familyContactsTable)
      .where(eq(familyContactsTable.id, built.contactId));

    /*
     * A link lives 90 days from issue and the anniversary check-in lands at
     * 365. Without this the book quietly stops accepting anything from the
     * family around the third message — a collection feature that works
     * right up until the year it was built for.
     */
    expect(contact!.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + FAMILY_LINK_TTL_MS - DAY,
    );

    // The same token, not a new one: the link in the text message they
    // already have is the one they will actually click.
    const stillWorks = await asFamily(built.token)
      .get("/api/family/memory-book")
      .expect(200);
    expect(stillWorks.body.open).toBe(true);
  });

  it("does not resurrect a link a director revoked", async () => {
    const staff = await signUpHome();
    const built = await enrolled(staff);
    await staff.agent.get(`/api/cases/${built.row.id}/memory-book`).expect(200);

    await db
      .update(familyContactsTable)
      .set({ revokedAt: new Date(), expiresAt: new Date(Date.now() + 2 * DAY) })
      .where(eq(familyContactsTable.id, built.contactId));

    await runAftercare();

    const [contact] = await db
      .select()
      .from(familyContactsTable)
      .where(eq(familyContactsTable.id, built.contactId));

    // Revocation is absolute. A convenience for the book must never be a
    // way back in for a link somebody deliberately killed.
    expect(contact!.expiresAt.getTime()).toBeLessThan(Date.now() + 3 * DAY);
    await asFamily(built.token).get("/api/family/memory-book").expect(401);
  });

  it("leaves a home that keeps no book exactly as it was", async () => {
    const staff = await signUpHome();
    const built = await enrolled(staff);

    // Nobody has opened a book on this case, so there is nothing to invite
    // anyone to and nothing to keep a link alive for.
    const soon = new Date(Date.now() + 2 * DAY);
    await db
      .update(familyContactsTable)
      .set({ expiresAt: soon })
      .where(eq(familyContactsTable.id, built.contactId));

    await runAftercare();

    const [contact] = await db
      .select()
      .from(familyContactsTable)
      .where(eq(familyContactsTable.id, built.contactId));

    expect(contact!.expiresAt.getTime()).toBeCloseTo(soon.getTime(), -4);

    const books = await db
      .select()
      .from(memoryBooksTable)
      .where(eq(memoryBooksTable.caseId, built.row.id));
    expect(books).toHaveLength(0);
  });
});

describe("tenancy", () => {
  it("keeps one home's book out of another's reach", async () => {
    const staffA = await signUpHome("Horan & McConaty");
    const staffB = await signUpHome("Somebody Else");

    const a = await caseWithFamily(staffA);
    await a.family
      .post("/api/family/memory-book/entries")
      .send({ body: "Private." })
      .expect(201);

    await staffB.agent.get(`/api/cases/${a.row.id}/memory-book`).expect(404);
    await staffB.agent.get(`/api/cases/${a.row.id}/memory-book/render`).expect(404);

    const [entry] = await db
      .select()
      .from(memoryEntriesTable)
      .where(
        and(
          eq(memoryEntriesTable.caseId, a.row.id),
          eq(memoryEntriesTable.funeralHomeId, staffA.homeId),
        ),
      );
    expect(entry).toBeDefined();
  });
});
