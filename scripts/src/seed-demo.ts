/**
 * Put a realistic case into a database, for demos and for the backup drill.
 *
 *   pnpm --filter @workspace/scripts run seed-demo
 *   pnpm --filter @workspace/scripts run seed-demo -- --quiet
 *
 * Two jobs. It gives a new deployment something to look at other than an
 * empty case list, and it gives the backup drill something worth losing —
 * verifying that a backup of an empty database restores proves nothing.
 *
 * The data is obviously invented: a fictional home, a fictional family, and
 * a generated photograph rather than anybody's. Nothing here should ever be
 * mistaken for a real case, so the names say so.
 */
import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  funeralHomesTable,
  usersTable,
  casesTable,
  familyContactsTable,
  uploadsTable,
  casePhotosTable,
  obituaryDraftsTable,
  caseDeadlinesTable,
  caseMessagesTable,
  vitalStatisticsTable,
  caseBelongingsTable,
  TRIAL_DAYS,
} from "@workspace/db";
import { encryptBuffer, encrypt } from "@workspace/db/crypto";

const quiet = process.argv.includes("--quiet");
const say = (message: string) => {
  if (!quiet) console.log(message);
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * A valid PNG, generated rather than checked in.
 *
 * Deliberately not a real photograph of a real person: this ends up in demo
 * databases and screenshots, and using somebody's actual picture of a
 * relative — even a stock one — for a fictional dead person is not a thing
 * to do casually.
 */
function placeholderPng(): Buffer {
  const header = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  // Padded so the drill moves a realistic number of bytes through pg_dump's
  // bytea encoding, which is where a dump would break if it were going to.
  return Buffer.concat([header, randomBytes(48 * 1024)]);
}

async function main(): Promise<void> {
  const [home] = await db
    .insert(funeralHomesTable)
    .values({
      name: "Willowbank Funeral Home (demo)",
      slug: `willowbank-demo-${Date.now()}`,
      accentColor: "#1f4e46",
      phone: "(555) 010-0100",
      urgentPhone: "(555) 010-0199",
      city: "Denver",
      region: "CO",
      postalCode: "80202",
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * DAY),
    })
    .returning();

  await db.insert(usersTable).values({
    funeralHomeId: home!.id,
    email: `demo-${home!.id}@example.com`,
    // No password: this account cannot be signed into, which is the point.
    passwordHash: null,
    displayName: "Karen Voss",
    title: "Funeral Director",
    role: "owner",
  });

  const serviceAt = new Date(Date.now() + 5 * DAY);

  const [row] = await db
    .insert(casesTable)
    .values({
      funeralHomeId: home!.id,
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
      decedentPreferredName: "Peggy",
      dateOfBirth: new Date("1938-03-04"),
      dateOfDeath: new Date(Date.now() - 2 * DAY),
      serviceAt,
      serviceLocation: "St Mary's Chapel",
      postalCode: "80202",
      status: "active",
    })
    .returning();

  const [contact] = await db
    .insert(familyContactsTable)
    .values({
      funeralHomeId: home!.id,
      caseId: row!.id,
      name: "Anne Hale",
      relationship: "Daughter",
      phone: "(555) 010-0142",
      email: "anne@example.com",
      role: "next_of_kin",
      canInvite: true,
      // A digest of a token nobody holds: the demo link is not openable.
      tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      expiresAt: new Date(Date.now() + 90 * DAY),
    })
    .returning();

  const photo = placeholderPng();

  const [upload] = await db
    .insert(uploadsTable)
    .values({
      funeralHomeId: home!.id,
      caseId: row!.id,
      uploadedByContactId: contact!.id,
      filename: "peggy.png",
      mimeType: "image/png",
      sizeBytes: photo.length,
      data: encryptBuffer(photo),
    })
    .returning();

  const [casePhoto] = await db
    .insert(casePhotosTable)
    .values({
      funeralHomeId: home!.id,
      caseId: row!.id,
      uploadId: upload!.id,
      uploadedByContactId: contact!.id,
      caption: "Mum at Skegness, 1974",
      selected: true,
    })
    .returning();

  await db
    .update(casesTable)
    .set({ portraitPhotoId: casePhoto!.id })
    .where(eq(casesTable.id, row!.id));

  await db.insert(obituaryDraftsTable).values({
    funeralHomeId: home!.id,
    caseId: row!.id,
    fullName: "Margaret Ellen Hale",
    bornOn: "4 March 1938",
    survivedBy: "her daughters Anne and Judith, and six grandchildren",
    status: "submitted",
    submittedAt: new Date(),
  });

  await db.insert(caseDeadlinesTable).values([
    {
      funeralHomeId: home!.id,
      caseId: row!.id,
      title: "Bring clothing to the funeral home",
      dueAt: new Date(serviceAt.getTime() - 3 * DAY),
    },
    {
      funeralHomeId: home!.id,
      caseId: row!.id,
      title: "The service",
      dueAt: serviceAt,
      isEvent: true,
    },
  ]);

  await db.insert(caseMessagesTable).values({
    funeralHomeId: home!.id,
    caseId: row!.id,
    authorContactId: contact!.id,
    body: "What time does the florist arrive?",
  });

  await db.insert(caseBelongingsTable).values({
    funeralHomeId: home!.id,
    caseId: row!.id,
    kind: "jewellery",
    description: "Gold wedding ring, worn thin",
    disposition: "return_to_family",
  });

  await db.insert(vitalStatisticsTable).values({
    funeralHomeId: home!.id,
    caseId: row!.id,
    legalFirstName: "Margaret",
    legalLastName: "Hale",
    motherMaidenName: "Braithwaite",
    // Encrypted like the real thing, so the drill exercises that path.
    socialSecurityNumber: encrypt("123456789"),
  });

  say(`Seeded demo case ${row!.id} at "${home!.name}" (home ${home!.id}).`);
  say("Nothing here is real. The demo account has no password and cannot sign in.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
