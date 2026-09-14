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

## Tests

`artifacts/api-server/test` runs against a real Postgres with no mocks, because
almost everything that could actually go wrong here is a query returning the
wrong rows — a missing tenant filter, a join that leaks another home's case —
and a mocked database cannot fail that way.

The two files worth reading first are `tenant-isolation.test.ts` (one home
cannot reach another's cases; a link reaches exactly one case; one family
member cannot delete another's photograph) and `case-lifecycle.test.ts`, which
walks a case from the call coming in to the family consenting to aftercare.

## Forms, authorizations and the 72-hour clock

`lib/db/src/schema/{forms,policies}.ts`,
`artifacts/api-server/src/routes/forms.ts`, the `forms` tag in the spec, a
`Paperwork` page in the portal and a `Paperwork` tab on a case.

**We ship no legal form of our own and we file nothing with anybody.** Both
halves are product decisions rather than gaps. A national vendor shipping its
own cremation authorization hands every home it sells to a liability and hands
every family a document nobody's counsel has read; and there is no EDRS
integration here, so the certificate record is the director's own note of a
filing they made themselves. `filingNotice` is returned by the API rather than
written into each client, so no screen can show the clock without also saying
who files it.

### The clock

Colorado's SB 23-020 replaced the old five-day window: a certificate of death
must be filed within **72 hours of assuming custody**, and the certifying
physician has 72 hours of their own from the EDRS request.
`death_certificate_filings` anchors on custody rather than on the death,
because a person released by the coroner on a Tuesday starts the clock on
Tuesday.

That deadline is the ordering principle rather than a countdown. A form marked
`blocksCertificate` sorts first everywhere, and the boxes that hold a
certificate up are the ones marked `onlyFamilyKnows` — required, empty, and
unanswerable by anyone at the home. The family surface carries no clock at
all: a countdown is right for a director and wrong for a widow, and
`forms.test.ts` asserts that nothing on the wire to a family carries one.

### Authorizations are not forms

An authorization is its own record, append-only, holding the tier of C.R.S.
15-19-106 the signer claimed, who at the home verified it and what they saw,
and a snapshot of the answers as they stood when it was signed. Once signed it
stops taking answers — from either side — because two versions of what was
signed is worse than one.

Where the tier needs a majority (adult children, parents, siblings) every
consenting person is a separate row, with the channel it came through. Nobody
consents on anybody else's behalf: the portal records only the signer's own
consent, and the home records the rest as it reaches them. Whether a majority
has been recorded is *shown* and never enforced — the software does not refuse
a cremation because it counted to two.

The gate is Component 1's, used rather than reimplemented.
`requireFamilyAuthorization` is mounted in front of the only route that
records an authorization; a form's `requiredLevel` is compared with `atLeast`.
A form above a contact's level is not in their list, does not answer to a
guessed id, and refuses their answers.

### Arriving filled

A box names a `prefillFrom` source and the case supplies it, so no form asks a
daughter for her mother's date of birth on a case that already holds it. A
suggestion is never written as an answer — a box nobody has looked at has to
keep reading as outstanding. Sensitive boxes are encrypted at rest, never read
back to the portal, and shown to staff as their last four characters, which is
the posture `vital-statistics.ts` takes with a social security number.

Everything completed renders as a self-contained print sheet the family can
open, print and save from their own phone with no account. Documents about
your own mother should not be hostage to a vendor's uptime.

### Policies

Versioned, and versions are immutable: new wording is a new version, so a
family who read the old one still points at the words they read. Opening the
portal's document list records that this person was shown that version, which
is kept separate from their confirming they have read it — being shown a
privacy notice is not agreeing to one.

## Relationship to Memory-Haven

This repository began as a fork of Memory-Haven (`holdingtoday.com`) at
`6e79cb4`, for its workspace layout, auth, encrypted uploads and component set.
The two have diverged: Memory-Haven models one bereaved person keeping a
private archive, this models a funeral home working a case with a family.
Nothing here changes anything there.
