# Holding Today for funeral homes

A funeral home buys this to stop cat-herding grieving families through
paperwork and photo collection by text message at midnight.

It is deliberately **not** a case-management system. Homes already own one.
There is no invoice, no contract, no published price list and no venue booking
here, and those omissions are product decisions rather than gaps: the FTC
Funeral Rule governs how prices must be disclosed, and churches and cemeteries
keep their own calendars. What this owns is the collaboration with the family,
which is the part nobody has built.

Two things in here sit close enough to those lines to be worth stating
plainly. A home can keep a **price sheet**, but it is staff-only and there is
no setting that would show it to a family or put it on the public page -- it
is the crib sheet a director has open at a kitchen table, not a General Price
List, and `lib/db/src/schema/price-list.ts` explains at length why that
boundary is enforced by tests rather than by intention. A home can also
**offer a family a choice of service times**, but an offer is not a booking:
nothing here knows whether the church is free, and only times the director has
already confirmed by telephone belong in it.

## What it does

**1. The asset drop.** One mobile link, texted to the next of kin. Photographs
(a bin holding up to 1000, from which the family pulls out the ~50 that run in
the slideshow, with a portrait crop stored as instructions so the original
bytes survive), the obituary as named fields rather than a blank box, and the
hymns, readings and pallbearers as short lists. This replaces a director's
inbox holding forty attachments from six addresses.

**2. One contained thread.** Everyone on the family's side sees the same
conversation, so the "who told you that?" arguments settle themselves and the
director answers once. Office hours are *shown, never enforced* — a 2am message
is delivered at 2am and the family is told, before they send, when it will be
read, with the 24-hour number next to it. The thread locks a fortnight after
the service, for both sides.

**3. A timeline.** Four or five dated things, in plain words. Events (the
funeral) are distinguished from tasks (deliver the clothing) and cannot be
ticked off.

**4. Aftercare that costs no staff hours.** Closing a case enrols the family in
30/60/90-day and anniversary check-ins, signed in the home's name. Enrolments
start `pending` and send nothing until the family consents — they are shown
the actual dates and a decline of equal visual weight, and a no is final.

**5. The master page.** The screen a director opens first, and the only one
in the product that is not about a single case: who is waiting on a reply,
what went past due while they were at a graveside, what is happening this
week, and which cases have no service date at all -- that last one because
every step of the standard schedule is an offset from the service, so a case
without one has an empty timeline and a family who has been told nothing. The
cross-case inbox lives here too, for the same reason: one contained thread per
family is a promise kept case by case, and the cost was that the thread nobody
opened was the thread nobody answered.

It is also where a home edits the things that are theirs rather than any one
family's -- the words on their public page, the policies they repeat at every
kitchen table, their standard schedule, their own staff-only price sheet, and
the two rules that genuinely change what the software does (how long a thread
stays open after the service, and how many photographs to ask for).

Two things hold the rest together. The **standard schedule** is written once
per home as offsets from the service, and every case gets it automatically the
moment a service date exists — without it a director with four funerals this
week never builds a timeline and the anti-funeral-fog feature silently does not
happen. The **photo pack** is a ZIP in slideshow order, numbered, captioned,
with a `captions.txt` for the order of service, because collecting forty
photographs a director then saves by hand is most of the time back.

## Shape of the code

A pnpm workspace. `lib/api-spec/openapi.yaml` is the source of truth: orval
generates the zod validators the server uses and the react-query hooks the
frontends use, so a contract change cannot land on one side only. CI fails if
the checked-in generated code drifts from the spec.

```
lib/db              Drizzle schema. 28 tables, all reachable from funeral_homes.
lib/api-spec        openapi.yaml + orval config. The contract.
lib/api-zod         Generated: zod validators (server-side).
lib/api-client-react Generated: react-query hooks (+ hand-written multipart).
lib/mailer          SMTP. Shared, because the aftercare worker sends mail too.
artifacts/api-server Express. Two auth surfaces; see below.
artifacts/family-portal   What the family opens. Mobile-first, brandable.
artifacts/director-console What the home works cases from, and its master page.
scripts             Backups, and the aftercare sender.
```

### The security model, in three sentences

A `funeral_homes` row is the tenant and everything below carries
`funeralHomeId`. **Staff** carry a session cookie; `requireAuth` loads the home
from the signed-in user's own row, so a home id arriving in a path or body is
never what gets filtered on. **Families** have no account at all — they send
the token from their texted link as a bearer header, their routes mount under
`/family`, and none of those paths takes a case id, because the token names
exactly one case.

