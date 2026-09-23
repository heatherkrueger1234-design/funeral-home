/**
 * A demo account that looks like a finished one.
 *
 *   pnpm --filter @workspace/scripts run seed-showcase
 *
 * Different from `seed-demo`, which exists to give the backup drill something
 * worth losing and deliberately creates an account nobody can sign into. This
 * one is for standing in front of a funeral home and showing them the product,
 * so everything is the other way round: three accounts with real passwords,
 * family links that actually open, and enough content that no screen is empty.
 *
 * An empty product demos badly in a specific way. A director looks at a case
 * list with one row on it and cannot tell whether the software is simple or
 * unfinished. So this seeds four cases at four different stages, because the
 * screen that sells this is the master page — who is waiting on a reply, what
 * went past due, which case has no date yet — and that screen only means
 * anything when there is something in each of those buckets.
 *
 * Everything in here is invented. The names are fictional, the addresses are
 * fictional, the telephone numbers are all in the 555 range that cannot be
 * dialled, and every email address ends in `.demo`, which is not a real
 * top-level domain and cannot receive mail. Nothing can reach a real person.
 *
 * It refuses to run against anything but a local database unless told `--yes`,
 * for the same reason `restore-database` does: the mistake to design against
 * is a confident one, not a careless one.
 */
import { createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import {
  db,
  pool,
  funeralHomesTable,
  usersTable,
  platformAdminsTable,
  casesTable,
  familyContactsTable,
  uploadsTable,
  casePhotosTable,
  obituaryDraftsTable,
  caseDeadlinesTable,
  caseMessagesTable,
  caseServiceOffersTable,
  casePrintItemsTable,
  caseBelongingsTable,
  serviceSelectionsTable,
  vitalStatisticsTable,
  homePoliciesTable,
  homePriceItemsTable,
  homeLicensureTable,
  practitionerLicencesTable,
  vendorsTable,
  snippetsTable,
  timelineTemplatesTable,
  intakeRequestsTable,
  aftercareEnrollmentsTable,
  aftercareDeliveriesTable,
  memoryBooksTable,
  memoryEntriesTable,
  lifeChaptersTable,
  DEFAULT_TIMELINE_TEMPLATE,
} from "@workspace/db";
import { encryptBuffer, encrypt } from "@workspace/db/crypto";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const quiet = process.argv.includes("--quiet");
const say = (message = "") => {
  if (!quiet) console.log(message);
};

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = Date.now();
const at = (offsetDays: number, hour = 10) =>
  new Date(now + offsetDays * DAY - (now % HOUR) + hour * HOUR - 10 * HOUR);

/* ------------------------------------------------------------ the logins -- */

/**
 * The three sign-ins, in one place because they are the deliverable.
 *
 * Passwords are long enough for the server's own minimum and typeable on a
 * stage, which is a real constraint: a demo where somebody fumbles the
 * password twice in front of a prospect is a worse demo.
 */
const LOGINS = {
  platform: {
    email: "admin@holdingtoday.demo",
    password: "HoldingAdmin2026",
    displayName: "Heather Krueger",
    title: "Holding Today",
  },
  owner: {
    email: "ruth@cedarandstone.demo",
    password: "CedarStone2026",
    displayName: "Ruth Calder",
    title: "Owner and Funeral Director",
  },
  director: {
    email: "marcus@cedarandstone.demo",
    password: "CedarTeam2026",
    displayName: "Marcus Alder",
    title: "Funeral Director",
  },
} as const;

const HOME_SLUG = "cedar-and-stone";
const PLATFORM_SLUG = "holding-today-platform";

/* ------------------------------------------------------------- the guard -- */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db", "postgres"]);

function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

function assertSafeTarget(): void {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const hostname = (() => {
    try {
      return new URL(databaseUrl).hostname;
    } catch {
      return "";
    }
  })();

  if (LOCAL_HOSTS.has(hostname) || process.argv.includes("--yes")) return;

  console.error(
    `seed-showcase: target is ${describeTarget(databaseUrl)}, which is not a ` +
      "local database.\nThis writes demo homes, cases and sign-in accounts " +
      "into whatever DATABASE_URL points at, and removes any it wrote before. " +
      "If that is really where you want it, add --yes.",
  );
  process.exit(1);
}

/* ------------------------------------------------------------ the helpers -- */

/**
 * The same format `lib/auth.ts` writes, so the server can verify it.
 *
 * Replicated rather than imported because `scripts` does not depend on the API
 * server, and the stored string is self-describing — `scrypt$N$r$p$salt$hash`
 * — so a hash written here is read by the same `verifyPassword`. The
 * parameters must match OWASP's floor as that file sets it;
 * `seed-showcase.test.ts` signs in with each of these passwords through the
 * real route, which is what catches it if either side ever moves.
 */
async function hashPassword(password: string): Promise<string> {
  const params = { N: 16384, r: 8, p: 1 };
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString(
    "base64",
  )}$${derived.toString("base64")}`;
}

/** A family link: the raw token is returned, only its digest is stored. */
function mintToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
  };
}

/**
 * A photograph-shaped image, generated rather than anybody's.
 *
 * Using a real picture of a real person for a fictional dead woman is not a
 * thing to do casually, and stock photography of "grieving family" is worse.
 * So these are soft two-tone washes at real photograph proportions: they read
 * as a picture in a grid and as a portrait in a frame, and nobody looking at
 * one could mistake it for a person.
 *
 * Swap them for photographs you have the rights to before a live demo. The
 * captions below are doing the emotional work and they will carry a real
 * picture better than they carry this.
 */
async function photograph(options: {
  width: number;
  height: number;
  from: string;
  to: string;
}): Promise<Buffer> {
  const { width, height, from, to } = options;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0%" stop-color="${from}"/>
        <stop offset="100%" stop-color="${to}"/>
      </linearGradient>
      <radialGradient id="v" cx="50%" cy="42%" r="72%">
        <stop offset="60%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.28"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect width="100%" height="100%" fill="url(#v)"/>
  </svg>`;

  return sharp(Buffer.from(svg))
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

/** Store a photograph against a case and return its `case_photos` row id. */
async function addPhoto(options: {
  homeId: number;
  caseId: number;
  contactId: number | null;
  filename: string;
  caption: string | null;
  selected: boolean;
  position: number;
  width: number;
  height: number;
  from: string;
  to: string;
}): Promise<number> {
  const bytes = await photograph(options);

  const [upload] = await db
    .insert(uploadsTable)
    .values({
      funeralHomeId: options.homeId,
      caseId: options.caseId,
      uploadedByContactId: options.contactId,
      filename: options.filename,
      mimeType: "image/jpeg",
      sizeBytes: bytes.length,
      data: encryptBuffer(bytes),
    })
    .returning();

  const [photo] = await db
    .insert(casePhotosTable)
    .values({
      funeralHomeId: options.homeId,
      caseId: options.caseId,
      uploadId: upload!.id,
      uploadedByContactId: options.contactId,
      caption: options.caption,
      selected: options.selected,
      position: options.position,
    })
    .returning();

  return photo!.id;
}

/** The standard schedule, as a home that has been using this would have it. */
async function seedSchedule(homeId: number): Promise<void> {
  await db.insert(timelineTemplatesTable).values(
    DEFAULT_TIMELINE_TEMPLATE.map((step, index) => ({
      funeralHomeId: homeId,
      title: step.title,
      description: step.description,
      offsetMinutes: step.offsetMinutes,
      isEvent: step.isEvent,
      position: index,
    })),
  );
}

/** Apply the standard schedule to a case with a service date. */
async function applySchedule(
  homeId: number,
  caseId: number,
  serviceAt: Date,
  completed: readonly string[] = [],
): Promise<void> {
  await db.insert(caseDeadlinesTable).values(
    DEFAULT_TIMELINE_TEMPLATE.map((step) => ({
      funeralHomeId: homeId,
      caseId,
      title: step.title,
      description: step.description,
      dueAt: new Date(serviceAt.getTime() + step.offsetMinutes * 60 * 1000),
      isEvent: step.isEvent,
      completedAt: completed.includes(step.title) ? at(-1) : null,
    })),
  );
}

/* ------------------------------------------------------------- the reset -- */

/**
 * Remove a previous run, so this can be re-run before a demo without
 * accumulating three Cedar & Stones in the customer list.
 *
 * Scoped to the two slugs this script owns and nothing else. Deleting a
 * `funeral_homes` row cascades to everything beneath it, which is the whole
 * tenant model working as intended.
 */
async function clearPrevious(): Promise<void> {
  const homes = await db
    .select({ id: funeralHomesTable.id })
    .from(funeralHomesTable)
    .where(inArray(funeralHomesTable.slug, [HOME_SLUG, PLATFORM_SLUG]));

  if (homes.length > 0) {
    await db.delete(funeralHomesTable).where(
      inArray(
        funeralHomesTable.id,
        homes.map((home) => home.id),
      ),
    );
    say(`Removed ${homes.length} home(s) from a previous run.`);
  }

  await db
    .delete(platformAdminsTable)
    .where(eq(platformAdminsTable.email, LOGINS.platform.email));
}

/* ------------------------------------------------------------ the platform -- */

async function seedPlatform(): Promise<void> {
  const [home] = await db
    .insert(funeralHomesTable)
    .values({
      name: "Holding Today",
      slug: PLATFORM_SLUG,
      /*
       * Ours, not a customer's. A platform admin needs a staff account and a
       * staff account needs a home, so this row exists only to hold one — and
       * marked internal it stays out of the customer list, the counts and the
       * engagement figures, which is what stops a demo of the admin console
       * reporting two homes when one of them is us.
       */
      internalAccount: true,
      subscriptionStatus: "active",
      city: "Denver",
      region: "CO",
      timezone: "America/Denver",
      intakeEnabled: false,
    })
    .returning();

  await db.insert(usersTable).values({
    funeralHomeId: home!.id,
    email: LOGINS.platform.email,
    passwordHash: await hashPassword(LOGINS.platform.password),
    displayName: LOGINS.platform.displayName,
    title: LOGINS.platform.title,
    role: "owner",
    emailVerified: true,
  });

  await db.insert(platformAdminsTable).values({
    email: LOGINS.platform.email,
    displayName: LOGINS.platform.displayName,
    note: "Demo account, created by seed-showcase.",
  });
}

/* ---------------------------------------------------------------- the home -- */

async function seedHome(): Promise<{ homeId: number; ownerId: number }> {
  const [home] = await db
    .insert(funeralHomesTable)
    .values({
      name: "Cedar & Stone Funeral Home",
      slug: HOME_SLUG,
      /* A deep green rather than the default, so a demo shows that the family
       * portal takes the home's own colour rather than ours. */
      accentColor: "#2f5d50",
      phone: "(555) 018-2200",
      urgentPhone: "(555) 018-2240",
      addressLine1: "1841 Mariposa Street",
      city: "Denver",
      region: "CO",
      postalCode: "80204",
      timezone: "America/Denver",
      officeOpensMinute: 8 * 60 + 30,
      officeClosesMinute: 17 * 60,
      aftercareEnabled: true,
      aftercareSenderName: "Cedar & Stone",
      intakeEnabled: true,
      intakeNotifyEmail: "arrangements@cedarandstone.demo",
      storefrontHeadline: "Serving families in west Denver since 1948.",
      storefrontAbout:
        "We are a family-run funeral home on Mariposa Street, two blocks from " +
        "the hospital. Someone answers this telephone at any hour, including " +
        "tonight. If you have just been told that somebody has died, you do " +
        "not need to know what you want yet — ring us and we will talk it " +
        "through.",
      messageLockDays: 21,
      slideshowTarget: 45,
      /* Paying, not on trial: a prospect should see the product, not a banner
       * counting down somebody else's trial. */
      subscriptionStatus: "active",
      currentPeriodEndsAt: at(23),
      onboardingDone: "case,family,branding,hours,schedule,staff,public",
    })
    .returning();

  const homeId = home!.id;

  const [owner] = await db
    .insert(usersTable)
    .values({
      funeralHomeId: homeId,
      email: LOGINS.owner.email,
      passwordHash: await hashPassword(LOGINS.owner.password),
      displayName: LOGINS.owner.displayName,
      title: LOGINS.owner.title,
      role: "owner",
      emailVerified: true,
    })
    .returning();

  await db.insert(usersTable).values({
    funeralHomeId: homeId,
    email: LOGINS.director.email,
    passwordHash: await hashPassword(LOGINS.director.password),
    displayName: LOGINS.director.displayName,
    title: LOGINS.director.title,
    role: "director",
    emailVerified: true,
  });

  await seedSchedule(homeId);

  /* The sentences a home repeats at every kitchen table. Published, so the
   * family portal and the public page both show them. */
  await db.insert(homePoliciesTable).values([
    {
      funeralHomeId: homeId,
      title: "Viewing and visitation",
      body:
        "Viewings are held in our own chapel and we do not limit how long a " +
        "family stays. If you would like time alone with your person before " +
        "anyone else arrives, say so and we will arrange it.",
      position: 0,
      published: true,
    },
    {
      funeralHomeId: homeId,
      title: "Children at a service",
      body:
        "Children are welcome at everything we hold. There is a side room with " +
        "a door if anyone needs to step out, and nobody will mind if they do.",
      position: 1,
      published: true,
    },
    {
      funeralHomeId: homeId,
      title: "Flowers and donations",
      body:
        "We will take delivery of flowers from any florist. If the family would " +
        "rather have donations, tell us the charity and we will put it in the " +
        "order of service and pass it on to anyone who asks.",
      position: 2,
      published: true,
    },
  ]);

  /* The staff-only crib sheet. No family route and no public route reads this,
   * and a test fails the build if one ever does. */
  await db.insert(homePriceItemsTable).values([
    { funeralHomeId: homeId, category: "Professional services", label: "Basic services of the director and staff", amountCents: 249500, position: 0 },
    { funeralHomeId: homeId, category: "Professional services", label: "Embalming", amountCents: 89500, position: 1 },
    { funeralHomeId: homeId, category: "Professional services", label: "Other preparation of the body", amountCents: 32500, position: 2 },
    { funeralHomeId: homeId, category: "Facilities and staff", label: "Viewing or visitation", amountCents: 47500, position: 3 },
    { funeralHomeId: homeId, category: "Facilities and staff", label: "Funeral ceremony at our chapel", amountCents: 59500, position: 4 },
    { funeralHomeId: homeId, category: "Facilities and staff", label: "Graveside service", amountCents: 44500, position: 5 },
    { funeralHomeId: homeId, category: "Transport", label: "Transfer of remains to the funeral home", amountCents: 39500, position: 6 },
    { funeralHomeId: homeId, category: "Transport", label: "Hearse", amountCents: 37500, position: 7 },
    { funeralHomeId: homeId, category: "Merchandise", label: "Cremation container, cloth covered", amountCents: 19500, position: 8 },
    { funeralHomeId: homeId, category: "Merchandise", label: "Printed order of service, per hundred", amountCents: 18500, position: 9 },
  ]);

  /* Colorado licensure, the part the platform console shows. Registration
   * renews inside the year and one practitioner's licence expires before the
   * 1 January 2027 deadline, so a demo of the admin console has something in
   * it rather than a page of green. */
  await db.insert(homeLicensureTable).values({
    funeralHomeId: homeId,
    doraRegistrationNumber: "FSE.0004182",
    registeredServices: [
      "Funeral establishment",
      "Embalming",
      "Cremation (contracted)",
    ],
    designeeName: "Ruth Calder",
    designeeTitle: "Owner and Funeral Director",
    beganBusinessOn: "1948-06-01",
    registrationRenewsOn: new Date(now + 96 * DAY).toISOString().slice(0, 10),
    notes:
      "Cremations are contracted to Front Range Crematory; we hold no retort.",
  });

  await db.insert(practitionerLicencesTable).values([
    {
      funeralHomeId: homeId,
      personName: "Ruth Calder",
      role: "mortuary_science_practitioner",
      standing: "held",
      licenceNumber: "MSP.0009911",
      expiresOn: new Date(now + 430 * DAY).toISOString().slice(0, 10),
    },
    {
      funeralHomeId: homeId,
      personName: "Marcus Alder",
      role: "funeral_director",
      standing: "applied",
      licenceNumber: null,
      expiresOn: null,
    },
    {
      funeralHomeId: homeId,
      personName: "Denise Okafor",
      role: "embalmer",
      standing: "held",
      licenceNumber: "EMB.0004427",
      expiresOn: new Date(now + 54 * DAY).toISOString().slice(0, 10),
    },
  ]);

  /* The local network. Ships empty in the product on purpose — inventing
   * headstone companies would produce numbers a grieving family would dial —
   * so these are a home's own entries, which is what the feature is for. */
  await db.insert(vendorsTable).values([
    { funeralHomeId: homeId, kind: "florist", name: "Mariposa Street Flowers", contactName: "Ana Reyes", phone: "(555) 018-3310", city: "Denver", region: "CO", postalCode: "80204", visibleToFamily: true, preferred: true, source: "home", notes: "Will deliver to the chapel before 9am if asked the day before." },
    { funeralHomeId: homeId, kind: "monument", name: "Stone & Slate Memorials", contactName: "Tomas Vrba", phone: "(555) 018-4420", city: "Lakewood", region: "CO", postalCode: "80215", visibleToFamily: true, source: "home", notes: "Six to nine weeks for a granite upright. Longer in winter." },
    { funeralHomeId: homeId, kind: "cemetery", name: "Fairmount Rise Cemetery", phone: "(555) 018-5510", city: "Denver", region: "CO", postalCode: "80219", visibleToFamily: true, source: "home", notes: "Interments Monday to Saturday. Their own calendar; ring to confirm." },
    { funeralHomeId: homeId, kind: "celebrant", name: "Joanne Tiller", phone: "(555) 018-6600", city: "Denver", region: "CO", visibleToFamily: true, preferred: true, source: "home", specialisms: "Non-religious and mixed-faith services", notes: "Meets the family first, always. Worth the extra day." },
    { funeralHomeId: homeId, kind: "musician", name: "Eli Braithwaite (organ, piano)", phone: "(555) 018-7710", city: "Denver", region: "CO", visibleToFamily: true, source: "home" },
    { funeralHomeId: homeId, kind: "caterer", name: "The Kettle on 8th", contactName: "Priya Nandi", phone: "(555) 018-8820", city: "Denver", region: "CO", postalCode: "80204", visibleToFamily: true, source: "home", notes: "Does a reception for forty at short notice. Halal and vegetarian on request." },
    { funeralHomeId: homeId, kind: "transport", name: "Front Range Livery", phone: "(555) 018-9930", city: "Denver", region: "CO", visibleToFamily: false, source: "home", notes: "Second limousine when we need one. Trade only, do not give to families." },
  ]);

  /* The home's own snippet library — the Word file every director copies
   * from. Ships empty because most of it is somebody's copyright; a home
   * marks what it has the right to print. */
  await db.insert(snippetsTable).values([
    { funeralHomeId: homeId, kind: "closing", title: "Our own closing line", body: "Held in the care of Cedar & Stone, Denver.", clearedForPrint: true, position: 0 },
    { funeralHomeId: homeId, kind: "verse", title: "Ecclesiastes 3:1", body: "To everything there is a season, and a time to every purpose under the heaven.", attribution: "King James Bible (public domain)", clearedForPrint: true, position: 1 },
    { funeralHomeId: homeId, kind: "prayer", title: "The Lord's Prayer (traditional)", body: "Our Father, who art in heaven, hallowed be thy name…", attribution: "Traditional", clearedForPrint: true, position: 2 },
    { funeralHomeId: homeId, kind: "poem", title: "Remember — Christina Rossetti", body: "Remember me when I am gone away, gone far away into the silent land…", attribution: "Christina Rossetti, 1862 (public domain)", clearedForPrint: true, position: 3 },
  ]);

  /* Two people who found the public page. One is the reason the Requests
   * screen exists; the other is somebody planning ahead.
   *
   * Two inserts rather than one array: the rows differ in shape, and two
   * object literals of different shapes widen to a union that drizzle's insert
   * overload will not take. */
  await db.insert(intakeRequestsTable).values({
    funeralHomeId: homeId,
    kind: "at_need",
    requesterName: "Daniel Okonkwo",
    requesterPhone: "(555) 018-1120",
    requesterEmail: "daniel.okonkwo@example.demo",
    relationship: "Son",
    subjectFirstName: "Grace",
    subjectLastName: "Okonkwo",
    dateOfDeath: at(-1, 4),
    note:
      "My mother died early this morning at Saint Joseph. I don't know what " +
      "I'm supposed to do next. She wanted to be cremated.",
    status: "pending",
    submittedFromIp: "198.51.100.24",
  });

  await db.insert(intakeRequestsTable).values({
    funeralHomeId: homeId,
    kind: "pre_need",
    requesterName: "Beverly Ostrander",
    requesterPhone: "(555) 018-1177",
    requesterEmail: "b.ostrander@example.demo",
    /* On a pre-need enquiry the subject is the person filling the form in, and
     * that is what the public route stores too — she is arranging her own. */
    subjectFirstName: "Beverly",
    subjectLastName: "Ostrander",
    note:
      "I am 78 and I would like to write down what I want so my daughter " +
      "does not have to guess. I am not looking to pay anything yet.",
    status: "pending",
    submittedFromIp: "198.51.100.71",
  });

  return { homeId, ownerId: owner!.id };
}

/* ---------------------------------------------------- case 1: the showcase -- */

/**
 * A case mid-arrangement, four days out. The one to open in a demo.
 *
 * Everything a finished case has: photographs in and chosen, an obituary the
 * family wrote and submitted, a thread with unanswered replies in both
 * directions, the standard schedule with the early steps ticked, two service
 * times offered and one picked, an order of service approved and a prayer card
 * out for proof, and the vital statistics ready for the state's system.
 */
async function seedShowcaseCase(
  homeId: number,
  ownerId: number,
): Promise<{ links: Array<{ who: string; token: string }> }> {
  const serviceAt = at(4, 11);

  const [row] = await db
    .insert(casesTable)
    .values({
      funeralHomeId: homeId,
      kind: "at_need",
      decedentFirstName: "Margaret",
      decedentLastName: "Whitfield",
      decedentPreferredName: "Peggy",
      dateOfBirth: new Date("1941-03-19"),
      dateOfDeath: at(-3, 6),
      serviceAt,
      serviceLocation: "Cedar & Stone Chapel, then Fairmount Rise",
      postalCode: "80204",
      serviceNotes:
        "Family would like the slideshow to run before the service rather " +
        "than during. Eli is playing from 10:40.",
      leadDirectorId: ownerId,
      status: "active",
    })
    .returning();

  const caseId = row!.id;

  const daughter = mintToken();
  const [anne] = await db
    .insert(familyContactsTable)
    .values({
      funeralHomeId: homeId,
      caseId,
      name: "Anne Whitfield",
      relationship: "Daughter",
      phone: "(555) 018-2431",
      email: "anne.whitfield@example.demo",
      role: "next_of_kin",
      canInvite: true,
      tokenHash: daughter.tokenHash,
      expiresAt: at(87),
      firstSeenAt: at(-3, 19),
      lastSeenAt: at(0, 8),
      invitedByUserId: ownerId,
    })
    .returning();

  const son = mintToken();
  await db.insert(familyContactsTable).values({
    funeralHomeId: homeId,
    caseId,
    name: "Robert Whitfield",
    relationship: "Son",
    phone: "(555) 018-2455",
    email: "rob.whitfield@example.demo",
    role: "contributor",
    tokenHash: son.tokenHash,
    expiresAt: at(87),
    firstSeenAt: at(-2, 21),
    lastSeenAt: at(-1, 22),
    invitedByUserId: ownerId,
  });

  /* Nine photographs, five of them chosen for the slideshow — the shape of a
   * real collection, where the family sends more than runs. */
  const pictures = [
    { caption: "Mum and Dad on the porch at Cedar Street, about 1968", w: 1600, h: 1067, from: "#c9b79a", to: "#6d5f4c", selected: true },
    { caption: "Her wedding day, 1963", w: 1000, h: 1400, from: "#d8cdbd", to: "#7e7160", selected: true },
    { caption: "Teaching at Columbine Elementary — she had that room 31 years", w: 1600, h: 1067, from: "#a9b6a4", to: "#4f5c4d", selected: true },
    { caption: "With the grandchildren at Estes Park, 1994", w: 1600, h: 1067, from: "#b4c2cc", to: "#4a5a66", selected: true },
    { caption: "Eightieth birthday, the cake she complained about", w: 1400, h: 1400, from: "#d3b8a6", to: "#7a5d4c", selected: true },
    { caption: "Her garden, the summer before last", w: 1600, h: 1067, from: "#b9c49a", to: "#5c6642", selected: false },
    { caption: "Christmas, one of the last ones at the house", w: 1200, h: 1600, from: "#c6a9a0", to: "#6b4f48", selected: false },
    { caption: null, w: 1600, h: 1067, from: "#c2bdb2", to: "#68635a", selected: false },
    { caption: "Rob thinks this is Skegness. Anne says Brighton.", w: 1600, h: 1067, from: "#aebdc0", to: "#525f62", selected: false },
  ];

  const photoIds: number[] = [];
  for (const [index, picture] of pictures.entries()) {
    photoIds.push(
      await addPhoto({
        homeId,
        caseId,
        contactId: anne!.id,
        filename: `whitfield-${String(index + 1).padStart(2, "0")}.jpg`,
        caption: picture.caption,
        selected: picture.selected,
        position: index,
        width: picture.w,
        height: picture.h,
        from: picture.from,
        to: picture.to,
      }),
    );
  }

  await db
    .update(casesTable)
    .set({ portraitPhotoId: photoIds[1]!, referencePhotoId: photoIds[4]! })
    .where(eq(casesTable.id, caseId));

  await db.insert(obituaryDraftsTable).values({
    funeralHomeId: homeId,
    caseId,
    fullName: "Margaret Ellen Whitfield",
    bornOn: "19 March 1941",
    birthPlace: "Pueblo, Colorado",
    diedOn: "at home in Denver",
    deathPlace: "Denver, Colorado",
    survivedBy:
      "her daughter Anne, her son Robert, five grandchildren and one " +
      "great-granddaughter, Nell",
    precededBy: "her husband Donald, in 2011",
    biography:
      "Peggy taught fourth grade at Columbine Elementary for thirty-one " +
      "years and could still name every child in her first class. She was " +
      "born in Pueblo, came to Denver at nineteen for a job at the telephone " +
      "exchange, and met Donald at a dance she had not wanted to go to.\n\n" +
      "She grew tomatoes she insisted were better than they were, kept a " +
      "kitchen where nobody was ever allowed to leave hungry, and wrote to " +
      "her grandchildren on paper long after they had stopped writing back.",
    inLieuOfFlowers:
      "Donations to the Denver Public Library Friends, where she volunteered " +
      "every Tuesday for eleven years.",
    specialThanks:
      "To the district nurses, who were kind to her and to us, every single " +
      "day for five weeks.",
    status: "submitted",
    submittedAt: at(-1, 20),
  });

  await applySchedule(homeId, caseId, serviceAt, [
    "Photographs in for the slideshow",
    "Tell us about them for the obituary",
  ]);

  /*
   * One thing genuinely past due.
   *
   * The standard schedule alone cannot produce this in a fresh demo: every one
   * of its steps is an offset from a service four days away, so all of them are
   * still ahead. But "what went past due while you were at a graveside" is the
   * master page's headline, and a demo of it against an empty list demonstrates
   * nothing. This is the step a director really does miss.
   */
  await db.insert(caseDeadlinesTable).values({
    funeralHomeId: homeId,
    caseId,
    title: "Confirm the plot number with Fairmount Rise",
    description:
      "They will not hold a time without it, and the office shuts at four.",
    dueAt: at(-1, 15),
    isEvent: false,
    position: 99,
  });

  /* Two times offered, one chosen — an offer is not a booking, and the choice
   * is what set the date above. */
  await db.insert(caseServiceOffersTable).values([
    {
      funeralHomeId: homeId,
      caseId,
      startsAt: serviceAt,
      location: "Cedar & Stone Chapel",
      note: "Eli can play. Fairmount can take us at half past one.",
      position: 0,
      chosenAt: at(-2, 9),
      chosenByContactId: anne!.id,
    },
    {
      funeralHomeId: homeId,
      caseId,
      startsAt: at(6, 14),
      location: "Cedar & Stone Chapel",
      note: "Later in the week if family are travelling from Pueblo.",
      position: 1,
    },
  ]);

  /* A thread that reads like one. The family's last message is unanswered,
   * which is what puts this case at the top of the master page. */
  await db.insert(caseMessagesTable).values([
    { funeralHomeId: homeId, caseId, authorUserId: ownerId, body: "Anne — this is Ruth at Cedar & Stone. Everything you need is behind the link I sent. There is no hurry on any of it, and you can ring me on the number at the top of that page.", createdAt: at(-3, 14), readAt: at(-3, 19) },
    { funeralHomeId: homeId, caseId, authorContactId: anne!.id, body: "Thank you. Rob is going to put some photographs in too — he has the ones from Dad's side.", createdAt: at(-3, 19), readAt: at(-3, 20) },
    { funeralHomeId: homeId, caseId, authorUserId: ownerId, body: "That is exactly right. Anything he has is welcome, even if it is blurry or straight off his phone.", createdAt: at(-2, 9), readAt: at(-2, 12) },
    { funeralHomeId: homeId, caseId, authorContactId: anne!.id, body: "We have picked the Thursday. Is it alright if my sister-in-law brings Mum's dress on Wednesday instead of tomorrow? She is driving up from Pueblo.", createdAt: at(-2, 12), readAt: at(-2, 13) },
    { funeralHomeId: homeId, caseId, authorUserId: ownerId, body: "Wednesday is fine. I am here until five, and if she is later than that someone will be on the urgent number.", createdAt: at(-2, 13), readAt: at(-2, 18) },
    { funeralHomeId: homeId, caseId, authorContactId: anne!.id, body: "One more thing — Rob has found a reading he would like to do. Do we need to tell you the words in advance or can he just read it?", createdAt: at(0, 9) },
  ]);

  await db.insert(serviceSelectionsTable).values([
    { funeralHomeId: homeId, caseId, kind: "hymn", value: "The Day Thou Gavest, Lord, Is Ended", position: 0, confirmedAt: at(-1, 16) },
    { funeralHomeId: homeId, caseId, kind: "hymn", value: "Abide With Me", notes: "Second verse only — she thought it went on.", position: 1, confirmedAt: at(-1, 16) },
    { funeralHomeId: homeId, caseId, kind: "music", value: "Clair de lune, as people come in", attribution: "Eli Braithwaite, piano", position: 2 },
    { funeralHomeId: homeId, caseId, kind: "reading", value: "Remember — Christina Rossetti", attribution: "Read by Robert", position: 3 },
    { funeralHomeId: homeId, caseId, kind: "eulogist", value: "Anne Whitfield", notes: "Five minutes. Has asked for a glass of water.", position: 4 },
    { funeralHomeId: homeId, caseId, kind: "pallbearer", value: "Robert Whitfield", position: 5 },
    { funeralHomeId: homeId, caseId, kind: "pallbearer", value: "James Whitfield (grandson)", position: 6 },
    { funeralHomeId: homeId, caseId, kind: "pallbearer", value: "Michael Orr (nephew)", position: 7 },
    { funeralHomeId: homeId, caseId, kind: "pallbearer", value: "Two of our own staff", notes: "Family are two short.", position: 8 },
  ]);

  await db.insert(caseBelongingsTable).values([
    { funeralHomeId: homeId, caseId, kind: "clothing", description: "Navy dress with the enamel brooch at the collar", disposition: "with_deceased", status: "received", receivedAt: at(-1, 15), position: 0 },
    { funeralHomeId: homeId, caseId, kind: "jewellery", description: "Gold wedding band, worn thin", disposition: "return_to_family", status: "received", receivedAt: at(-1, 15), returnedToName: "Anne Whitfield", notes: "Anne asked for this back before the service, not after.", position: 1 },
    { funeralHomeId: homeId, caseId, kind: "glasses", description: "Tortoiseshell reading glasses", disposition: "return_to_family", status: "received", receivedAt: at(-1, 15), position: 2 },
    { funeralHomeId: homeId, caseId, kind: "keepsake", description: "Photograph of Donald for her hand", disposition: "with_deceased", status: "expected", position: 3 },
  ]);

  await db.insert(vitalStatisticsTable).values({
    funeralHomeId: homeId,
    caseId,
    legalFirstName: "Margaret",
    legalMiddleName: "Ellen",
    legalLastName: "Whitfield",
    nameAtBirth: "Margaret Ellen Braithwaite",
    dateOfBirth: "1941-03-19",
    birthCity: "Pueblo",
    birthState: "CO",
    birthCountry: "United States",
    sex: "Female",
    socialSecurityNumber: encrypt("531224417"),
    maritalStatus: "Widowed",
    spouseName: "Donald Whitfield",
    fatherFirstName: "Arthur",
    fatherLastName: "Braithwaite",
    motherFirstName: "Edith",
    motherMaidenName: "Sowerby",
    occupation: "Teacher",
    industry: "Elementary education",
    educationLevel: "Bachelor's degree",
    residenceLine1: "412 South Cedar Street",
    residenceCity: "Denver",
    residenceCounty: "Denver",
    residenceState: "CO",
    residencePostalCode: "80219",
    residenceInsideCityLimits: true,
    veteran: false,
    status: "submitted",
    submittedAt: at(-1, 17),
  });

  await db.insert(casePrintItemsTable).values([
    {
      funeralHomeId: homeId,
      caseId,
      templateKey: "program-folded",
      title: "Order of service",
      photoId: photoIds[1]!,
      values: {
        order:
          "Entrance — Clair de lune\nWelcome\nThe Day Thou Gavest\nEulogy — Anne\nReading — Remember\nAbide With Me\nCommittal\nDeparture",
        bearers: "Robert Whitfield\nJames Whitfield\nMichael Orr",
        thanks:
          "The family thank you for being here today, and for the many kindnesses of the last week.",
      },
      quantity: 180,
      status: "approved",
      approvedAt: at(-1, 11),
      approvedByUserId: ownerId,
      sharedWithFamily: true,
    },
    {
      funeralHomeId: homeId,
      caseId,
      templateKey: "prayer-card",
      title: "Prayer card",
      photoId: photoIds[1]!,
      values: {
        verse:
          "To everything there is a season, and a time to every purpose under the heaven.",
        closing: "Held in the care of Cedar & Stone, Denver.",
      },
      quantity: 200,
      status: "proof",
      sharedWithFamily: true,
    },
    {
      funeralHomeId: homeId,
      caseId,
      templateKey: "thank-you",
      title: "Thank-you card",
      values: {},
      quantity: 60,
      status: "draft",
    },
  ]);

  return {
    links: [
      { who: "Anne Whitfield (daughter, next of kin)", token: daughter.token },
      { who: "Robert Whitfield (son, contributor)", token: son.token },
    ],
  };
}

/* ------------------------------------------- case 2: closed, in aftercare -- */

/**
 * A case that finished ten weeks ago, to show the part that costs no staff
 * hours: the family consented, two check-ins have gone, the ninety-day one is
 * due shortly, and the memory book has things in it that other people wrote.
 */
async function seedAftercareCase(
  homeId: number,
  directorId: number,
): Promise<{ who: string; token: string }> {
  const serviceAt = at(-68, 13);

  const [row] = await db
    .insert(casesTable)
    .values({
      funeralHomeId: homeId,
      kind: "at_need",
      decedentFirstName: "Harold",
      decedentLastName: "Nkemelu",
      decedentPreferredName: "Harry",
      dateOfBirth: new Date("1949-11-02"),
      dateOfDeath: at(-74, 5),
      serviceAt,
      serviceLocation: "Cedar & Stone Chapel",
      postalCode: "80204",
      leadDirectorId: directorId,
      status: "closed",
      closedAt: at(-66, 16),
      messagesLockAt: at(-47),
    })
    .returning();

  const caseId = row!.id;
  const link = mintToken();

  const [contact] = await db
    .insert(familyContactsTable)
    .values({
      funeralHomeId: homeId,
      caseId,
      name: "Chiamaka Nkemelu",
      relationship: "Daughter",
      phone: "(555) 018-3388",
      email: "chiamaka@example.demo",
      role: "next_of_kin",
      canInvite: true,
      tokenHash: link.tokenHash,
      /* Pushed out by the check-ins, which is why a link issued during the
       * arrangement is still open at the anniversary. */
      expiresAt: at(83),
      firstSeenAt: at(-73, 20),
      lastSeenAt: at(-8, 21),
      invitedByUserId: directorId,
    })
    .returning();

  const photoIds: number[] = [];
  const pictures = [
    { caption: "Dad at the shop on Colfax, 1981", w: 1600, h: 1067, from: "#c8b49b", to: "#6a5a45" },
    { caption: "Lagos, before he came over", w: 1100, h: 1500, from: "#d2c0a4", to: "#7c6a4f" },
    { caption: "Him and Mum, thirty-fifth anniversary", w: 1600, h: 1067, from: "#b6c0c9", to: "#4d5761" },
    { caption: "The allotment he was so proud of", w: 1600, h: 1067, from: "#b2c199", to: "#566442" },
  ];
  for (const [index, picture] of pictures.entries()) {
    photoIds.push(
      await addPhoto({
        homeId,
        caseId,
        contactId: contact!.id,
        filename: `nkemelu-${index + 1}.jpg`,
        caption: picture.caption,
        selected: true,
        position: index,
        width: picture.w,
        height: picture.h,
        from: picture.from,
        to: picture.to,
      }),
    );
  }

  await db
    .update(casesTable)
    .set({ portraitPhotoId: photoIds[1]! })
    .where(eq(casesTable.id, caseId));

  await db.insert(obituaryDraftsTable).values({
    funeralHomeId: homeId,
    caseId,
    fullName: "Harold Chukwuemeka Nkemelu",
    bornOn: "2 November 1949",
    birthPlace: "Enugu, Nigeria",
    survivedBy: "his wife Ngozi, his daughters Chiamaka and Adaeze, and four grandchildren",
    biography:
      "Harry came to Denver in 1974 with an engineering degree and no winter " +
      "coat. He ran the hardware shop on Colfax for twenty-six years and knew " +
      "what was wrong with your boiler before you had finished describing it.",
    status: "approved",
    submittedAt: at(-71, 11),
    approvedAt: at(-70, 9),
  });

  await applySchedule(
    homeId,
    caseId,
    serviceAt,
    DEFAULT_TIMELINE_TEMPLATE.map((step) => step.title),
  );

  /* Consented, so the check-ins actually send. 30 and 60 days are away; the
   * 90-day one is due in three weeks and the anniversary next year. */
  const [enrollment] = await db
    .insert(aftercareEnrollmentsTable)
    .values({
      funeralHomeId: homeId,
      caseId,
      contactId: contact!.id,
      email: "chiamaka@example.demo",
      phone: "(555) 018-3388",
      brandedAs: "Cedar & Stone",
      status: "active",
      startsAt: serviceAt,
      consentedAt: at(-66, 17),
    })
    .returning();

  await db.insert(aftercareDeliveriesTable).values([
    { enrollmentId: enrollment!.id, dayOffset: 30, dueAt: at(-38, 14), sentAt: at(-38, 14) },
    { enrollmentId: enrollment!.id, dayOffset: 60, dueAt: at(-8, 14), sentAt: at(-8, 14) },
    { enrollmentId: enrollment!.id, dayOffset: 90, dueAt: at(22, 14) },
    { enrollmentId: enrollment!.id, dayOffset: 365, dueAt: at(297, 14) },
  ]);

  /* The book, open, with entries from people who were not the next of kin —
   * which is the thing the check-ins are quietly collecting. */
  const [book] = await db
    .insert(memoryBooksTable)
    .values({
      funeralHomeId: homeId,
      caseId,
      title: "Harry",
      dedication: "For Ngozi, and for the grandchildren who will want to know him.",
      includePhotos: true,
      includeObituary: true,
      includeLifeStory: true,
      includeEulogies: true,
    })
    .returning();

  void book;

  await db.insert(lifeChaptersTable).values([
    { funeralHomeId: homeId, caseId, title: "Enugu, and the crossing", body: "He was the third of six and the only one who left. He used to say the cold was the only thing nobody had warned him about.", startYear: 1949, endYear: 1974, authorName: "Chiamaka Nkemelu", authorSide: "family", authorContactId: contact!.id, position: 0 },
    { funeralHomeId: homeId, caseId, title: "The shop on Colfax", body: "Twenty-six years. He knew what was wrong with your boiler before you finished the sentence, and he would lend you the part if you were short.", startYear: 1982, endYear: 2008, authorName: "Chiamaka Nkemelu", authorSide: "family", authorContactId: contact!.id, position: 1 },
  ]);

  await db.insert(memoryEntriesTable).values([
    { funeralHomeId: homeId, caseId, authorName: "Adaeze Nkemelu", authorSide: "family", kind: "memory", body: "He taught me to drive in the car park behind the shop, on Sundays, and never once raised his voice about the kerb.", whenText: "about 1996", includedInBook: true, position: 0 },
    { funeralHomeId: homeId, caseId, authorName: "Tom Bradbury", authorSide: "family", kind: "memory", body: "I was nineteen and had no money and he sold me a boiler part for a dollar and told me to pay him when I could. I never did and he never asked.", includedInBook: true, position: 1 },
    { funeralHomeId: homeId, caseId, authorName: "Chiamaka Nkemelu", authorSide: "family", kind: "eulogy", body: "My father believed that a thing worth doing was worth doing properly, and that included a Sunday lunch, a hedge, and an argument.", includedInBook: true, position: 2 },
    { funeralHomeId: homeId, caseId, authorName: "Ngozi Nkemelu", authorSide: "family", kind: "memory", body: "Fifty-one years. He still brought me tea in the morning on the last one.", includedInBook: true, position: 3 },
  ]);

  await db.insert(caseMessagesTable).values([
    { funeralHomeId: homeId, caseId, authorUserId: directorId, body: "Chiamaka — the photographs are all in and the book is open whenever anyone wants to add to it. There is no closing date.", createdAt: at(-66, 16), readAt: at(-66, 18) },
    { funeralHomeId: homeId, caseId, authorContactId: contact!.id, body: "Thank you for everything last week. Mum has not stopped talking about how kind you were with the grandchildren.", createdAt: at(-66, 18), readAt: at(-65, 9) },
  ]);

  return { who: "Chiamaka Nkemelu (daughter, aftercare and memory book)", token: link.token };
}

/* ---------------------------------- case 3: no service date, nothing built -- */

/**
 * A case opened this morning with no date yet.
 *
 * The master page has a bucket for exactly this, and the reason is worth
 * saying out loud in a demo: every step of the standard schedule is an offset
 * from the service, so a case without one has an empty timeline and a family
 * who has been told nothing.
 */
async function seedUndatedCase(
  homeId: number,
  directorId: number,
): Promise<{ who: string; token: string }> {
  const [row] = await db
    .insert(casesTable)
    .values({
      funeralHomeId: homeId,
      kind: "at_need",
      decedentFirstName: "Eleanor",
      decedentLastName: "Vance",
      dateOfDeath: at(-1, 3),
      leadDirectorId: directorId,
      /*
       * Active, not `intake`, and the difference is the whole point.
       *
       * The master page's bucket is *active* cases with no service date, and
       * excluding `intake` is right: every case begins there, so listing them
       * all would be noise. What the bucket is actually for is this — a family
       * who has the link and has opened it, and whose timeline is therefore
       * empty because there is no date to hang it from. That is the silent
       * failure, and it needs a family in it to be real.
       */
      status: "active",
      serviceNotes:
        "Family are waiting on a brother flying in from Auckland before they " +
        "will fix a date. Ring Thursday if we have not heard.",
    })
    .returning();

  const link = mintToken();

  await db.insert(familyContactsTable).values({
    funeralHomeId: homeId,
    caseId: row!.id,
    name: "Peter Vance",
    relationship: "Son",
    phone: "(555) 018-4412",
    email: "peter.vance@example.demo",
    role: "next_of_kin",
    canInvite: true,
    tokenHash: link.tokenHash,
    expiresAt: at(89),
    firstSeenAt: at(0, 7),
    lastSeenAt: at(0, 7),
    invitedByUserId: directorId,
  });

  await db.insert(obituaryDraftsTable).values({
    funeralHomeId: homeId,
    caseId: row!.id,
    fullName: "Eleanor Vance",
  });

  return {
    who: "Peter Vance (son — a case with no date yet, so an empty timeline)",
    token: link.token,
  };
}

/* --------------------------------------------------- case 4: a pre-need file -- */

/**
 * Somebody arranging her own funeral, years ahead.
 *
 * In a demo this is the case that proves a product boundary rather than a
 * feature: the plan is recorded, no money is taken, and closing the file does
 * **not** enrol anybody in grief check-ins, because nobody has died.
 */
async function seedPreNeedCase(homeId: number, ownerId: number): Promise<void> {
  const [row] = await db
    .insert(casesTable)
    .values({
      funeralHomeId: homeId,
      kind: "pre_need",
      decedentFirstName: "Thomas",
      decedentLastName: "Brightwater",
      dateOfBirth: new Date("1944-07-08"),
      leadDirectorId: ownerId,
      status: "closed",
      closedAt: at(-210, 15),
      serviceNotes:
        "Wants cremation, no viewing, and the Rossetti read by whoever is " +
        "willing. Has told his son. No money taken — see the pre-need note.",
    })
    .returning();

  await db.insert(obituaryDraftsTable).values({
    funeralHomeId: homeId,
    caseId: row!.id,
    fullName: "Thomas Alan Brightwater",
    bornOn: "8 July 1944",
    birthPlace: "Grand Junction, Colorado",
    biography:
      "Wrote this himself: \"Surveyor. Two marriages, one good. Climbed " +
      "everything within a day's drive and fell off two of them.\"",
  });

  await db.insert(serviceSelectionsTable).values([
    { funeralHomeId: homeId, caseId: row!.id, kind: "reading", value: "Remember — Christina Rossetti", notes: "His choice, written down in 2026.", position: 0 },
    { funeralHomeId: homeId, caseId: row!.id, kind: "music", value: "Nothing. He was firm about this.", position: 1 },
  ]);
}

/* ---------------------------------------------------------------- the run -- */

async function main(): Promise<void> {
  assertSafeTarget();
  await clearPrevious();

  await seedPlatform();
  const { homeId, ownerId } = await seedHome();

  const [director] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, LOGINS.director.email))
    .limit(1);

  const showcase = await seedShowcaseCase(homeId, ownerId);
  const aftercare = await seedAftercareCase(homeId, director!.id);
  const undated = await seedUndatedCase(homeId, director!.id);
  await seedPreNeedCase(homeId, ownerId);

  const portal = (process.env.FAMILY_PORTAL_URL ?? "").replace(/\/+$/, "");
  const console_ = (process.env.CONSOLE_URL ?? "").replace(/\/+$/, "");
  const link = (token: string) =>
    portal ? `${portal}/f/${token}` : `/f/${token}  (set FAMILY_PORTAL_URL)`;

  say();
  say("  Seeded a demo that looks like a working account.");
  say("  Everything in it is invented. No address or number can reach anyone.");
  say();
  say("  ── The platform console (our own view of our customers) ──────────");
  say(`     ${LOGINS.platform.email}`);
  say(`     ${LOGINS.platform.password}`);
  say("     Sees Cedar & Stone as a customer, its licensure, and the access log.");
  say("     Does not see a single case — by design, and worth saying in a demo.");
  say();
  say("  ── The funeral home, as the owner ───────────────────────────────");
  say(`     ${LOGINS.owner.email}`);
  say(`     ${LOGINS.owner.password}`);
  say("     Ruth Calder. Owner, so she also has settings, staff and prices.");
  say();
  say("  ── The funeral home, as an ordinary director ─────────────────────");
  say(`     ${LOGINS.director.email}`);
  say(`     ${LOGINS.director.password}`);
  say("     Marcus Alder. Works cases; cannot reach billing, prices or staff.");
  say(`     ${console_ ? console_ : "the director console"}`);
  say();
  say("  ── The family. No account and no password, by design ────────────");
  say("     A next of kin three days bereaved does not fill in a registration");
  say("     form, so the link in the text message is the credential. Open one");
  say("     of these in a private window to demo the family's side:");
  say();
  for (const entry of showcase.links) {
    say(`     ${entry.who}`);
    say(`       ${link(entry.token)}`);
  }
  say(`     ${aftercare.who}`);
  say(`       ${link(aftercare.token)}`);
  say(`     ${undated.who}`);
  say(`       ${link(undated.token)}`);
  say();
  say("  ── What is in it ────────────────────────────────────────────────");
  say("     Cedar & Stone Funeral Home, Denver — paying, set up, 2 staff.");
  say("     Four cases, on purpose at four different stages, because the");
  say("     screen that sells this is the master page and it needs something");
  say("     in each of its buckets:");
  say();
  say("       Margaret \"Peggy\" Whitfield  service in 4 days. 9 photographs,");
  say("                                   5 chosen, obituary submitted, an");
  say("                                   unanswered family message, order of");
  say("                                   service approved, prayer card out");
  say("                                   for proof, vitals ready for EDRS.");
  say("       Harold \"Harry\" Nkemelu      closed 10 weeks ago. Aftercare");
  say("                                   consented, 30- and 60-day check-ins");
  say("                                   sent, 90-day due in 3 weeks, memory");
  say("                                   book open with 4 entries.");
  say("       Eleanor Vance               opened today, no service date — the");
  say("                                   empty-timeline bucket.");
  say("       Thomas Brightwater          a pre-need file. Closed, and");
  say("                                   deliberately NOT in aftercare:");
  say("                                   nobody has died.");
  say();
  say("     Two requests waiting on the public page, one at-need and one");
  say("     pre-need, so the Requests screen is not empty.");
  say();
  say("  ── Before you show it to anyone ─────────────────────────────────");
  say("     The photographs are generated washes, not pictures of people.");
  say("     Using a real person's photograph for a fictional dead woman is not");
  say("     a thing to do casually. Swap in ones you have the rights to and");
  say("     the captions will carry them better than they carry these.");
  say();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
