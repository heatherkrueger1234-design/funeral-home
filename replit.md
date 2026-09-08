# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Required configuration

Both of these are required; the server refuses to start without them.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection. Provided by Replit. |
| `ENCRYPTION_KEY` | Base64 of 32 random bytes. Encrypts document contents and uploaded files at rest. |

Generate the key once with `pnpm --filter @workspace/scripts run generate-encryption-key`
and store it as a secret. **Keep a copy somewhere safe.** It is not recoverable,
and without the exact value the encrypted records and photographs cannot be read
back.

Optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUBLIC_URL` | none | The site's own address, which must be the domain that actually serves it. As of this writing that is `https://holdingtoday.com` — `holdingtoday.org` does not resolve. **Required** for Google sign-in and for password-reset links, because both build absolute URLs back to the site; point it at a domain that does not resolve and every reset link in every email is dead. No trailing slash. |
| `CORS_ORIGINS` | none | Comma-separated allowlist of cross-origin callers. Leave unset in the normal deployment, where the frontend and API share an origin. `*` is rejected. |
| `AUTH_RATE_LIMIT_MAX` | `20` | Auth attempts allowed per window, per IP. |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` | Length of that window. |
| `MAX_ACCOUNT_STORAGE_BYTES` | `2147483648` (2 GB) | Ceiling on uploaded files per account. Files live in the shared database, so without a cap one account can fill it and take the site down for everyone. |

## Before launching

Work down this list. Everything on it is a thing that, left undone, either
breaks a flow or loses somebody's writing.

- [x] **`CONTACT_EMAIL`** in `artifacts/holding-today/src/components/LegalPage.tsx`
      is set to `Holdingtodayapp@gmail.com`. The privacy policy and terms both
      name it.
- [ ] **Set `ENCRYPTION_KEY` and keep a copy somewhere that is not the host.**
      Generate it once with
      `pnpm --filter @workspace/scripts run generate-encryption-key`.
      It is not recoverable; without the exact value the encrypted records and
      photographs cannot be read back. Put a copy in a password manager and a
      second one somewhere offline.
- [ ] **Set `PUBLIC_URL`** to the domain that actually serves the site, with
      no trailing slash. Today that is `https://holdingtoday.com`; check before
      trusting this line, because it is the kind of fact that goes stale.
      `holdingtoday.org` has no DNS record at present, so setting it to that
      would put a dead hostname into every password-reset email. Google sign-in
      and password-reset links both build absolute URLs from it, and the Google
      redirect URI must match it character for character.
- [ ] **Set the SMTP secrets** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
      `SMTP_PASS`, `SMTP_FROM`) — see *Password reset email* below. Without
      them the "I forgot my password" link is hidden and reset links only go to
      the server log. This is the highest-value item on the list after the
      encryption key: until it is set, nobody who cannot get in can get
      themselves back in, and every recovery goes through you by hand — see
      *When someone cannot get in at all*.
- [ ] **Set the Google OAuth secrets** (`GOOGLE_CLIENT_ID`,
      `GOOGLE_CLIENT_SECRET`) — see *Google sign-in* below. Without them the
      Google button does not appear.
- [ ] **Schedule the database backup.** Run
      `pnpm --filter @workspace/scripts run backup-database` on a schedule and
      keep the dumps off this host. See *Backups* below. Each account can
      export its own data, but that is not a system-level backup: losing the
      database loses every family's writing.
- [ ] **If the database predates accounts**, run `adopt-legacy-data` and then
      `encrypt-existing-documents` — see *Migrating a pre-accounts database*
      below. `adopt-legacy-data` must run **before** `db push`.

One item on the original launch list is not code and is not done:

- [ ] **A funeral director or medical examiner reviews the body and autopsy
      chapters** in `src/content/first-days.ts` for factual accuracy. They are
      written to be accurate and are marked by state where the law varies, but
      they have not been reviewed by anyone in the profession.

## Backups

There is no managed backup of this database, so there is a script:

```bash
pnpm --filter @workspace/scripts run backup-database
```

