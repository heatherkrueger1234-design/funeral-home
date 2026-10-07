import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, casesTable, familyContactsTable, usersTable } from "@workspace/db";
import { toCsv } from "../lib/csv";
import { tenant } from "../middleware/require-auth";
import { caseListExportRateLimit } from "../middleware/rate-limit";

/**
 * Every case as one CSV, for moving to (or feeding) another case system.
 *
 * The column names are the ones our own importer recognises, so the file
 * round-trips, and the ones Passare/Osiris-style imports usually ask for.
 * No social security numbers, no vital statistics, no photographs: that is
 * what the per-case export is for.
 */
const router: IRouter = Router();

const HEADERS = [
  "Case Number",
  "Status",
  "Kind",
  "First Name",
  "Last Name",
  "Preferred Name",
  "Date of Birth",
  "Date of Death",
  "Service Date",
  "Service Location",
  "Zip",
  "Next of Kin",
  "Relationship",
  "Phone",
  "Email",
  "Director",
  "Opened",
  "Closed",
];

const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "");

/** "2026-09-18 13:00" in the home's own zone. */
function localMoment(value: Date | null, timeZone: string): string {
  if (!value) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  );
  return `${parts["year"]}-${parts["month"]}-${parts["day"]} ${parts["hour"]}:${parts["minute"]}`;
}

// Counted before the handler, so a refused request never walks the cases.
router.use("/export/cases.csv", (req, res, next) =>
  req.method === "GET" ? caseListExportRateLimit(req, res, next) : next(),
);
router.get("/export/cases.csv", async (req, res) => {
  const home = tenant(req);
  const zone = (() => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: home.timezone });
      return home.timezone;
    } catch {
      return "America/Denver";
    }
  })();

  const cases = await db
    .select({ row: casesTable, director: usersTable.displayName })
    .from(casesTable)
    .leftJoin(usersTable, eq(usersTable.id, casesTable.leadDirectorId))
    .where(eq(casesTable.funeralHomeId, home.id))
    .orderBy(asc(casesTable.createdAt));

  const ids = cases.map(({ row }) => row.id);
  const contacts = ids.length
    ? await db
        .select()
        .from(familyContactsTable)
        .where(
          and(
            eq(familyContactsTable.funeralHomeId, home.id),
            inArray(familyContactsTable.caseId, ids),
          ),
        )
        .orderBy(asc(familyContactsTable.createdAt))
    : [];

  // The first next of kin, else the first person added.
  const kin = new Map<number, (typeof contacts)[number]>();
  for (const contact of contacts) {
    const current = kin.get(contact.caseId);
    if (!current || (current.role !== "next_of_kin" && contact.role === "next_of_kin")) {
      kin.set(contact.caseId, contact);
    }
  }

  const rows = cases.map(({ row, director }) => {
    const contact = kin.get(row.id);
    return [
      row.id,
      row.status,
      row.kind,
      row.decedentFirstName,
      row.decedentLastName,
      row.decedentPreferredName,
      day(row.dateOfBirth),
      day(row.dateOfDeath),
      localMoment(row.serviceAt, zone),
      row.serviceLocation,
      row.postalCode,
      contact?.name,
      contact?.relationship,
      contact?.phone,
      contact?.email,
      director,
      day(row.createdAt),
      day(row.closedAt),
    ];
  });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cases-${stamp}.csv"`);
  res.send(toCsv(HEADERS, rows));
});

export default router;