Both gates are mounted once, in `artifacts/api-server/src/routes/index.ts`.
Being reachable without authentication requires an edit to that file rather
than an omission somewhere else.

**Confirming a staff address.** Registration is open — a funeral home should
not have to ask us for an account — and until recently nothing checked that the
address belonged to the person typing it, so anyone could register under a real
home's name and have a public page, at a guessable URL, collecting the details
of people's deaths within a minute. Confirmation gates exactly one thing: the
request form on the home's public page. It gates nothing a director does —
signing in, opening a case, texting a family, printing, exporting — because a
director locked out of Thursday's funeral by an email in a spam folder would be
a far worse product than the one this protects against. Any active member of
staff's confirmed address counts, not only the owner's.

The link-as-credential trade is made deliberately: a registration form is where
a next of kin three days bereaved is lost, what sits behind the link is one
case's photographs and a hymn list, only the token's SHA-256 is stored, and one
click revokes it.

## Running it

Needs Postgres and an encryption key. For putting it on an actual host —
containers, TLS, backups, scheduled work — see [DEPLOY.md](./DEPLOY.md). For
what is kept, for how long, and how to get rid of it, see
[RETENTION.md](./RETENTION.md).

```sh
pnpm install
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/funeral_home
export ENCRYPTION_KEY=$(pnpm --filter @workspace/scripts run generate-encryption-key --silent)

pnpm --filter @workspace/db run push      # create the tables
pnpm run typecheck
pnpm run test                             # integration tests, real Postgres
pnpm run build
```

Environment the server reads:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Postgres. Required. |
| `ENCRYPTION_KEY` | 32 bytes, base64. Uploads are AES-256-GCM at rest; the server refuses to start without it. |
| `PORT` | Required. |
| `FAMILY_PORTAL_URL` | Origin used to build the texted link. Falls back to a relative path — an obviously incomplete link beats one that opens someone else's deployment. |
| `CONSOLE_URL` | Origin used in staff password-reset emails. |
| `SMTP_*` | Optional. Without it, mail is logged rather than sent, which keeps local development and the tests working. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Optional. Without them a director is handed the link to send themselves rather than being told nothing happened. |
| `SMS_DEFAULT_COUNTRY_CODE` | Defaults to `+1`. Used only for numbers typed without one. |
| `TASK_SECRET` | Shared secret for `/api/tasks/*`. Unset means scheduled work is refused, not open. |
| `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` | Optional. Without them the product runs on trial and charges nothing. |
| `STRIPE_WEBHOOK_SECRET` | Required if Stripe is configured — the webhook refuses anything it cannot verify. |
| `GOOGLE_PLACES_API_KEY` | Optional. Enables live vendor lookup; without it the directory is hand-entered. |
| `PLATFORM_ADMIN_EMAILS` | **Bootstrap only.** Comma-separated staff addresses seeded into `platform_admins` on the first start of an empty table, so a fresh deployment is reachable. After that the table is the list and this variable is never read again — which is what makes revoking somebody's access actually work. Unset means nobody, and an empty table means nobody. |

### Scheduling the aftercare

This is the part that earns the subscription, and it does nothing unless
something triggers it. Pick one:

```sh
# 1. Anything that can make an HTTP request, once a day. This is the one to
#    use — it works on an autoscale deployment that sleeps when idle.
curl -X POST "$API_URL/api/tasks/aftercare" -H "Authorization: Bearer $TASK_SECRET"

# 2. From a machine with the repo checked out.
pnpm --filter @workspace/scripts run send-aftercare -- --dry-run

# 3. A plain cron line.
0 14 * * * curl -fsS -X POST "$API_URL/api/tasks/aftercare" \
             -H "Authorization: Bearer $TASK_SECRET"
```

`.github/workflows/aftercare.yml` already does (1) daily at 14:00 UTC —
mid-morning across the US, because 3am is a bad time to receive a message
about somebody who died. It needs two repository secrets, `API_URL` and
`TASK_SECRET`, and `TASK_SECRET` must match the server's. **Without
`TASK_SECRET` set on the server the endpoint refuses every request**, which
is deliberate: an unauthenticated endpoint that sends email is not something
to leave open by default.

### The trial reminders

