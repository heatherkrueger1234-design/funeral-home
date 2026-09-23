import { describe, expect, it } from "vitest";
import { tokenFromPasted } from "./paste-link";

const TOKEN = "q7Vx3mN0bT9kLr2WcYp8sZa4Hd6Fg1Je5Uo_-iKlMnQ";

describe("tokenFromPasted", () => {
  it("takes the token from a full link", () => {
    expect(tokenFromPasted(`https://family.example.com/f/${TOKEN}`)).toBe(TOKEN);
  });

  it("takes it from a link without the scheme", () => {
    expect(tokenFromPasted(`family.example.com/f/${TOKEN}`)).toBe(TOKEN);
  });

  it("takes it from the sentence the link was sent in", () => {
    expect(
      tokenFromPasted(
        `Hello, this is Hartley & Sons. Your page: https://family.example.com/f/${TOKEN}. Call us any time.`,
      ),
    ).toBe(TOKEN);
  });

  it("ignores a query string or fragment after the token", () => {
    expect(tokenFromPasted(`https://x.test/f/${TOKEN}?utm=sms#top`)).toBe(TOKEN);
  });

  it("accepts a bare token typed in by hand", () => {
    expect(tokenFromPasted(`  ${TOKEN}  `)).toBe(TOKEN);
  });

  it("rejects things that are not a link", () => {
    expect(tokenFromPasted("")).toBeNull();
    expect(tokenFromPasted("   ")).toBeNull();
    expect(tokenFromPasted("hello")).toBeNull();
    expect(tokenFromPasted("https://family.example.com/")).toBeNull();
    expect(tokenFromPasted("my mother's funeral")).toBeNull();
  });
});
