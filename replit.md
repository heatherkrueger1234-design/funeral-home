# Holding Today for funeral homes

A funeral home buys this to stop cat-herding grieving families through
paperwork and photo collection by text message at midnight.

It is deliberately **not** a case-management system. Homes already own one.
There is no price list, no invoice, no contract and no venue booking here, and
those omissions are product decisions rather than gaps: the FTC Funeral Rule
governs how prices must be disclosed, and churches and cemeteries keep their
own calendars. What this owns is the collaboration with the family, which is
the part nobody has built.

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
lib/db              Drizzle schema. 15 tables, all reachable from funeral_homes.
lib/api-spec        openapi.yaml + orval config. The contract.
lib/api-zod         Generated: zod validators (server-side).
lib/api-client-react Generated: react-query hooks (+ hand-written multipart).
lib/mailer          SMTP. Shared, because the aftercare worker sends mail too.
artifacts/api-server Express. Two auth surfaces; see below.
artifacts/family-portal   What the family opens. Mobile-first, brandable.
artifacts/director-console What the home works cases from.
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

## The storefront, the price lists and the statement

The home's own merchandise, at the home's own prices, and the three price
lists the FTC Funeral Rule requires a funeral provider to be able to produce.

**It ships empty, and that is the feature.** There is no starter catalogue, no
suggested pricing, no typical markup and no default urn anywhere in
`lib/db/src/schema/catalogue.ts` or any migration of it. A home's merchandise
and what it charges for it are its margin, its livelihood and its own Funeral
Rule disclosure — and a vendor whose software has an opinion about either is
competing with the selection room it was sold to. The only thing this system
knows about a price is which number to print.

Homes load their own with **`/api/catalogue/import`**, which reads the CSV
they already have. Columns are guessed and previewed before anything is
written; anything labelled cost or wholesale is deliberately never read as a
price, because those columns sit right beside the retail one in every
supplier's export and importing one would publish a home's margin on a sheet
a family reads.

### What the Funeral Rule shapes

The Rule binds the *home*, not us. Our job is a storefront a home can use
without breaking it, so these are enforced rather than suggested:

- **Every item carries its own price.** Packages exist in addition, never
  instead: choosing one writes its members as ordinary itemised lines plus a
  single adjustment carrying the saving, so declining any one of them removes
  the item, drops the adjustment and moves the total in front of the family.
- **The catalogue prints as a General Price List, a Casket Price List and an
  Outer Burial Container Price List**, from
  `artifacts/api-server/src/lib/price-list-render.ts` — print-ready HTML on
  letter paper, sharing its escaping with the print studio next door.
- **No casket reaches a family before the General Price List does.** The gate
  is on the server (`mayShowCaskets`), not drawn in the interface and hoped
  for: casket and outer-burial-container categories are not returned, and
  adding one to a selection is refused, until the home has dated a price list
  and this family has been given it — by opening it, or by a director
  recording that they handed one across the desk.
- **A family bringing their own casket or urn is charged nothing**, and there
  is nowhere to put a fee if somebody later wants one. A provider may not
  refuse a third-party casket or surcharge for handling it, so that path has
  no price in its request body, no price in the row it writes, and a check
  constraint on `merchandise_selection_items` that refuses one.
- The GPL's required disclosures are **slots we name and words the home
  writes**. The Rule prescribes what each must convey; a national SaaS typing
  the paragraphs for two hundred homes would be giving legal advice it is not
  qualified to give.

### The statement, and the handoff

A confirmed selection is the **Statement of Funeral Goods and Services
Selected**, generated from what the family actually chose and printable by
both sides. Names, sections and prices are snapshotted onto the line when it
is added, so a home raising its prices in March cannot rewrite what a family
agreed in February.

**No money moves through this product.** A confirmed at-need statement ends
with the home's own payment page, at the home's own processor, with the
destination host printed underneath — a message about money sent to a
bereaved family is exactly what a scammer imitates, so ours has to be boring,
expected and visibly theirs. With no link set, the family is asked to
telephone, which is an answer rather than an error. The "settled" mark is a
director reading their own books and the copy says so; nothing here implies
we received or confirmed a payment, because we cannot know.

**A `pre_need` case has no payment path at all** — not in the interface, not
in the API, not on the printed sheet, which says plainly that it is a plan
and not a bill. Selling a preneed contract in Colorado needs a Division of
Insurance licence, a bond or $100,000 of net worth and 85% of the money in
trust; there are two lawful funding methods and neither is a payment link.

`storefront.test.ts` carries a test that reads this component's own source and
fails if a card field, a balance or a second Stripe surface ever appears in
it. Everything else in that file would still pass if one did.

One more absence is worth naming, because it is a sentence in the interface
rather than a rule: once a director ticks a statement off against their own
books, the family stops being offered a way to pay it. Asking somebody to pay
again for their mother's funeral is the worst version of that screen there is.

### A note on `additionalProperties: false`

The spec marks the no-fee bodies `additionalProperties: false`, and orval does
not carry that through to `.strict()` — a generated validator *drops* an
unknown key where the spec says to refuse it. For most bodies that is what we
want. For "we are bringing our own" it is not: a client attaching a fee to a
third-party casket must be told no, because the difference between "refused"
and "silently ignored" is the difference between a rule the product enforces
and one it merely happens to obey today. `assertNoExtraKeys` in
`artifacts/api-server/src/lib/storefront.ts` puts it back. If orval ever
learns to emit `.strict()`, delete it.

