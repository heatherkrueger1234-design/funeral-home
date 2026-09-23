# Launch readiness

An honest assessment, written against what has actually been run rather than
what is supposed to work. Dated at the last commit on
`claude/funeral-home-portal-uj9bik`.

## The one-line answer

**Ready for a supervised pilot with a handful of funeral homes. Not ready to
sell unattended, and not ready to bill anybody today.** The product works end
to end, the data is safe, and the whole stack builds and runs in containers.
What is missing is operational: it has never run on a real host with real TLS,
real mail, or a real payment, and no real family has ever used it.

The pricing model — base subscription, per-funeral metering, the aftercare
add-on and group contracts — is built and tested, but no price exists in
Stripe and no live charge has ever been taken. `PRICING.md` has the five-step
checklist, and step five is deciding the numbers.

## What has been proven by running it

Not by tests alone — these were executed against a real PostgreSQL with the
production esbuild bundle, through the real nginx config:

- A home registers, opens a case, invites a family, and the family uploads a
  genuine iPhone HEIC that comes back as a JPEG (383,240 bytes).
- Twelve photographs stream out as an uncorrupted slideshow zip.
- A family who has never been sent a link asks a home to open one, and a
  director accepts it; a second director accepting the same request gets a 409
  and no second case appears.
- Someone arranging their own funeral fills in a pre-need file, closes it, and
  is **not** enrolled in grief check-ins. Years later the home records the
  death and the obituary and photographs are still there, with the funeral
  schedule now built.
- `pg_dump` → `DROP DATABASE` → restore, with an encrypted photograph matching
  byte-for-byte and an encrypted SSN decrypting afterwards.
- A case exports as a folder that opens without this software, and exports
  **after the home has cancelled**.
- A case erases for real: the encrypted photo bytes are gone from `uploads`,
  not merely unreferenced.
- **All four container images build**, the stack comes up with every container
  healthy, migrations apply through the `tools` container, a family uploads a
  real HEIC through nginx into the API container, and a backup taken inside the
  containers restores and verifies. A full restart leaves the photograph
  byte-for-byte identical.

350 tests, 6 projects typechecking, 5 apps building — from a clean
tree, with no environment variables set.

## Lighthouse scores

Run against production builds served the way nginx serves them (gzip, the
cache headers, the real CSP from `deploy/security-headers.conf`) with a seeded
case behind a real API. The family portal was scored as a phone on throttled
mobile data, which is how families open it; the consoles as desktop.

| Page | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| Family hub (`/f/<token>`) | 82 → **97** | 95 → **100** | 100 | 54 → 63* |
| Home's front door (`/start/<slug>`) | 84 → **98** | 100 | 100 | 54 → 63* |
| Director dashboard | 82 → **100** | 100 | 100 | 54 → 63* |
| Case page | 100 | 95 → **100** | 100 | 54 → 63* |
| Settings | 100 | 94 → **100** | 100 | 54 → 63* |
| Sign-in (director, admin) | 100 | 100 | 96† | 54 → 63* |

On the family hub, first paint went from 3.2s to 1.5s and layout shift from
0.12 to 0.

\* **63 is the ceiling, on purpose.** The only failing SEO audit is "page is
blocked from indexing", and it is blocked on purpose: a search engine indexing
a portal that names someone who has just died is the failure, not the score.
Everything else in the category passes.

† The sign-in page asks `/auth/me` whether anybody is already signed in, and
the answer "no" is a 401, which the browser logs. It is the correct answer.

What moved the numbers:

- **Fonts are self-hosted.** They were an `@import` of Google Fonts inside the
  bundled CSS, which put two extra origins and three sequential round-trips in
  front of the first word. They are now bundled from `@fontsource-variable`,
  the Latin files are preloaded, and the CSP no longer allows Google at all.
  It also stops every visitor's IP address going to a third party.
- **Screens are loaded when opened.** The hub, the front door, the sign-in
  and the dashboard ship in the first download; everything else is its own
  file. A stale tab after a deploy reloads itself once instead of breaking.
- **Nothing jumps.** The dashboard waits for billing before drawing, so the
  setup checklist no longer lands on top of the tiles; the hub draws the
  "Next" card at once from the count it already has; the consoles reserve the
  scrollbar gutter.
- **Secondary grey text passes contrast** on every surface, not just the
  paper (`#6a6f68` → `#5f645d`).
- **Every dropdown has a name** a screen reader can say.
- **`/robots.txt` exists.** It used to be answered with `index.html`. Every
  response also carries `X-Robots-Tag: noindex, nofollow`.

## What is not ready

