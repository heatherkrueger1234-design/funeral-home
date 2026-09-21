import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  caseBelongingsTable,
  caseDeletionsTable,
  caseDeadlinesTable,
  caseMessagesTable,
  casePhotosTable,
  casesTable,
  db,
  decedentDisplayName,
  familyContactsTable,
  obituaryDraftsTable,
  serviceSelectionsTable,
  uploadsTable,
  vitalStatisticsTable,
  type Case,
} from "@workspace/db";
import { decryptBuffer } from "@workspace/db/crypto";
import { DeleteCaseBody } from "@workspace/api-zod";
import { badRequest, HttpError, parseBody } from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { logger } from "../lib/logger";
import { ZipWriter } from "../lib/zip";
import { toVitalsJson, vitalsForCase } from "../lib/vitals";
import { loadCase } from "./cases";

const router: IRouter = Router();

/**
 * The two questions a funeral home's owner asks before signing, and neither
 * of them is about features.
 *
 * "What happens to our families' files if we stop paying you?" and "a family
 * has asked us to delete everything — can you?" A product that cannot answer
 * both is asking a business to put the only copy of a bereaved family's
 * photographs somewhere it can never get them back from.
 */

function stamp(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

/** A readable summary, so the archive means something without this software. */
function summarise(
  row: Case,
  contacts: Array<{ name: string; relationship: string | null; email: string | null; phone: string | null }>,
): string {
  const lines = [
    decedentDisplayName(row),
    "=".repeat(decedentDisplayName(row).length),
    "",
    row.kind === "pre_need"
      ? "A pre-need file: arrangements made in advance, by someone living."
      : "An at-need case.",
    "",
    `Case reference   ${row.id}`,
    `Opened           ${stamp(row.createdAt)}`,
    row.dateOfBirth ? `Born             ${stamp(row.dateOfBirth)}` : "",
    row.dateOfDeath ? `Died             ${stamp(row.dateOfDeath)}` : "",
    row.serviceAt ? `Service          ${row.serviceAt.toISOString()}` : "",
    row.serviceLocation ? `At               ${row.serviceLocation}` : "",
    `Status           ${row.status}`,
    row.closedAt ? `Closed           ${stamp(row.closedAt)}` : "",
    "",
    "The family",
    "----------",
    ...contacts.map(
      (c) =>
        `${c.name}${c.relationship ? ` (${c.relationship})` : ""}` +
        `${c.phone ? ` — ${c.phone}` : ""}${c.email ? ` — ${c.email}` : ""}`,
    ),
    "",
    row.serviceNotes ? "Notes\n-----\n" + row.serviceNotes : "",
    "",
    "What is in this folder",
    "----------------------",
    "photographs/   every photograph the family uploaded, at full size.",
    "               The numbered ones were chosen for the slideshow.",
    "documents/     anything else that was uploaded.",
    "obituary.txt   the obituary as it stood.",
    "selections.txt hymns, readings, pallbearers.",
    "belongings.txt clothing, jewellery and personal effects, with their",
    "               chain of custody.",
    "vitals.txt     what the death certificate needed. The social security",
    "               number is deliberately NOT included — see below.",
    "messages.txt   the thread between the home and the family.",
    "timeline.txt   what was due and what was done.",
    "",
    "About the social security number",
    "--------------------------------",
    "It is stored encrypted and is not written into this archive, because an",
    "archive gets emailed, copied to a laptop and left in a downloads folder.",
    "It remains readable in the application. If it is genuinely needed for",
    "filing, read it there.",
    "",
    `Exported ${new Date().toISOString()}`,
  ];

  return lines.filter((line) => line !== "").join("\n") + "\n";
}

function keyed(label: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  return `${label}: ${String(value)}`;
}

router.get("/cases/:caseId/export", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  /*
   * Note what is deliberately absent: a subscription check.
   *
   * Everywhere else, `canOpenCases` gates opening new work. Taking your own
   * data out is not new work, and a product that stops you exporting when you
   * cancel is holding a bereaved family's photographs to ransom. This must
   * keep working for a home that has already left.
   */

  const [contacts, photos, obituary, selections, belongings, deadlines, messages, vitals] =
    await Promise.all([
      db
        .select()
        .from(familyContactsTable)
        .where(eq(familyContactsTable.caseId, row.id))
        .orderBy(asc(familyContactsTable.createdAt)),
      db
        .select()
        .from(casePhotosTable)
        .where(
          and(
            eq(casePhotosTable.caseId, row.id),
            eq(casePhotosTable.funeralHomeId, home.id),
          ),
        )
        .orderBy(asc(casePhotosTable.position), asc(casePhotosTable.id)),
      db
        .select()
        .from(obituaryDraftsTable)
        .where(eq(obituaryDraftsTable.caseId, row.id))
        .limit(1),
      db
        .select()
        .from(serviceSelectionsTable)
        .where(eq(serviceSelectionsTable.caseId, row.id))
        .orderBy(asc(serviceSelectionsTable.id)),
      db
        .select()
        .from(caseBelongingsTable)
        .where(eq(caseBelongingsTable.caseId, row.id))
        .orderBy(asc(caseBelongingsTable.id)),
      db
        .select()
        .from(caseDeadlinesTable)
        .where(eq(caseDeadlinesTable.caseId, row.id))
        .orderBy(asc(caseDeadlinesTable.dueAt)),
      db
        .select()
        .from(caseMessagesTable)
        .where(eq(caseMessagesTable.caseId, row.id))
        .orderBy(asc(caseMessagesTable.createdAt)),
      vitalsForCase(row.id, home.id),
    ]);

  /*
   * Size the archive before answering, not during.
   *
   * This writer does not do ZIP64, so the whole archive has to fit in 4 GB. A
   * thousand photographs at full size can pass that. Discovering it half way
   * through a stream means the client has already had a 200 and keeps a
   * truncated file it thinks is a backup, so the check happens here where a
   * real status code is still possible.
   */
  const uploadIds = photos.map((p) => p.uploadId);
  const sizes = uploadIds.length
    ? await db
        .select({ id: uploadsTable.id, bytes: uploadsTable.sizeBytes })
        .from(uploadsTable)
        .where(eq(uploadsTable.caseId, row.id))
    : [];
  const totalBytes = sizes.reduce((sum, s) => sum + (s.bytes ?? 0), 0);

  const probe = new ZipWriter(res);
  if (probe.wouldOverflow(totalBytes, sizes.length + 8)) {
    throw new HttpError(
      413,
      "This case holds more than one archive can carry. Download the photo " +
        "pack and the rest separately, or ask for a hand splitting it.",
    );
  }

  const name = decedentDisplayName(row).replace(/[^a-zA-Z0-9]+/g, "-") || "case";
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${name}-${stamp(new Date())}.zip"`,
  );
  res.setHeader("X-Content-Type-Options", "nosniff");

  const zip = new ZipWriter(res);

  await zip.addFile("README.txt", Buffer.from(summarise(row, contacts), "utf8"));

  const draft = obituary[0];
  if (draft) {
    const text = Object.entries(draft)
      .filter(
        ([key]) =>
          !["id", "funeralHomeId", "caseId", "createdAt", "updatedAt"].includes(key),
      )
      .map(([key, value]) => keyed(key, value))
      .filter(Boolean)
      .join("\n");
    await zip.addFile("obituary.txt", Buffer.from(text + "\n", "utf8"));
  }

  await zip.addFile(
    "selections.txt",
    Buffer.from(
      selections
        .map(
          (s) =>
            `[${s.kind}] ${s.value}` +
            (s.attribution ? ` — ${s.attribution}` : "") +
            (s.notes ? `\n    ${s.notes}` : ""),
        )
        .join("\n") + "\n",
      "utf8",
    ),
  );

  await zip.addFile(
    "belongings.txt",
    Buffer.from(
      belongings
        .map(
          (b) =>
            `${b.description} (${b.kind}) — ${b.status}` +
            (b.disposition ? `, ${b.disposition}` : "") +
            (b.receivedAt ? `\n    received ${stamp(b.receivedAt)}` : "") +
            (b.returnedAt
              ? `\n    returned ${stamp(b.returnedAt)}` +
                (b.returnedToName ? ` to ${b.returnedToName}` : "")
              : "") +
            (b.notes ? `\n    ${b.notes}` : ""),
        )
        .join("\n") + "\n",
      "utf8",
    ),
  );

  await zip.addFile(
    "timeline.txt",
    Buffer.from(
      deadlines
        .map(
          (d) =>
            `${d.dueAt.toISOString().slice(0, 16).replace("T", " ")}  ` +
            `${d.completedAt ? "[done]" : "[    ]"} ${d.title}`,
        )
        .join("\n") + "\n",
      "utf8",
    ),
  );

  await zip.addFile(
    "messages.txt",
    Buffer.from(
      messages
        .map((m) => {
          // Who said it, without needing a join: a message has either a staff
          // author or a family one, never both.
          const who = m.authorUserId !== null ? "funeral home" : "family";
          return `${m.createdAt.toISOString()}  ${who}\n${m.body}\n`;
        })
        .join("\n") + "\n",
      "utf8",
    ),
  );

  /*
   * Vitals go in without the social security number. `toVitalsJson` returns it
   * masked, which is exactly what is wanted here — an archive is emailed,
   * copied to a laptop, and left in a downloads folder, and a number that
   * opens a person's credit file does not belong in one.
   */
  const vitalsJson = await toVitalsJson(vitals);
  await zip.addFile(
    "vitals.txt",
    Buffer.from(
      Object.entries(vitalsJson)
        .map(([key, value]) => keyed(key, value))
        .filter(Boolean)
        .join("\n") + "\n",
      "utf8",
    ),
  );

  let selectedIndex = 0;
  const captions: string[] = [];

  for (const photo of photos) {
    const [upload] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, photo.uploadId))
      .limit(1);

    if (!upload) continue;

    let bytes: Buffer;
    try {
      bytes = decryptBuffer(upload.data);
    } catch (err) {
      // One unreadable file must not abort an export the home is relying on.
      logger.error({ err, uploadId: upload.id }, "Could not decrypt for export");
      captions.push(`[a photograph could not be read: upload ${upload.id}]`);
      continue;
    }

    const extension = upload.filename.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".jpg";
    const base = photo.selected
      ? `${String(++selectedIndex).padStart(3, "0")}`
      : `unselected-${photo.id}`;

    await zip.addFile(`photographs/${base}${extension}`, bytes, upload.createdAt);
    if (photo.caption) captions.push(`${base}${extension}  ${photo.caption}`);
  }

  if (captions.length > 0) {
    await zip.addFile(
      "photographs/captions.txt",
      Buffer.from(captions.join("\n") + "\n", "utf8"),
    );
  }

  await zip.finish();
  res.end();
});

