import { toCents, toDollars, type AdminHomeSummary } from "@/lib/api";

/** The fields of a home that are our customer record of it. */
export type CustomerRecord = Pick<
  AdminHomeSummary,
  | "contactName"
  | "subscriptionPlan"
  | "subscriptionStatus"
  | "billingPeriod"
  | "billingAmountCents"
  | "billingStartDate"
  | "subscriptionDueDate"
  | "discount"
  | "howHeardAboutUs"
  | "adminNotes"
>;

/**
 * A home's commercial record as its edit form holds it: every field a
 * string, empty where nothing is recorded.
 */
export type CustomerRecordForm = {
  contactName: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  billingPeriod: string;
  /** Dollars, as typed. */
  billingAmount: string;
  /** "YYYY-MM-DD", as a date input reads and writes it. */
  billingStartDate: string;
  subscriptionDueDate: string;
  discount: string;
  howHeardAboutUs: string;
  adminNotes: string;
};

export function customerRecordForm(home: CustomerRecord): CustomerRecordForm {
  return {
    contactName: home.contactName ?? "",
    subscriptionPlan: home.subscriptionPlan ?? "",
    subscriptionStatus: home.subscriptionStatus,
    billingPeriod: home.billingPeriod ?? "",
    billingAmount:
      home.billingAmountCents == null ? "" : toDollars(home.billingAmountCents),
    billingStartDate: home.billingStartDate
      ? home.billingStartDate.slice(0, 10)
      : "",
    subscriptionDueDate: home.subscriptionDueDate
      ? home.subscriptionDueDate.slice(0, 10)
      : "",
    discount: home.discount ?? "",
    howHeardAboutUs: home.howHeardAboutUs ?? "",
    adminNotes: home.adminNotes ?? "",
  };
}

/**
 * What saving the form sends. A cleared amount, period or date goes as null;
 * cleared text goes as "", which the API stores as nothing.
 */
export function customerRecordToSave(form: CustomerRecordForm) {
  const amount = form.billingAmount.trim();
  return {
    contactName: form.contactName.trim(),
    subscriptionPlan: form.subscriptionPlan.trim(),
    // Suspension is managed from the account section, not here: sending
    // "suspended" would be refused, and silently rewriting it to "trial"
    // would unsuspend a home by accident.
    ...(form.subscriptionStatus === "suspended"
      ? {}
      : { subscriptionStatus: form.subscriptionStatus }),
    billingPeriod: form.billingPeriod || null,
    billingAmountCents: amount ? toCents(amount) : null,
    billingStartDate: form.billingStartDate || null,
    subscriptionDueDate: form.subscriptionDueDate || null,
    discount: form.discount.trim(),
    howHeardAboutUs: form.howHeardAboutUs.trim(),
    adminNotes: form.adminNotes.trim(),
  };
}
