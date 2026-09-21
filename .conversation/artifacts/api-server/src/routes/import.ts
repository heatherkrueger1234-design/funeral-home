import { Router, type IRouter } from "express";
import multer from "multer";
import { and, eq, ilike, ne } from "drizzle-orm";
import {
  db,
  casesTable,
  familyContactsTable,
  obituaryDraftsTable,
} from "@workspace/db";
import { badRequest } from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import {
  guessMapping,
  normaliseHeader,
  parseCsv,
  parseDate,
  COLUMN_ALIASES,
  type CsvRow,
} from "../lib/csv";
import { linkUrl, mintLink } from "../lib/family-link";
import { applyTemplateToCase } from "../lib/timeline";

/**
 * Importing cases a home already has somewhere else.
 *
 * The adoption problem this solves is unglamorous and fatal: homes run
 * Passare, Osiris, FDMS or SRS, and if a director has to type the decedent's
 * name into their case system *and* into this one, the second one gets
 * dropped within a fortnight however good the family portal is. Nobody
 * double-keys for long.
 *
 * Two endpoints rather than one, because the failure mode of a bad import is
 * two hundred wrong cases and no undo. The preview shows the guessed column
 * mapping, the first rows as they would be created, and every problem found —
 * so a director confirms the dates parsed and the names landed in the right
 * columns before anything is written.
 */

const router: IRouter = Router();

/** CSV exports are text; a few megabytes is a very large one. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

type Issue = { row: number; message: string };

type Candidate = {
  row: number;
  decedentFirstName: string;
  decedentLastName: string;
  decedentPreferredName: string | null;
  dateOfBirth: Date | null;
  dateOfDeath: Date | null;
  serviceAt: Date | null;
  serviceLocation: string | null;
  postalCode: string | null;
  contactName: string | null;
  contactRelationship: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

function readCsv(file: Express.Multer.File | undefined) {
  if (!file?.buffer?.length) {
    throw badRequest("Please choose a CSV file.");
  }

  const parsed = parseCsv(file.buffer.toString("utf8"));

  if (parsed.headers.length === 0) {
    throw badRequest("That file has no header row.");
  }

  if (parsed.rows.length === 0) {
    throw badRequest("That file has a header row but no cases in it.");
  }

  return parsed;
}

/**
 * Turn rows into candidates, collecting problems rather than throwing.
 *
 * One malformed row in a two-hundred-row export must not stop the other
 * hundred and ninety-nine: the director gets the cases and a list of the
 * rows that need looking at.
 */
function buildCandidates(
  rows: CsvRow[],
  mapping: Record<string, string | null>,
): { candidates: Candidate[]; issues: Issue[] } {
  const candidates: Candidate[] = [];
  const issues: Issue[] = [];

  const get = (row: CsvRow, field: string): string => {
    const header = mapping[field];
    if (!header) return "";
    return row[normaliseHeader(header)] ?? "";
  };

  rows.forEach((row, index) => {
    // Line number in the file, so "row 34" means what a spreadsheet shows.
    const lineNumber = index + 2;

    const first = get(row, "decedentFirstName").trim();
    const last = get(row, "decedentLastName").trim();

    if (!first && !last) {
      // A genuinely empty row is Excel padding, not a problem to report.
      const anyValue = Object.values(row).some((value) => value !== "");
      if (anyValue) {
        issues.push({ row: lineNumber, message: "No name in this row." });
      }
      return;
    }

    if (!last) {
      issues.push({ row: lineNumber, message: "No last name." });
      return;
    }

    const readDate = (field: string, label: string): Date | null => {
      const raw = get(row, field);
      if (!raw.trim()) return null;

      const parsed = parseDate(raw);
      if (!parsed) {
        // Reported, not fatal. An unparseable service date leaves the case
        // undated, which a director notices; a date read as the wrong month
        // is a family told the wrong day.
        issues.push({
          row: lineNumber,
          message: `Couldn't read the ${label} "${raw}" — left blank.`,
        });
      }
      return parsed;
    };

    candidates.push({
      row: lineNumber,
      decedentFirstName: first || last,
      decedentLastName: last,
      decedentPreferredName: get(row, "decedentPreferredName").trim() || null,
      dateOfBirth: readDate("dateOfBirth", "date of birth"),
      dateOfDeath: readDate("dateOfDeath", "date of death"),
      serviceAt: readDate("serviceAt", "service date"),
      serviceLocation: get(row, "serviceLocation").trim() || null,
      postalCode: get(row, "postalCode").replace(/\D/g, "").slice(0, 5) || null,
      contactName: get(row, "contactName").trim() || null,
      contactRelationship: get(row, "contactRelationship").trim() || null,
      contactPhone: get(row, "contactPhone").trim() || null,
      contactEmail: get(row, "contactEmail").trim() || null,
    });
  });

  return { candidates, issues };
}

