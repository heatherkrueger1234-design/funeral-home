import { describe, expect, it } from "vitest";
import type { HomeLicensure } from "./api";
import { registrationForm, registrationToSave, splitServices } from "./licensure";

/**
 * The reminders themselves -- the January 2027 deadline, the thirty days to
 * file an amendment, a licence running out -- are worked out on the server
 * (`lib/db/src/schema/licensure.ts`) and tested there. What this screen owns
 * is the form that feeds them, and a form that cannot save a cleared date
 * leaves a clock running that should have stopped.
 */

const registration: HomeLicensure = {
  doraRegistrationNumber: "FE.0001234",
  registeredServices: ["Funeral establishment", "Crematory"],
  designeeName: "Karen Voss",
  designeeTitle: "Owner",
  beganBusinessOn: "1998-04-01",
  registrationRenewsOn: "2027-03-31",
  servicesChangedOn: "2026-09-15",
  amendmentFiledOn: "2026-09-29",
  notes: null,
};

describe("the DORA registration form", () => {
  it("reads the registered services one per comma, without the blanks", () => {
    expect(splitServices(" Funeral establishment,, Crematory , ")).toEqual([
      "Funeral establishment",
      "Crematory",
    ]);
    expect(splitServices("   ")).toEqual([]);
  });

  it("saves back exactly what it opened with when nothing is changed", () => {
    expect(registrationToSave(registrationForm(registration))).toEqual(
      registration,
    );
  });

  it("sends a cleared date as nothing, never as an empty string the API refuses", () => {
    // Clearing "Amendment filed" is how a mistaken filing date is taken back,
    // and with it the thirty-day reminder returns.
    const form = {
      ...registrationForm(registration),
      amendmentFiledOn: "",
      designeeTitle: "   ",
    };
    expect(registrationToSave(form)).toMatchObject({
      amendmentFiledOn: null,
      designeeTitle: null,
    });
  });
});
