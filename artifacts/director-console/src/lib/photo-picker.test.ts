import { describe, expect, it } from "vitest";
import { ACCEPTED_UPLOAD_TYPES, PHOTO_PICKER_ACCEPT } from "@workspace/api-client-react";

/**
 * Some Android pickers report an iPhone's HEIC with no type at all, so a
 * picker that offers HEIC only by type greys out exactly the photographs a
 * family most often brings in. The family portal's picker named the
 * extensions too and the console's did not; both now take the one list.
 */
describe("what the photograph picker offers", () => {
  const offered = PHOTO_PICKER_ACCEPT.split(",");

  it("offers an iPhone's HEIC by its extension as well as its type", () => {
    expect(offered).toEqual(expect.arrayContaining([".heic", ".heif"]));
    expect(offered).toEqual(expect.arrayContaining(["image/heic", "image/heif"]));
  });

  it("offers every type the server accepts", () => {
    for (const type of ACCEPTED_UPLOAD_TYPES) expect(offered).toContain(type);
  });
});