/**
 * Erase a case, for real.
 *
 * Every table that carries a `caseId` cascades from this row, so one delete
 * takes the photographs, the messages, the obituary, the belongings and the
 * encrypted social security number with it.
 */
router.post("/cases/:caseId/delete", async (req, res) => {
  const user = currentUser(req);
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  const body = parseBody(DeleteCaseBody, req.body);

  const expected = decedentDisplayName(row).trim().toLowerCase();
  const given = body.confirmName.trim().toLowerCase();

  if (expected !== given) {
    /*
     * Typed, not clicked. This destroys the only copy of a family's
     * photographs of their mother that exists anywhere, and a confirmation
     * dialog with an "OK" button is something a tired person dismisses
     * without reading.
     */
    throw badRequest(
      `To erase this case, type the name exactly as it appears: ${decedentDisplayName(row)}`,
    );
  }

  await db.transaction(async (tx) => {
    // The tombstone first, inside the same transaction, so there is never a
    // moment where the case is gone and no record says anybody meant it.
    await tx.insert(caseDeletionsTable).values({
      funeralHomeId: home.id,
      formerCaseId: row.id,
      deletedByUserId: user.id,
      deletedByName: user.displayName ?? user.email,
      reason: body.reason?.trim() || null,
    });

    await tx.delete(casesTable).where(eq(casesTable.id, row.id));
  });

  logger.warn(
    { caseId: row.id, homeId: home.id, userId: user.id },
    "A case was permanently erased",
  );

  res.status(204).end();
});

export default router;
