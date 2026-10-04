import { describe, expect, it } from "vitest";
import {
  customerRecordForm,
  customerRecordToSave,
  type CustomerRecord,
} from "./customer-record";

/** A home's record as the API sends it: dates typed as days, stored as instants. */
const hartley: CustomerRecord = {
  contactName: "Karen Voss",
  subscriptionPlan: "Standard",
  subscriptionStatus: "active",
  billingPeriod: "monthly",
  billingAmountCents: 1999,
  billingStartDate: "2026-09-01T00:00:00.000Z",
  subscriptionDueDate: "2026-10-01T00:00:00.000Z",
  discount: "20% off the first year",
  howHeardAboutUs: "Referral from another home",
  adminNotes: "Met at the state conference.",
};

describe("a home's customer record", () => {
  it("saves back exactly what it opened with when nothing is changed", () => {
    // $19.99 is 1998.9999999999998 cents in binary, and the due date is the
    // day that was typed, not the evening before it.
    expect(customerRecordToSave(customerRecordForm(hartley))).toEqual({
      contactName: "Karen Voss",
      subscriptionPlan: "Standard",
      subscriptionStatus: "active",
      billingPeriod: "monthly",
      billingAmountCents: 1999,
      billingStartDate: "2026-09-01",
      subscriptionDueDate: "2026-10-01",
      discount: "20% off the first year",
      howHeardAboutUs: "Referral from another home",
      adminNotes: "Met at the state conference.",
    });
  });

  it("clears what was cleared: no amount is no amount, not zero", () => {
    const form = {
      ...customerRecordForm(hartley),
      billingAmount: " ",
      billingPeriod: "",
      subscriptionDueDate: "",
      discount: "  ",
    };
    expect(customerRecordToSave(form)).toMatchObject({
      billingAmountCents: null,
      billingPeriod: null,
      subscriptionDueDate: null,
      discount: "",
    });
  });

  it("never sends a status of suspended, which has its own reason and its own button", () => {
    const form = { ...customerRecordForm(hartley), subscriptionStatus: "suspended" };
    expect(customerRecordToSave(form)).not.toHaveProperty("subscriptionStatus");
  });
});