It runs `pg_dump` against `DATABASE_URL` into `BACKUP_DIR` (default
`./backups`), names the file by timestamp, and prunes dumps older than
`BACKUP_RETAIN_DAYS` (default 30). It refuses to overwrite and exits non-zero
on failure, so a scheduler will surface a broken backup instead of silently
keeping none.

Two things matter more than the script itself:

1. **Run it on a schedule.** A cron entry, a Replit scheduled deployment, or
   any external scheduler. Hourly is not too often; the dump is small.
2. **Copy the dumps off this host.** A backup on the same disk as the database
   does not survive the failure it exists for. Set `BACKUP_S3_URL` (or sync
   `BACKUP_DIR` yourself) so a copy lands somewhere else.

Restoring is `psql "$DATABASE_URL" -f the-dump.sql`. Test that at least once
against a scratch database — an untested backup is a guess.

## Sign-in methods

Both of the following are optional, and the app adapts to what is configured:
the Google button only appears when Google is set up, and the "I forgot my
password" link only appears when email is. Offering a button that 404s, or a
reset link that silently sends nothing, is worse than not offering it — so
`GET /api/auth/methods` reports what actually works and the sign-in page
renders accordingly.

### Google sign-in

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth client id from the Google Cloud console |
| `GOOGLE_CLIENT_SECRET` | The matching secret |

Setting it up, once:

1. Go to <https://console.cloud.google.com/> and create a project (any name).
2. **APIs & Services → OAuth consent screen.** Choose **External**. Fill in the
   app name, your support email, and your developer email. Save.
3. Still on the consent screen, under **Test users**, add your own email while
   the app is in Testing. To let anyone sign in, press **Publish app** — for
   the `email` and `profile` scopes this app uses, no Google review is needed.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID.**
   Application type **Web application**.
5. Under **Authorised redirect URIs**, add exactly:
   `https://YOUR-DOMAIN/api/auth/google/callback`
   It must match `PUBLIC_URL` character for character, including `https` and
   with no trailing slash.
6. Copy the client id and secret into the two secrets above, and set
   `PUBLIC_URL`.

An account created this way has **no password**. It can add one later from the
account page, which is worth doing — losing access to a Google account should
not mean losing everything written about a child.

Linking: signing in with Google when an email/password account already exists
for the same address adopts that account, but **only when Google reports the
address as verified**. Otherwise anyone able to make Google emit an unverified
address of their choosing could claim someone else's account.

### Password reset email

| Variable | Purpose |
| --- | --- |
| `SMTP_HOST` | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | `587` (STARTTLS) or `465` (implicit TLS). Defaults to 587. |
| `SMTP_USER` | The mailbox that sends |
| `SMTP_PASS` | Its password or app password |
| `SMTP_FROM` | The From address. Defaults to `SMTP_USER`. |

Any SMTP provider works — this is deliberately not tied to one. For Gmail:
turn on 2-Step Verification on the Google account, then create an **app
password** at <https://myaccount.google.com/apppasswords> and use that as
`SMTP_PASS` (a normal Google password will not work). Host `smtp.gmail.com`,
port `587`.

Gmail caps how much a single account may send per day. That is generous for a
site this size, but if reset emails start bouncing, moving to Resend,
Postmark, SendGrid or Fastmail is a change to these five settings and nothing
else.

**With no SMTP settings, reset emails are written to the server log instead of
sent, and the "I forgot my password" link is hidden.** Nothing breaks and
nothing is silently swallowed — the link is in the log if it is ever needed.

### When someone cannot get in at all

There is one combination that leaves a real person stranded, and it is worth
understanding before it happens rather than after.

An account created through Google has **no password**. Password sign-in
refuses it with exactly the message it gives an address that was never
registered — "email or password is incorrect" — because saying "that one uses
Google" would confirm the address has an account here, and on this site that
means confirming someone has lost a child. Registering the same address then
answers "an account already exists". Both answers are correct and both are
deliberate. Together, on a deployment where Google is **not** configured and
SMTP is **not** configured, they are a locked door with no handle: the
password box always refuses, there is no Google button, and there is no reset
link.

