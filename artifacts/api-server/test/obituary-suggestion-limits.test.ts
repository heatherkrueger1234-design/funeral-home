/**
 * What a suggested obituary may cost, and who may ask for one.
 *
 * Every suggestion is billed to the platform's key by the token, and
 * anybody can register a home. Before these limits a new account could
 * paste a 600 KB "life story" and press the button in a loop, spending
 * about 150,000 tokens a press and exhausting the key for every other home.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

// The text provider, stood in for, keeping what each request would have sent.
const sentToProvider = vi.hoisted(() => [] as string[]);
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class RateLimitError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    messages = {
      create: vi.fn(async (body: { messages: Array<{ content: string }> }) => {
        sentToProvider.push(body.messages[0]!.content);
        return { stop_reason: "end_turn", content: [{ type: "text", text: "A suggestion." }] };
      }),
    };
  }
  return { default: Anthropic };
});

beforeEach(() => {
  sentToProvider.length = 0;
  process.env["ANTHROPIC_API_KEY"] = "sk-test";
});

afterEach(() => {
  delete process.env["ANTHROPIC_API_KEY"];
});

async function caseWithObituary(options: { verified?: boolean; biography?: string } = {}) {
  const staff = await signUpHome("Aspen Grove", { verified: options.verified });
  const row = await createCase(staff);
  const { token } = await inviteFamily(staff, row.id);
  await asFamily(token)
    .put("/api/family/obituary")
    .send({ fullName: "Margaret Hale", biography: options.biography ?? "She taught." })
    .expect(200);
  return { staff, caseId: row.id };
}

describe("a suggested obituary", () => {
  it("sends at most twenty thousand characters, however long the life story", async () => {
    const { staff, caseId } = await caseWithObituary({ biography: "She taught. ".repeat(50_000) });

    await staff.agent
      .post(`/api/cases/${caseId}/obituary/suggestion`)
      .send({ confirm: true })
      .expect(200);

    expect(sentToProvider).toHaveLength(1);
    expect(sentToProvider[0]!.length).toBeLessThanOrEqual(20_000);
    expect(sentToProvider[0]).toContain("Margaret Hale");
  });

  it("waits for the director's address to be confirmed", async () => {
    const { staff, caseId } = await caseWithObituary({ verified: false });

    const refused = await staff.agent
      .post(`/api/cases/${caseId}/obituary/suggestion`)
      .send({ confirm: true })
      .expect(403);
    expect(refused.body.error).toMatch(/confirm your email/i);
    expect(sentToProvider).toHaveLength(0);
  });

  it("allows a home twenty an hour, and another home its own twenty", async () => {
    const { staff, caseId } = await caseWithObituary();

    for (let i = 0; i < 20; i += 1) {
      await staff.agent
        .post(`/api/cases/${caseId}/obituary/suggestion`)
        .send({ confirm: true })
        .expect(200);
    }
    await staff.agent
      .post(`/api/cases/${caseId}/obituary/suggestion`)
      .send({ confirm: true })
      .expect(429);
    // Taking the last one is not another suggestion, and is not counted.
    await staff.agent.post(`/api/cases/${caseId}/obituary/suggestion/accept`).expect(200);

    const other = await caseWithObituary();
    await other.staff.agent
      .post(`/api/cases/${other.caseId}/obituary/suggestion`)
      .send({ confirm: true })
      .expect(200);
    expect(sentToProvider).toHaveLength(21);
  });
});