## Engagement, Colorado's clock, offered times and the aftercare handoff

Four things in one component, because they are the same problem seen from four
angles: this product's whole relationship with a family after the director
closes the laptop is a handful of messages and a handful of dates, and every
one of them is either legally timed or legally consented.

### Counting happens once

`artifacts/api-server/src/lib/engagement.ts` is the only place in this codebase
that counts anything, and two audiences read the result.

`engagementForCase` answers the director's question — "did that text land, and
is this family stuck?" It returns who has opened their link, who is
contributing, what is outstanding, and an `attention` list of plain sentences
about what has not happened yet. `engagementForHomes` answers the platform
admin's — "are these homes getting value?" — and is the shape the admin console
renders, per home and summed across all of them.

**Nothing in either ranks a family.** No score, no percentage, no league table,
and no column that could become one. A family that has not uploaded photographs
of their mother is not failing at anything; they are three days bereaved. The
director gets a sentence they can read out on the telephone, and that is all.

### Colorado's deadlines apply themselves

`COLORADO_STATUTORY_DEADLINES` in `lib/db/src/schema/engagement.ts` carries the
state's real clock: the certificate of death filed within 72 hours of taking
custody and before disposition, medical certification within 72 hours of the
EDRS request, embalming or refrigeration once 24 hours have passed since the
death, and the disposition permit and cremation authorization before a
cremation. They are built on read rather than behind a button — a home that has
to press something to be told about its own 72 hours gets told about them by
the registrar instead — and the only thing a director does is confirm the two
dates nothing can derive: when custody was taken, and when the EDRS request
went out. Until they do, custody is proposed as the moment the case was opened
and `custodyAssumed` says plainly that it is a proposal.

They live in `case_statutory_deadlines` rather than on `case_deadlines`, and
the reason is the family. `case_deadlines` is the timeline a widow reads on her
own page; "File the certificate of death — 72 hours" is the home's legal
obligation, not her homework, and putting it there would both alarm her and
inflate the count of what she still has to do with paperwork that was never
hers. Nothing about any of this is rendered in red, as a countdown, or as
anything other than a sentence — `describeStanding` writes that sentence once
so every screen says the same one.

### The home offers times, the family picks

`appointment_slots` is deliberately not a calendar. The home already owns one,
and synchronising with it is a different product with a different failure mode.
This holds the handful of windows a director chose to offer this week. A family
takes one with a conditional update, so two daughters tapping the same eleven
o'clock produce one booking and one "somebody took that one first" rather than
two families in the same room. A slot the home takes back is withdrawn rather
than deleted, so the family holding it is told instead of watching it vanish.

There is no endpoint anywhere that accepts a date a family typed. A date nobody
read is how a family ends up outside a locked chapel.

### Consent, and the one door out

The TCPA carries statutory damages per message. So consent is a row with a
timestamp and a source — `messaging_consents` — never a boolean on a contact,
and `sendConsentedSms` in `artifacts/api-server/src/lib/consent.ts` is the only
function in this component that texts. It reads consent at send time rather
than at queue time, names the home in the message, and carries the way out.
`test/engagement.test.ts` proves a new sending path refuses without it.

Consent is keyed on the address rather than on the contact, because contacts
are per-case and a person is not: a stop sent during her father's funeral in
March has to still be honoured during her mother's in November. `revokedAt` is
final — no screen re-grants it, a director's console cannot toggle it, and
`recordConsent` refuses outright for a revoked address. The way back is a
telephone call to the home, which is how a funeral home does everything else.

STOP arrives at `POST /api/sms/inbound`, above every gate like the Stripe
webhook and for the same reason — a carrier has no session — and guarded by
Twilio's own request signature instead. A deployment with no `TWILIO_AUTH_TOKEN`
refuses the endpoint outright rather than accepting unsigned requests. A stop is
honoured across every message type, the aftercare check-ins included, and
across every home rather than only the one that sent the message: over-revoking
costs a home one message it wanted to send, and under-revoking costs it 500
dollars a message.

### The aftercare handoff

After the service the working surfaces recede and what is left is what the
family keeps: the photographs, the obituary as it was published, the order of
service, and the check-ins still to come. `GET /api/family/keepsake` returns
that, with a `phase` of `arranging` or `keeping`. Nothing is deleted and
nothing is locked — the family can still open every screen — they simply stop
being the first thing on the page.

**Built inside this product.** It is not a handoff to another application and
must not quietly become one; see `Remember-Me/README.md` for why that
separation is load-bearing.

## Tests

`artifacts/api-server/test` runs against a real Postgres with no mocks, because
almost everything that could actually go wrong here is a query returning the
wrong rows — a missing tenant filter, a join that leaks another home's case —
and a mocked database cannot fail that way.

The two files worth reading first are `tenant-isolation.test.ts` (one home
cannot reach another's cases; a link reaches exactly one case; one family
member cannot delete another's photograph) and `case-lifecycle.test.ts`, which
walks a case from the call coming in to the family consenting to aftercare.

## Relationship to Memory-Haven

This repository began as a fork of Memory-Haven (`holdingtoday.com`) at
`6e79cb4`, for its workspace layout, auth, encrypted uploads and component set.
The two have diverged: Memory-Haven models one bereaved person keeping a
private archive, this models a funeral home working a case with a family.
Nothing here changes anything there.
