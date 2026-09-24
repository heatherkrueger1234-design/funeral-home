import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * This console's way of talking to the API.
 *
 * Every other frontend here uses the react-query hooks generated from
 * `lib/api-spec/openapi.yaml`. This one does not, and the original reason has
 * expired: the plan was to split the spec into one file per domain first, and
 * that split was abandoned — the spec is still one 7,000-line file.
 *
 * So this stays hand-typed against `routes/admin.ts` until somebody adds the
 * admin paths to the shared spec, which is a conflict-prone edit worth doing
 * deliberately rather than in passing. The types below are the contract that
 * generated client would have to produce, so the swap is mechanical when it
 * happens. Until then: change a type here and in `routes/admin.ts` together,
 * because nothing checks that they agree.
 */

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const BASE = "/api";

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      // The session is an httpOnly cookie, so it only travels when asked for.
      credentials: "include",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // The browser's own words for this are "Failed to fetch", which is what
    // every error card on the page used to say when the wifi dropped.
    throw new ApiError(0, OFFLINE);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A proxy's HTML error page during a deploy, not the API. Reading it as
    // JSON threw "Unexpected token '<'" into the middle of the screen.
    parsed = null;
  }

  if (!response.ok) {
    throw new ApiError(response.status, sayWhatWentWrong(response.status, parsed));
  }

  return parsed as T;
}

const OFFLINE =
  "The server could not be reached. Please check your connection and try again.";

/**
 * The API's own sentence where it wrote one for a person, and ours where it
 * did not. The validator's "Invalid request body" and the handler's "Internal
 * server error" are words for a log, not for somebody on the phone to a home.
 */
function sayWhatWentWrong(status: number, parsed: unknown): string {
  const message = (parsed as { error?: unknown } | null)?.error;

  if (status >= 500 || typeof message !== "string") {
    return "Something went wrong on our side. Please try again in a moment.";
  }
  if (message === "Invalid request body" || message === "Invalid query parameters") {
    return "Something in that could not be saved as written. Please check each field and try again.";
  }
  return message;
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => call<T>("PUT", path, body ?? {}),
  delete: <T>(path: string) => call<T>("DELETE", path),
};

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** A 403 here means "you are signed in, and this is not yours". */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

/* ------------------------------------------------------------- the shapes */

export type Engagement = {
  casesOpened: number;
  casesActive: number;
  familyLinksCreated: number;
  familyLinksOpened: number;
  photographs: number;
  aftercareEnrolled: number;
  aftercareConsented: number;
  aftercareDeclined: number;
  aftercareUnsubscribed: number;
};

/** A home without its engagement counts: `toAdminHome` on its own. */
export type AdminHomeSummary = {
  id: number;
  name: string;
  slug: string;
  city: string | null;
  region: string | null;
  phone: string | null;
  timezone: string;
  accentColor: string;
  subscriptionStatus: string;
  trialDaysLeft: number | null;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  /** Set when a group's contract pays for this home. */
  groupId: number | null;
  canOpenCases: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  internalAccount: boolean;
  onboardingDone: string[];
  createdAt: string;
};

export type AdminHome = AdminHomeSummary & { engagement: Engagement };

/**
 * The account states the homes list can be filtered by, in the words the
 * list itself uses -- see `describeAccount`. "Suspended" wins over the
 * subscription, on the server as here.
 */
export const HOME_STATUSES = [
  "trial",
  "active",
  "past_due",
  "canceled",
  "suspended",
] as const;
export type HomeStatus = (typeof HOME_STATUSES)[number];

export const HOME_STATUS_LABELS: Record<HomeStatus, string> = {
  trial: "On trial",
  active: "Subscribed",
  past_due: "Payment outstanding",
  canceled: "Subscription ended",
  suspended: "Suspended",
};

/** Staff roles, as a person would say them. The keys are the database's. */
export const STAFF_ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  director: "Funeral director",
  staff: "Staff",
};

export type ReminderStanding = "settled" | "ahead" | "soon" | "passed";

export type LicensureReminder = {
  key: string;
  summary: string;
  detail: string;
  standing: ReminderStanding;
};

