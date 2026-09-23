import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * The wedding ring tests.
 *
 * A ring that cannot be accounted for is the worst conversation a funeral
 * director has, so the rules that protect the record are asserted directly:
 * only the home moves an item through custody, every transition is stamped
 * with a name, and nothing that has been handed over can be deleted.
 */
describe("belongings and the chain of custody", () => {
  it("gives every case the standard prompts without anyone typing them", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const items = await staff.agent
      .get(`/api/cases/${row.id}/belongings`)
      .expect(200);

    expect(items.body.length).toBeGreaterThan(0);
    expect(items.body.map((i: { kind: string }) => i.kind)).toContain("jewellery");
    // Everything starts as expected, and nothing is presumed received.
    expect(items.body.every((i: { status: string }) => i.status === "expected")).toBe(true);
  });

  it("stamps who took an item in, and when", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    await staff.agent.get(`/api/cases/${row.id}/belongings`).expect(200);

    const ring = await staff.agent
      .post(`/api/cases/${row.id}/belongings`)
      .send({ kind: "jewellery", description: "Gold wedding ring, worn thin" })
      .expect(201);

    expect(ring.body.receivedAt).toBeNull();

    const received = await staff.agent
      .put(`/api/belongings/${ring.body.id}`)
      .send({ status: "received" })
      .expect(200);

    // The record is a side effect of doing the work, not a second form.
    expect(received.body.status).toBe("received");
    expect(received.body.receivedAt).not.toBeNull();
    expect(received.body.receivedByName).toBe("Karen Voss");

    const returned = await staff.agent
      .put(`/api/belongings/${ring.body.id}`)
      .send({ status: "returned", returnedToName: "Anne Hale" })
      .expect(200);

    expect(returned.body.returnedAt).not.toBeNull();
    expect(returned.body.returnedToName).toBe("Anne Hale");
  });

  it("will not let anyone delete an item the home is holding", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const item = await staff.agent
      .post(`/api/cases/${row.id}/belongings`)
      .send({ description: "Pearl necklace" })
      .expect(201);

    // Logged in error, never handed over: fine to remove.
    await staff.agent.delete(`/api/belongings/${item.body.id}`).expect(204);

    const held = await staff.agent
      .post(`/api/cases/${row.id}/belongings`)
      .send({ description: "Signet ring" })
      .expect(201);

    await staff.agent
      .put(`/api/belongings/${held.body.id}`)
      .send({ status: "received" })
      .expect(200);

    // Now it is the only evidence the home has that they took it in.
    await staff.agent.delete(`/api/belongings/${held.body.id}`).expect(400);
  });

  it("lets the family describe items but never move them through custody", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const added = await asFamily(token)
      .post("/api/family/belongings")
      .send({
        kind: "clothing",
        description: "Navy suit, white shirt, burgundy tie",
        disposition: "with_deceased",
      })
      .expect(201);

    expect(added.body.disposition).toBe("with_deceased");

    // A family may change their mind while the item is still at home.
    await asFamily(token)
      .put(`/api/family/belongings/${added.body.id}`)
      .send({ disposition: "return_to_family" })
      .expect(200);

    // Once the home has it, the description is the home's record.
    await staff.agent
      .put(`/api/belongings/${added.body.id}`)
      .send({ status: "received" })
      .expect(200);

    await asFamily(token)
      .put(`/api/family/belongings/${added.body.id}`)
      .send({ description: "Actually the grey suit" })
      .expect(409);

    await asFamily(token)
      .delete(`/api/family/belongings/${added.body.id}`)
      .expect(409);
  });

  it("cannot reach another case's items", async () => {
    const staff = await signUpHome();
    const mine = await createCase(staff, { decedentLastName: "Mine" });
    const theirs = await createCase(staff, { decedentLastName: "Theirs" });

    const item = await staff.agent
      .post(`/api/cases/${theirs.id}/belongings`)
      .send({ description: "Watch" })
      .expect(201);

    const { token } = await inviteFamily(staff, mine.id);

    await asFamily(token)
      .put(`/api/family/belongings/${item.body.id}`)
      .send({ description: "Mine now" })
      .expect(404);
  });
});

describe("the preparation sheet", () => {
  it("carries what the family said to whoever prepares them", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    await asFamily(token)
      .put("/api/family/preparation")
      .send({
        hairNotes: "Parted on the left. She set it herself every Friday.",
        cosmeticsNotes: "Very light. Never wore foundation.",
        glassesWorn: true,
      })
      .expect(200);

    const seen = await staff.agent
      .get(`/api/cases/${row.id}/preparation`)
      .expect(200);

    expect(seen.body.hairNotes).toContain("every Friday");
    expect(seen.body.glassesWorn).toBe(true);
    expect(seen.body.reviewedAt).toBeNull();

    const reviewed = await staff.agent
      .put(`/api/cases/${row.id}/preparation`)
      .send({ reviewed: true })
      .expect(200);

    expect(reviewed.body.reviewedAt).not.toBeNull();
    expect(reviewed.body.reviewedByName).toBe("Karen Voss");

    // A later family edit un-signs it: what the room read is no longer what
    // the family has said.
    await asFamily(token)
      .put("/api/family/preparation")
      .send({ cosmeticsNotes: "Actually, a little pink lipstick." })
      .expect(200);

    const after = await staff.agent
      .get(`/api/cases/${row.id}/preparation`)
      .expect(200);
    expect(after.body.reviewedAt).toBeNull();
  });
});