The other scheduled job, and the one that decides whether any of this gets
paid for. A week before the trial ends, the day before, and on the day, the
home's owner gets a plain note saying where they stand and what changes — which
is almost nothing, and saying so is the honest part.

```sh
curl -X POST "$API_URL/api/tasks/trial-reminders" -H "Authorization: Bearer $TASK_SECRET"
```

`.github/workflows/trial-reminders.yml` does this daily at 15:00 UTC, an hour
after the aftercare run. A separate workflow rather than a second step, for the
same reason it is a separate endpoint: a mail failure while telling a
proprietor about their bill must never be the reason a widow's ninety-day
check-in did not go out.

Each reminder is claimed with a conditional update before it is sent, so two
overlapping runs cannot both send it. The trade is the same one aftercare
makes, in the same direction: a crash losing one reminder is much better than
its opposite, which is a proprietor receiving the same notice four times from
the company holding their families' photographs.

Add `?dryRun=1` to see what is due without sending or marking anything —
that is how to check a new deployment is wired up without writing to a
bereaved family.

Deliberately *not* an in-process timer. This deploys to an autoscale target
that sleeps when idle and runs several instances when it is not, so a
`setInterval` there fires unpredictably or four times at once.

The run claims each delivery with a conditional update before sending, so two
overlapping triggers cannot both take the same row — the failure it trades for
(a crash losing one check-in) is much better than its opposite, which is
sending a widow the same message twice. Consent is re-checked at send time,
not when the schedule was written.

## The print studio

Six ready-made layouts at real trade sizes — prayer card, bookmark, folded
and single-sheet orders of service, register page, thank-you card. A director
picks a template and fills the slots; the case already knows the name, the
dates, the portrait and the service details, so most of them arrive filled.

Deliberately **not** a drag-and-drop canvas. Templates declare *named slots*,
never coordinates, because a canvas is how a name ends up 3mm into the fold
and nobody notices until two hundred are printed. What a director chooses is
which template and what goes in it.

Output is print-ready HTML with an `@page` rule in inches and standard
0.125in bleed, rendered self-contained with the photograph inlined. Every
browser already has a competent PDF writer behind Ctrl-P that handles fonts
and colour profiles better than a library bolted on here would, a director can
look at it before committing, and the file can be emailed to the print shop
as-is. Imposition is left to the shop, because every shop's equipment
disagrees and guessing wastes two hundred sheets.

Nothing is shipped in the snippet library, and that is on purpose. Most of
what goes on a prayer card is somebody's copyright and is not ours to
distribute to two hundred funeral homes — and a home already has this list,
in a Word file every director copies from, reflecting its own community and
denominations. This is somewhere to put that file once. Homes mark what they
have the right to print, because we cannot know and pretending to would be
worse than asking.

## Money, and what it gates

Billing lives in Stripe. What this app keeps is only what it needs to answer
its own question — may this home open another case — plus the ids to find the
subscription again. Prices, cards, invoices, tax and dunning stay on Stripe's
side, because a second source of truth for money is always the wrong one.

The subscription gates exactly one action: **opening a new case**. Everything
else keeps working in every state, deliberately. A family part-way through
uploading photographs of their mother must not lose access because the home
changed plans, and `past_due` still opens cases — a card that expired is an
administrative problem, and locking a director out of Thursday's funeral over
it would be a disgrace. Stripe chases the payment; `canceled` is the state
that actually stops new cases.

New homes get a 30-day trial, dated from registration so "when does this end"
has an answer from the first minute.

## Tests

`artifacts/api-server/test` runs against a real Postgres with no mocks, because
almost everything that could actually go wrong here is a query returning the
wrong rows — a missing tenant filter, a join that leaks another home's case —
and a mocked database cannot fail that way.