/**
 * Whether this person already has an open case here.
 *
 * Matched on name rather than any id, because the export has no id of ours.
 * Closed cases are ignored: a home that buries two people with the same name
 * in different years should get two cases, and re-importing today's export
 * twice should not.
 */
async function findDuplicate(
  candidate: Candidate,
  funeralHomeId: number,
): Promise<number | null> {
  const [existing] = await db
    .select({ id: casesTable.id })
    .from(casesTable)
    .where(
      and(
        eq(casesTable.funeralHomeId, funeralHomeId),
        ilike(casesTable.decedentFirstName, candidate.decedentFirstName),
        ilike(casesTable.decedentLastName, candidate.decedentLastName),
        ne(casesTable.status, "closed"),
      ),
    )
    .limit(1);

  return existing?.id ?? null;
}

router.post(
  "/cases/import/preview",
  upload.single("file"),
  async (req, res) => {
    const home = tenant(req);
    const parsed = readCsv(req.file);
    const mapping = guessMapping(parsed.headers);
    const { candidates, issues } = buildCandidates(parsed.rows, mapping);

    const mappedHeaders = new Set(
      Object.values(mapping).filter((header): header is string => header !== null),
    );

    const rows = [];
    let duplicates = 0;

    // Only the first twenty are previewed: the point is to confirm the
    // columns landed correctly, which is obvious after a handful.
    for (const candidate of candidates) {
      const duplicate = (await findDuplicate(candidate, home.id)) !== null;
      if (duplicate) duplicates += 1;

      if (rows.length < 20) {
        rows.push({
          row: candidate.row,
          decedentName: `${candidate.decedentPreferredName ?? candidate.decedentFirstName} ${candidate.decedentLastName}`.trim(),
          serviceAt: candidate.serviceAt,
          contactName: candidate.contactName,
          contactPhone: candidate.contactPhone,
          duplicate,
        });
      }
    }

    if (!mapping["decedentLastName"]) {
      issues.unshift({
        row: 1,
        message:
          "No last-name column recognised. Rename it to \"Last Name\" and try again.",
      });
    }

    res.json({
      headers: parsed.headers,
      mapping,
      unmapped: parsed.headers.filter((header) => !mappedHeaders.has(header)),
      totalRows: parsed.rows.length,
      wouldCreate: candidates.length - duplicates,
      wouldSkip: duplicates,
      rows,
      issues,
    });
  },
);

router.post("/cases/import", upload.single("file"), async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const parsed = readCsv(req.file);
  const mapping = guessMapping(parsed.headers);

  if (!mapping["decedentLastName"]) {
    throw badRequest(
      'No last-name column recognised. Rename it to "Last Name" and try again.',
    );
  }

  const { candidates, issues } = buildCandidates(parsed.rows, mapping);

  const caseIds: number[] = [];
  let skipped = 0;

  for (const candidate of candidates) {
    if (await findDuplicate(candidate, home.id)) {
      skipped += 1;
      continue;
    }

    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(casesTable)
          .values({
            funeralHomeId: home.id,
            decedentFirstName: candidate.decedentFirstName,
            decedentLastName: candidate.decedentLastName,
            decedentPreferredName: candidate.decedentPreferredName,
            dateOfBirth: candidate.dateOfBirth,
            dateOfDeath: candidate.dateOfDeath,
            serviceAt: candidate.serviceAt,
            serviceLocation: candidate.serviceLocation,
            postalCode: candidate.postalCode,
            createdByUserId: user.id,
          })
          .returning();

        await tx.insert(obituaryDraftsTable).values({
          funeralHomeId: home.id,
          caseId: row!.id,
          fullName: `${row!.decedentFirstName} ${row!.decedentLastName}`.trim(),
        });

        /*
         * A contact is created but no link is sent. The import is a bulk
         * action over a file; texting twenty grieving families because
         * somebody dropped in a spreadsheet is not something to do as a side
         * effect. The director sends each one deliberately.
         */
        if (candidate.contactName) {
          const link = mintLink();

          await tx.insert(familyContactsTable).values({
            funeralHomeId: home.id,
            caseId: row!.id,
            name: candidate.contactName,
            relationship: candidate.contactRelationship,
            phone: candidate.contactPhone,
            email: candidate.contactEmail,
            role: "next_of_kin",
            canInvite: true,
            tokenHash: link.tokenHash,
            expiresAt: link.expiresAt,
            invitedByUserId: user.id,
          });
          void linkUrl;
        }

        return row!;
      });

      if (created.serviceAt) {
        await applyTemplateToCase(created);
      }

      caseIds.push(created.id);
    } catch (error) {
      issues.push({
        row: candidate.row,
        message:
          error instanceof Error
            ? `Could not create this case: ${error.message}`
            : "Could not create this case.",
      });
    }
  }

  void COLUMN_ALIASES;

  res.json({ created: caseIds.length, skipped, issues, caseIds });
});

export default router;