Two things soften this. The sign-in page now says what failed instead of
sitting silent, and whatever is configured, it always offers `CONTACT_EMAIL`
as a route back. And the database holder can set a password by hand:

```bash
# who is in here, and how does each of them sign in?
pnpm --filter @workspace/scripts run accounts -- --list

# give one of them a password
pnpm --filter @workspace/scripts run accounts -- \
  --email someone@example.com --password 'a long passphrase'
```

`--list` flags every account with no password. Setting one verifies the hash
before writing it, so a format drift between the script and the server surfaces
there rather than at a sign-in that keeps refusing. The password is visible in
shell history — change it from the account page afterwards.

The authorisation for this is holding the database credentials, which is the
only authorisation that means anything at that layer. **Configuring SMTP is
what retires it**: with reset email working, people recover themselves and
nobody has to ask.

## Migrating a pre-accounts database

Run these once, in order, against a database created before accounts existed.
Both are idempotent and neither deletes anything.

```bash
# 1. Adopt every existing row into an account. Do this BEFORE `db push`:
#    the schema now has NOT NULL owner columns that a push cannot add to a
#    table that already has rows.
pnpm --filter @workspace/scripts run adopt-legacy-data -- \
  --email you@example.com --password 'a long passphrase'

# 2. Encrypt document contents written before encryption at rest.
pnpm --filter @workspace/scripts run encrypt-existing-documents
```

## The written guides

`artifacts/holding-today/src/content/` holds the guide pages as data rather
than markup — `first-days.ts`, `healing.ts`, `public-or-criminal.ts`,
`money-and-paperwork.ts`, `for-family-and-friends.ts`. All of them are
readable **without an account**, mounted in both routers in `App.tsx`, because
the parent who needs the chapter on viewing a body is standing in a hospital
corridor and is not going to register for anything first.

Two rules hold for anything added there. The first is enforced by the shape of
`content/types.ts` rather than by discipline:

1. **Anything whose answer depends on where you live goes in a `law` block
   with the state named.** Never in a paragraph. The state is a required field
   and it renders as a visible tag, so a parent in Ohio cannot be quietly
   handed Colorado's rules.
2. **The guide chapters stay general.** They describe what bereaved parents
   report, not one person's account, so a reader recognises themselves rather
   than reading a stranger's grief. The founder's own story is deliberately
   kept in one place instead — `src/content/about.ts`, rendered on the welcome
   page — and that file is her words and is not to be edited or smoothed. The
   note at the top of it says so.

The body and autopsy chapters in `first-days.ts` have not been reviewed by a
funeral director or medical examiner. That review is on the launch list above.

## The crisis line

`components/CrisisHelp.tsx` is mounted once in `App.tsx` **outside the auth
gate**, so the button renders on the welcome page and the sign-in form as much
as on someone's private journal. Do not move it inside `Gate` — the moment it
exists for is not one where somebody signs in first. `CrisisLine` is the same
numbers as flat text, used at the top of the guides.

## The small things, and the door

Two features that go together, in `routes/keepsakes.ts` and pinned by
`test/resurface.test.ts`.

**Keepsakes** are one question, one short answer — what their laugh sounded
like, what they ordered every time, what word they said wrong for years. The
prompt list is in `content/prompts.ts` and the rules for adding to it are at
the top of that file. The important one: nothing that grades the relationship.
No last words, no last fights, no "did I do enough". Those are real and they
are in the guides; putting them in a rotating prompt is ambushing somebody
with their worst hour over breakfast.

**Resurfacing is a door, not a notification**, and this is the constraint that
matters. The site's own guide tells people to turn off photo memory
notifications, because "you can go and look at him on purpose instead, which is
an entirely different experience from being ambushed by him." So nothing is
fetched until the panel is opened — `enabled: open` in
`SomethingYouWrote.tsx` is the feature, not a performance tweak — and there is
no email and no notification anywhere.

It draws **only** from memories, quotes, stories, keepsakes and the small
details on the profile. It must never read the journal, the letters or the
documents: that is where the 4am writing lives and where the autopsy report is
filed. Those tables are not imported into the route file at all, so a later
edit cannot reach them by accident, and a test draws sixty times to prove it.