export type HomeLicensure = {
  doraRegistrationNumber: string | null;
  registeredServices: string[];
  designeeName: string | null;
  designeeTitle: string | null;
  beganBusinessOn: string | null;
  registrationRenewsOn: string | null;
  servicesChangedOn: string | null;
  amendmentFiledOn: string | null;
  notes: string | null;
};

export const PRACTITIONER_ROLES = [
  "mortuary_science_practitioner",
  "funeral_director",
  "embalmer",
  "cremationist",
  "natural_reductionist",
] as const;
export type PractitionerRole = (typeof PRACTITIONER_ROLES)[number];

/** US spelling: these are American funeral homes and an American reader. */
export const PRACTITIONER_ROLE_LABELS: Record<PractitionerRole, string> = {
  mortuary_science_practitioner: "Mortuary science practitioner",
  funeral_director: "Funeral director",
  embalmer: "Embalmer",
  cremationist: "Cremationist",
  natural_reductionist: "Natural reductionist",
};

export const LICENCE_STANDINGS = [
  "not_applied",
  "applied",
  "provisional",
  "held",
] as const;
export type LicenceStanding = (typeof LICENCE_STANDINGS)[number];

export const LICENCE_STANDING_LABELS: Record<LicenceStanding, string> = {
  not_applied: "Not applied for yet",
  applied: "Application in",
  provisional: "Provisional license",
  held: "Licensed",
};

export type Practitioner = {
  id: number;
  personName: string;
  role: PractitionerRole;
  standing: LicenceStanding;
  licenceNumber: string | null;
  expiresOn: string | null;
};

export type HomeStaff = {
  id: number;
  displayName: string | null;
  title: string | null;
  role: string;
  deactivatedAt: string | null;
  /** False until they have finished their invitation and chosen one. */
  hasPassword: boolean;
  emailVerified: boolean;
};

export type AdminHomeDetail = AdminHome & {
  /** The covering group's name; the same as `group?.name`. */
  groupName: string | null;
  group: { id: number; name: string } | null;
  licensure: HomeLicensure | null;
  practitioners: Practitioner[];
  reminders: LicensureReminder[];
  staff: HomeStaff[];
};

export type PlatformOverview = {
  homes: {
    homes: number;
    suspended: number;
    paying: number;
    onTrial: number;
    pastDue: number;
    canceled: number;
  };
  engagement: {
    casesOpened: number;
    familyLinksCreated: number;
    familyLinksOpened: number;
    photographs: number;
    aftercareEnrolled: number;
    aftercareConsented: number;
  };
  attention: Array<{ home: AdminHomeSummary; reminders: LicensureReminder[] }>;
  /** On trial, not suspended, ending within seven days; soonest first. */
  trialsEndingSoon: AdminHomeSummary[];
  /** On trial and ending within a fortnight, or ended within the month. */
  trials: Array<{ home: AdminHomeSummary; trialEndsAt: string }>;
  /** One plain sentence each; see the overview route for the three reasons. */
  quiet: Array<{
    home: AdminHomeSummary;
    reason: string;
    /** Set only when the reason is a month without a case. */
    lastCaseAt: string | null;
  }>;
  delivery: {
    mailConfigured: boolean;
    smsConfigured: boolean;
    aftercareFailedLast30Days: number;
    homesWithFailures: number;
    lastFailureAt: string | null;
  };
};

export type PlatformAdmin = {
  id: number;
  email: string;
  displayName: string | null;
  note: string | null;
  addedByEmail: string | null;
  revokedAt: string | null;
  revokedByEmail: string | null;
  createdAt: string;
};

export type AdminGroup = {
  id: number;
  name: string;
  slug: string;
  locations: number;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  hasSubscription: boolean;
  entitlements: string[];
  createdAt: string;
};

/**
 * On the detail, `locations` is the list itself rather than the count the
 * list endpoint gives -- the route spreads the summary and then overwrites
 * that one key. Typing it as both is how "[object Object] locations" reached
 * the screen.
 */