The two files worth reading first are `tenant-isolation.test.ts` (one home
cannot reach another's cases; a link reaches exactly one case; one family
member cannot delete another's photograph) and `case-lifecycle.test.ts`, which
walks a case from the call coming in to the family consenting to aftercare.

## The platform admin console

`artifacts/admin-console` is the third front end, and the only one that is not
for a funeral home. It is where the business looks at its own customers: the
list of homes, what each one is using, and — the part that earns its keep in
Colorado this year — where each home stands with DORA.

**How you get in.** A platform admin is a signed-in staff account that is also
named in the `platform_admins` table. That is on purpose: one way to authenticate
in this application means one cookie to protect, not two. Being on the list is
an *additional* condition and never an alternative one, and an empty list
means nobody. `routes/admin.ts` applies that check under `/admin`, below the
ordinary session gate. The account's address must also be **confirmed**: the
list names addresses and registration never checks them, so without that
anybody could register under a listed address nobody had claimed yet (the
bootstrap address before its owner signs up is the obvious one) and walk in.
On a fresh deployment, register, click the confirmation link, then sign in.

**What an operator can do for a caller.** Find their home from the exact
address they give (never shown back), see whether each person at the home
has finished their invitation and confirmed their address, and email any of
them a fresh password-reset link — to their own inbox, audited, and never
shown in the console, because a link the platform could see is a sign-in as
that director. The overview says whether mail and SMS are configured and how
many aftercare check-ins failed to send in the last thirty days.

The list is `platform_admins`, and access can be granted and revoked from the
console's own Admins page — both audited. It used to be an environment
variable, which cost two things: granting or revoking meant a redeploy, so in
practice the list went stale, and a variable leaves no trace, so "who could
see our families' files last March" had no answer. `PLATFORM_ADMIN_EMAILS`
survives as a one-time bootstrap for an empty table and is never read again.

A platform admin needs a staff account, a staff account needs a
`funeral_homes` row, and that row is not a customer. Mark it with
`internalAccount` — `PUT /admin/homes/:id/internal` — and it leaves the homes
list, the counts and the engagement figures while staying an ordinary tenant in
every other respect. Without it the console reported three homes on trial when
one of the three was us.

**What it may do.** See everything, change almost nothing. Creating a home and
suspending a home are the complete list of writes that touch a tenant. There
is no route that edits a case, an obituary, a photograph or a family contact,
and there is not meant to be — Section 2 of `COLORADO.md` has the reason: we
are the processor and the home is the controller.

**Cross-tenant reads.** Every one goes through a helper in `routes/admin.ts`
whose name begins with `platform`, and every one of those writes a row to
`platform_audit` before returning. `tenant(req)` is never called in that file.
The log is readable from the console's own Access log page, because a log
nobody can see is a log nobody checks — and because "here is every time anyone
at the vendor looked" is an answer a funeral home's insurer accepts.

**Suspension** stops a home opening new cases and does nothing else. Existing
cases stay reachable and families part-way through keep their access, for the
same reason a cancelled subscription does not lock a director out of
Thursday's funeral.

**Colorado licensure** is tracked per home in `home_licensure` and
`practitioner_licences`: registration number, registered services, appointed
designee, renewal date, and each practitioner's standing and expiry. The
1 January 2027 deadline and the thirty-day amended-registration rule surface
as plain sentences through `licensureReminders`. Nothing there is ever red and
nothing counts down — see the comment on `Reminders.tsx` for why that is a
rule rather than a preference.

**Engagement numbers** are counted in `platformEngagementFor`, which is a
placeholder. Component 6 owns how engagement is computed; when it lands, that
function's body becomes a call to theirs and its shape stays. Do not add
cleverness to it in the meantime — two definitions of "engaged" is worse than
none.

## The legal documents

[`LEGAL/`](./LEGAL/) holds three drafts: the [terms](./LEGAL/TERMS.md), the
[data-processing agreement](./LEGAL/DPA.md), and the
[privacy policy](./LEGAL/PRIVACY.md). The DPA is the one that matters
commercially — a funeral home's insurer asks for it before the home's director
asks for a demo.

They were written against the code rather than from a template, so their
factual claims are checkable, and [`LEGAL/README.md`](./LEGAL/README.md) cites
the file behind each one. That cuts both ways: writing them turned up a claim
that was not true (photograph EXIF is only stripped from images over 3000px,
so an ordinary upload keeps its location data), which is now disclosed rather
than asserted away. **If you change something a claim depends on, change the
claim.**

None of the three has been reviewed by a lawyer, and they contract on behalf of
a company whose name is still a placeholder. Do not put them in front of a
paying customer yet.

## Relationship to Memory-Haven

This repository began as a fork of Memory-Haven (`holdingtoday.com`) at
`6e79cb4`, for its workspace layout, auth, encrypted uploads and component set.
The two have diverged: Memory-Haven models one bereaved person keeping a
private archive, this models a funeral home working a case with a family.
Nothing here changes anything there.