Which items are treasures is decided by **starring**, never by ranking. That is
not a judgement anything here is qualified to make about somebody else's dead
child.

## Who the reader lost

`profile.relationships` is a multi-select — child, partner, parent, sibling,
friend, other — asked on the home page **after** signup and dismissible
forever. It is never part of first run, which asks for one thing and should
keep asking for one thing.

It **reorders and labels; it never hides.** A chapter written for another kind
of loss moves to the end of its group and says who it was written for. Grief is
layered — the person who built this site lost a son, her parents, her
grandparents, a baby and her best friend — and any design that made her pick
one box would have shut her out of most of what she needed.

Counting honestly, only six of sixty chapters are genuinely relationship-
specific, all in *What to expect*. The practical guides are universal already,
because an autopsy, a death certificate and a landlord do not care who died.

## Searching the guides

`routes/guides.ts`. Public, like the guides it searches.

**It returns chapter ids, never prose.** The model's only job is to pick from a
fixed catalogue; every word the reader then sees was written by a person. A
model answering "can I bury him on my land" directly would be confidently wrong
about a county it has never heard of, which is the whole reason `law` blocks
carry a state.

**Keywords always work.** The model is an improvement on the ranking, not a
dependency, and it falls back on a missing `OPENAI_API_KEY`, a bad status, a
four-second timeout, or an id it invented. Someone in the first week must never
get an error instead of the autopsy chapter. The test suite runs with no key at
all, so the fallback is the path under test.

A query that is itself somebody in trouble returns the crisis chapter and skips
the search. Describing how a child died is deliberately not treated as one.

## The shared room

`routes/community.ts` is the one place in this application where one account
can read another's writing. Everything about it follows from who is in the
room, and `test/community.test.ts` pins each property:

- **Reading requires an account.** It is mounted *below* `requireAuth`, unlike
  the guides, which are public on purpose. A parent writing about their child's
  death in a support room is picturing other bereaved parents, not a search
  engine. Making it public later is one line; making it private again after it
  has been indexed is not.
- **Pseudonymous, never anonymous.** Every row carries `userId`, and it never
  reaches another reader — the test asserts the exact set of fields a reader
  gets, so an author field cannot be added by accident. The id is what makes
  moderation possible at all.
- **A screen name is assigned when left blank** (`lib/screen-name.ts`), and is
  copied onto each post at publish time. Renaming yourself does not rewrite
  conversations you were already in.
- **`hiddenAt`, not deletion, for moderation.** Every read filters
  `isNull(hiddenAt)`. The author's own delete is a real delete, because their
  words are theirs.
- **Reports are rows, not a counter**, so `reportCount` means "how many
  people", which is the difference between a brigade and a real problem.

### Moderation is a job, not a feature

There is a queue at `/moderation` and it is visible only to accounts with
`users.is_moderator` set. That flag is granted **by hand in the database** and
by no route:

```sql
UPDATE users SET is_moderator = true WHERE email = 'you@example.com';
```

Somebody has to actually read that queue. A room like this one, unattended,
reliably fills with people selling things to the bereaved.

### The crisis check

`lib/crisis-check.ts` looks for first-person phrasing that suggests the author
may be in danger, and the *only* thing it does is ask the client to put the
crisis numbers in front of them after posting. It never blocks a post: a parent
who writes "I can't do this any more" and is refused has been taught that
saying it out loud gets them silenced.

It deliberately does not fire on the words "suicide" or "overdose" on their
own — on this site those are how a parent says how their child died, and firing
on them would show a crisis banner to half the people describing their loss.
There is a test for exactly that.

## Share links

`routes/shares.ts` is the only place this application returns somebody's
private writing without a session, so it is built narrow, and
`test/shares.test.ts` pins each property:

- A share names **one row of one kind**. The public reader re-reads it scoped
  to the sharer, so deleting the memory or revoking the link takes it down.
- Only the SHA-256 of the token is stored, exactly as sessions are. The token
  is emitted once at creation and never again — losing it means making a new
  link, and in exchange a database dump hands out nothing.