export type AdminGroupDetail = Omit<AdminGroup, "locations"> & {
  billingConfigured: boolean;
  addOns: Array<{ key: string; title: string; detail: string; included: boolean }>;
  /** Locations carry no engagement here; the group page is about the contract. */
  locations: AdminHomeSummary[];
};

export type AuditEntry = {
  id: number;
  actorEmail: string;
  action: string;
  subjectHomeId: number | null;
  subjectHomeName: string | null;
  detail: string | null;
  createdAt: string;
};

/* -------------------------------------------------------------- the words */

/**
 * Dates, written the way a person writes them.
 *
 * `2027-06-30` arrives as a plain calendar date with no timezone, and is
 * parsed as one: `new Date("2027-06-30")` is midnight UTC, which in Denver is
 * the evening of the 29th, and a renewal date that renders a day early is a
 * phone call nobody wants to have.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";

  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;

  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The day an *instant* falls on, where the reader is.
 *
 * Not `formatDate`: a trial end is a moment (`2026-10-01T03:00:00Z`), not a
 * calendar date, and cutting the first ten characters off it gives the day
 * in Greenwich -- which for a trial ending in the Denver evening is the day
 * after the one the owner will actually be refused a case on.
 */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const bare = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value);
  const parsed = new Date(bare ? `${value.replace(" ", "T")}Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    // The access log is shown to a home's insurer, who may not be in the
    // same timezone as whoever printed it.
    timeZoneName: "short",
  });
}

/** "1 home", "3 homes". Every count on these screens goes through it. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/** How a contract is doing, for a home or a group, in a phrase. */
export function describeSubscription(status: string): string {
  if (status === "trial") return "On trial";
  if (status === "active") return "Subscribed";
  if (status === "past_due") return "Payment outstanding";
  return "Subscription ended";
}

/** A group's contract in a phrase, with the one date that matters next. */
export function describeContract(
  group: Pick<AdminGroup, "subscriptionStatus" | "trialEndsAt" | "currentPeriodEndsAt">,
): string {
  const status = describeSubscription(group.subscriptionStatus);

  if (group.subscriptionStatus === "trial" && group.trialEndsAt) {
    return `${status} until ${formatDate(group.trialEndsAt)}`;
  }
  if (group.subscriptionStatus === "active" && group.currentPeriodEndsAt) {
    return `${status}, renews ${formatDate(group.currentPeriodEndsAt)}`;
  }
  return status;
}

/** How the account is doing, in a phrase rather than a status chip. */
export function describeAccount(
  home: Pick<AdminHomeSummary, "suspendedAt" | "subscriptionStatus" | "trialDaysLeft">,
): string {
  if (home.suspendedAt) return "Suspended";
  if (home.subscriptionStatus === "trial") {
    return home.trialDaysLeft === null
      ? "On trial"
      : home.trialDaysLeft === 0
        ? "Trial finished"
        : `On trial, ${plural(home.trialDaysLeft, "day")} left`;
  }
  return describeSubscription(home.subscriptionStatus);
}


/** What the log line says, in English. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "homes.list": "Listed the homes",
  "home.open": "Opened a home",
  "home.create": "Created a home",
  "home.suspend": "Suspended a home",
  "home.restore": "Lifted a suspension",
  "home.licensure.update": "Updated licensure",
  "home.practitioner.update": "Updated a practitioner",
  "platform.overview": "Opened the overview",
  // Every action the server can write. A label missing here used to show the
  // raw key -- "platform.admin.grant" -- on the page shown to an insurer.
  "home.internal.update": "Changed whether a home is ours",
  "home.group.update": "Moved a home between groups",
  "home.staff.reset": "Emailed a director a password reset",
  "home.owner.invite": "Invited an owner",
  "home.trial.extend": "Extended a trial",
  "group.list": "Listed the groups",
  "group.create": "Created a group",
  "group.open": "Opened a group",
  "group.checkout": "Started a group's subscription",
  "platform.admins.list": "Looked at who has access",
  "platform.admin.grant": "Gave someone access",
  "platform.admin.revoke": "Took someone's access away",
};
