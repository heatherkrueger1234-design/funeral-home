import type { HomeLicensure } from "@/lib/api";

/** The registered services, typed as one line: one per comma. */
export function splitServices(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** A home's DORA registration as its edit form holds it. */
export type RegistrationForm = {
  doraRegistrationNumber: string;
  /** Comma-separated, as written on the registration. */
  registeredServices: string;
  designeeName: string;
  designeeTitle: string;
  beganBusinessOn: string;
  registrationRenewsOn: string;
  servicesChangedOn: string;
  amendmentFiledOn: string;
  notes: string;
};

export function registrationForm(
  licensure: HomeLicensure | null,
): RegistrationForm {
  return {
    doraRegistrationNumber: licensure?.doraRegistrationNumber ?? "",
    registeredServices: (licensure?.registeredServices ?? []).join(", "),
    designeeName: licensure?.designeeName ?? "",
    designeeTitle: licensure?.designeeTitle ?? "",
    beganBusinessOn: licensure?.beganBusinessOn ?? "",
    registrationRenewsOn: licensure?.registrationRenewsOn ?? "",
    servicesChangedOn: licensure?.servicesChangedOn ?? "",
    amendmentFiledOn: licensure?.amendmentFiledOn ?? "",
    notes: licensure?.notes ?? "",
  };
}

/**
 * What saving the registration sends. A cleared field goes as null, never
 * as "": the API refuses an empty date, and a cleared "Amendment filed" --
 * the date that stops the thirty-day clock -- has to be savable.
 */
export function registrationToSave(
  form: RegistrationForm,
): Partial<HomeLicensure> {
  return {
    doraRegistrationNumber: form.doraRegistrationNumber.trim() || null,
    registeredServices: splitServices(form.registeredServices),
    designeeName: form.designeeName.trim() || null,
    designeeTitle: form.designeeTitle.trim() || null,
    beganBusinessOn: form.beganBusinessOn || null,
    registrationRenewsOn: form.registrationRenewsOn || null,
    servicesChangedOn: form.servicesChangedOn || null,
    amendmentFiledOn: form.amendmentFiledOn || null,
    notes: form.notes.trim() || null,
  };
}