| Gap | Severity | What it would take |
| --- | --- | --- |
| ~~The container images have never been built or run.~~ **Done.** All four build; the stack comes up healthy, migrates, serves, backs up and restores. Two real bugs were found doing it. | Cleared | — |
| **No production deployment exists.** Nothing is running anywhere. TLS is now built into the stack (Caddy, automatic Let's Encrypt), and the proxy chain was tested end to end. | **Blocking** | A host, three DNS records, `docker compose up`. An hour or two. |
| **No real family has ever used the family portal.** Every test is synthetic. | **High** | One pilot home, one real case, watch what happens. |
| **Email and SMS are unconfigured.** Password resets, address confirmations, staff invitations, trial reminders, aftercare and intake alerts are written to the log instead of sent. The email side is ready and tested against a real SMTP server; it needs an account. | **High** | A mail provider account, its DNS records, and `send-test-email` landing in an inbox rather than spam (DEPLOY.md, "Email"). A Twilio number. |
| ~~Nothing ever told a home its trial was ending.~~ **Done.** A week before, the day before, and on the day, claimed before sending so nobody gets it twice. `trial-reminders.yml` fires it daily. | Cleared | — |
| ~~Registration checked nothing: anyone could register under a real home's name and have a public page collecting deaths.~~ **Done.** The public request form now waits on a confirmed staff address, and gates nothing else. | Cleared | — |
| ~~Three emails linked to `/reset-password`, which did not exist — so password resets failed and every staff invitation silently went nowhere.~~ **Done.** Both landing pages exist, and a home can add its second employee. | Cleared | — |
| ~~The platform admin list was an environment variable, so revoking access needed a redeploy and left no trace.~~ **Done.** `platform_admins`, granted and revoked from the console, both audited. | Cleared | — |
| ~~The vendor's own tenant was counted as a customer.~~ **Done.** `internalAccount` takes it out of the list, the counts and the engagement figures. | Cleared | — |
| **No terms of service, no privacy policy, and no data-processing agreement.** `COLORADO.md` says we are the processor and the home the controller, and that "the data-processing agreement says so" — there is no such document. | **Blocking** | A lawyer. It is the thing a home's insurer asks for before the home's director does. |
| **There is no price.** The Stripe plumbing is correct and `STRIPE_PRICE_ID` is unset; nothing anywhere says what this costs. | **Blocking** | A decision, then one test-mode charge. |
| **No error tracking and no uptime monitoring.** When it breaks at 2am before an 11am funeral, we find out from the director. | **High** | Sentry and a check that pages a phone. |
| **The Colorado 72-hour clock is documented, not built.** The licensure tracker exists; the death-certificate deadline and the statutory authorisation order (C.R.S. 15-19-106) do not. Components 5 and 6 never landed. | **High** | The sales story is currently larger than the product. |
| **Stripe has never taken a real payment.** The webhook signature check is tested; a live charge is not. | **High** | Test-mode keys, one real subscription cycle. |
| **No prices exist in Stripe.** The per-case meter, the aftercare add-on and the group contract are all built and tested against a stubbed Stripe; none of them has a price behind it. Until `STRIPE_PRICE_ID_CASE` and `STRIPE_CASE_METER_EVENT` are set, every home is invoiced for a flat subscription and nothing says so. | **High** | Five environment variables and one test-mode cycle. `PRICING.md` has the checklist. |
| **The usage reporter has never run on a schedule.** Same failure the aftercare job had for most of this product's life: the thing that turns work into revenue does nothing until something triggers it. | **High** | Set `TASK_SECRET` and schedule `usage.yml`. |
| **The memory book has no screens.** The API is complete and tested — the life story, the eulogies, the celebration page, the photograph dating, the curation and the printing — but neither the family portal nor the director's console has a page for it yet, so today it is all reachable only over the API. | **High** | A page in each front end. Nothing in the data model needs to change for it. |
| **Printed cards show the service time in the server's timezone.** Pre-existing, in `print-render.ts`, and unrelated to the memory book — which formats in the home's own timezone and has a test for it. A prayer card printed on a UTC host states the wrong hour. | Medium | One argument, and a test. The book's `formatServiceWhen` is the pattern. |
| **Groups have no console.** The API is complete — create, move locations, consolidated checkout, all audited — but the admin console has no screen for it, so a group is set up with curl. | Medium | A page in Component 2. Fine for the first one or two groups, which will be set up by hand anyway. |
| **One API instance, one Postgres, no replication.** | Medium | Fine for a pilot. Not fine at fifty homes. |
| **Uploads live in Postgres.** Encrypted, correct, and the wrong long-term home for gigabytes of photographs. | Medium | Object storage, when a home's database gets uncomfortable. |
| **Backups land on the same host** until somebody copies them off. | Medium | An offsite copy job. `DEPLOY.md` has the command. |
| **The in-memory rate limiter does not survive a restart or a second instance.** | Low | The public front door already has database-backed hourly ceilings behind it; the rest would want Redis at scale. |
| **No load test.** A home uploading 1000 photographs at once is untried. | Low | The zip ceiling is now checked before streaming, which was the sharp edge. |

## Decisions that look like gaps and are not

These were chosen, and the reasoning is in the code next to them:

- **The family is never charged for anything.** Not for the obituary, not for
  the slideshow assembled from photographs they uploaded themselves, not for
  the memory book, not after the home cancels. This is the most frequently re-proposed change to the
  product and `PRICING.md` argues it out in full; `no-family-charges.test.ts`
  fails the build if it ever stops being true.
- **A home billed per funeral is billed once per funeral, and never for a
  pre-need file.** Counting happens locally when the case opens and is
  reported to Stripe later, so no director ever waits on `api.stripe.com` to
  open a file for a family on their way in.
- **No published price list, no invoices, no contracts.** The FTC Funeral Rule
  governs how prices are disclosed, and every state's pre-need statute differs.
  A national SaaS generating that paperwork would be selling homes a compliance
  problem. This holds the collaboration with the family; the home's own systems
  hold the sale. A home *can* keep a staff-only price sheet, and the line is
  drawn hard: no family route and no public route reads it, and
  `price-list.test.ts` fails the build if one ever does.
- **Offered service times are offers, not bookings.** A home can put two or
  three times in front of a family and let them pick, and picking sets the
  service date and builds the timeline off it. What the product never claims
  is that the slot is held: churches and cemeteries keep their own calendars,
  and only times the director has already confirmed belong in the list.
- **The memory book collects for a year and then prints.** The grief check-ins
  ask whether anything has come back to the family, and what accumulates is a
  whole book: the life story from birth, written a chapter at a time by
  whoever knows a piece of it; the obituary; the photographs in the order they
  were taken, captioned with how old she was; the day itself with its order of
  service; the eulogies; the memories; and the photographs from the funeral at
  the back. Every section is a switch that defaults on and prints nothing when
  it is empty, so a home that wants a plain photograph album still gets one. It is the thing that makes "we
  stay in touch" a claim a home can put on a table rather than a claim every
  home makes. A family link is extended while a book is open, because
  otherwise the collection dies three months before the anniversary it was
  built for — `RETENTION.md` sets out the limits on that.
- **No automatic deletion of case data, ever.** Retention is set by state law
  and by the home's insurer. A default that purged at 36 months would destroy
  records a home is obliged to keep. See `RETENTION.md`.
- **The vendor directory ships empty.** Inventing plausible headstone
  companies and telephone numbers would produce numbers a grieving family
  would actually dial.
- **The hymn and poem library ships empty.** Shipping verbatim published text
  is a copyright problem the homes would inherit.
- **Office hours are shown, never enforced.** A 2am message is delivered at
  2am; the family is told when it will be read and given the 24-hour number.
  Silently holding it would be worse than the midnight text this replaces.

## Before the first pilot home

1. Point DNS for the three hostnames at the host, open ports 80 and 443,
   then build and bring the stack up. Caddy fetches the certificates itself;
   watch `docker compose logs caddy` until all three are obtained.
2. `pnpm --filter @workspace/db run push`, then load the ZIP centroids.
3. Configure SMTP and run `send-test-email` until it lands in an inbox rather
   than spam. Without it, a director who forgets their password cannot reset
   it, a new member of staff cannot be invited, no home is ever told its trial
   is ending, and no home can switch on its own public request form — all of
   them land in the server log instead.
4. Set `TASK_SECRET` and schedule **all three** jobs in one sitting, because
   each is silent until something calls it and each is silent in a way that
   costs you something different:
   - **aftercare** (`aftercare.yml`) — the feature the subscription is really
     for;
   - **usage** (`usage.yml`) — what turns funerals into revenue;
   - **trial reminders** (`trial-reminders.yml`) — how anyone comes to pay in
     the first place.
5. Take one backup, then run `verify-backup` and watch it restore.
6. Generate `ENCRYPTION_KEY` and **put a copy somewhere that is not the host
   and not the backup.** Losing it loses every photograph.
7. Put the home's public page URL on their website, from Settings.

## Before selling to homes you cannot ring

- A second API instance and a managed Postgres with point-in-time recovery.
- Offsite backups, automatically.
- Uptime monitoring that pages a human, not a dashboard nobody opens.
- A support route that is not "email the developer".
- A written incident plan for the case that matters: the encryption key is
  compromised, or lost.