- The image endpoint reads the upload id **off the shared memory**, never from
  the request, so a link to one memory cannot be turned into a reader for the
  account's other files.
- The public router is mounted separately, above `requireAuth`, so the split
  cannot be lost by reordering a `router.use` line.

## Tests

`pnpm run test` pushes the schema to `DATABASE_URL` and runs the integration
suite against it. **It truncates every table between cases**, so point it at a
disposable database, never at one holding real data.

Two suites are worth knowing about before changing anything:

- `test/tenant-isolation.test.ts` asserts, for every resource, that one account
  can never reach another's rows. A new resource must be added to its
  `RESOURCES` list — that is the whole point of the file.
- `test/shares.test.ts` and `test/export-archive.test.ts` cover the two places
  data leaves the account: a public link, and an export.

`test/community.test.ts` is the third: it covers the shared room, which is the
only place one account can read another's writing.

The frontend has its own unit suite (`pnpm --filter @workspace/holding-today
run test`), mostly over `lib/upcoming.ts`, where the date arithmetic decides
whether a parent is told about their child's birthday on the right day.


## Security model

This application stores what a bereaved parent wrote about their child, and in
the documents table it stores medical records, autopsy reports and passwords.
Two rules hold everything up. Break either and the app leaks.

**1. Every row has an owner, and every query names it.**
`requireAuth` is mounted once in `routes/index.ts` ahead of all data routers,
so a new router cannot be exposed by forgetting middleware. Handlers then read
the owner with `currentUser(req)` and scope every query to `user.id` — selects
filter on it, inserts stamp it, and updates and deletes carry it in the WHERE
clause so another account's row is a 404 rather than a write. `userId` is
omitted from every insert schema, so it can never be supplied by a client.

Both halves are required. The gate proves *someone* is signed in; the query
scope proves they are looking at their own data.

`test/tenant-isolation.test.ts` asserts this for every resource. A forgotten
`.where` fails there.

**2. The sensitive columns are encrypted before they are stored.**
`documents.content`, `documents.notes` and uploaded file bytes are AES-256-GCM
encrypted with `ENCRYPTION_KEY`. This protects a leaked dump, an old disk, or
an over-broad replica. It does **not** protect against a compromised app
server, which must hold the key to show anyone their own data — see the note in
`lib/db/src/crypto.ts` for what defending against that would cost.

Sign-in specifics that follow from the same two rules:

- `passwordHash` is nullable, because a Google account has none. Every flow
  that used to assume a password exists now states what it does without one:
  password sign-in refuses, "forgot password" sends nothing, changing a
  password becomes adding one, and deletion is confirmed by typing the
  address.
- Google is only allowed to adopt an existing account when it reports the
  address verified.
- `/auth/forgot-password` always answers 204. Answering differently would make
  it a way to test whether a given person has an account here — which, on this
  site, means testing whether they have lost a child. The same reasoning is
  why password sign-in to a Google-only account returns the ordinary "email or
  password is incorrect" rather than something more helpful.
- Reset tokens are stored as digests, are single-use, expire in an hour, and
  redeeming one revokes every session and every other outstanding link.
- The OAuth callback checks a `state` value against a cookie. Without it an
  attacker can complete the flow in someone else's browser and leave them
  signed into the attacker's account.

Other things worth not undoing:

- Sessions are database rows keyed by the SHA-256 of the token, so sign-out and
  account deletion genuinely revoke, and a dump hands out no live sessions.
- Uploads are served by an authenticated handler, never a static directory, and
  their type is read from the file's own bytes rather than the browser's claim.
- Login hashes a dummy password when no account matched, so timing cannot be
  used to discover which addresses are registered.
- `CORS_ORIGINS` rejects `*`. With credentials enabled it is never safe.


## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`, then a JSON 404 handler and a central error handler
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /healthz` (full path: `/api/healthz`)
- Error handling: handlers validate input with `src/lib/http.ts` helpers (`parseBody`, `parseQuery`, `parseId`, `requireRow`) and throw `HttpError`; Express 5 forwards rejected promises to the error handler, so routes need no try/catch
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
