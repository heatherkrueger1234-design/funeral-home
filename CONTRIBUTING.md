# Working in this repository

Read this before you touch anything. Four rules here have each cost somebody a
day at some point; the rest is house style.

## The rule that matters most: generated code

`lib/api-spec/openapi.yaml` is the source of truth. `orval` generates
`lib/api-zod` (server validators) and `lib/api-client-react` (frontend hooks)
from it, both with `clean: true`, and CI fails when the checked-in generated
code drifts from the spec.

That means:

- **Nobody edits `lib/api-zod/src/generated` or
  `lib/api-client-react/src/generated` by hand. Ever.** They are build output.
  Change the spec, run codegen, commit what falls out.
- Run `pnpm --filter @workspace/api-spec run codegen` after any spec change,
  then `pnpm run typecheck`, and commit the generated diff **in the same commit
  as the spec change**. A spec change committed without its generated code is a
  red build for everyone else.
- The spec is one file, not one per domain. A split was planned and never
  landed, so two people adding paths at once will conflict — say what you are
  adding before you add it.

## Shared files, and the one that is dangerous

Three files everybody eventually needs to touch. Keep the diff to a line or
two and say so in the PR:

- `lib/db/src/schema/index.ts` — add your `export *` line, alphabetical within
  its section, nothing else.
- `artifacts/api-server/src/routes/index.ts` — add your `router.use(...)`
  **below the correct gate**. Read the comment block first. Putting a router
  above a gate is how a family's photographs end up public, and nothing in the
  type system will stop you.
- `replit.md` — document what you built. Append; do not rewrite other sections.

## One permission model

There is one definition of who a user is and what they may do, in
`artifacts/api-server/src/middleware/*` and
`artifacts/api-server/src/lib/{auth,platform-auth,family-link}.ts`. If you need
to gate something and the check does not exist yet, add it there or leave a
plain function call where it goes. **Do not invent a second role system.** The
platform-admin list is deliberately one capability with no hierarchy for
exactly this reason — `routes/admin.ts` explains why at length.

## What this product is, and is not

Do not quietly reverse these. Each one is a decision, not an unfinished
feature, and `replit.md` has the reasoning at length.

- Not a case-management system. Homes already own one.
- No venue booking, no contracts.
- Office hours are shown, never enforced.
- Nothing is auto-deleted, ever. Retention is the home's legal call — see
  [`RETENTION.md`](./RETENTION.md).
- The vendor directory and the hymn library ship empty, on purpose.
- **Remember Me stays out.** No wills, no medical directives, no stored
  passwords-for-life, no private letters vault. It is a separate product in a
  separate repository, and the reason is worth remembering: a funeral home's
  insurer asks what the vendor's software stores about their families, and the
  answer has to stay boring.

## Colorado law: read `COLORADO.md`

This product is built for Colorado homes first, and Colorado rewrote its
entire funeral regime in 2024 after the Return to Nature and Sunset Mesa
scandals. [`COLORADO.md`](./COLORADO.md) has the verified statutory
constraints. **Read the section covering what you are building** — it is not
background reading, it decides how several features are shaped. The family
access levels come straight out of it.

The headlines, so everybody has seen them:

- Practitioner licensure is required by **1 January 2027**, and every home you
  sell to is mid-scramble.
- A death certificate must be filed through the state's electronic system
  within **72 hours** of taking custody. That clock drives the deadline
  defaults.
- Who may authorise anything is a **statutory priority order** (C.R.S.
  15-19-106), not whoever answered the phone.
- **Pre-need prepayment requires a Division of Insurance licence, $100,000 of
  net worth or bond, and 85% of funds in trust. We are not building it.**

## Legal constraints you must not design around

Parts of this product can create real regulatory exposure. They are here so
everyone has seen them.

1. **The FTC Funeral Rule** governs how a *funeral provider* discloses prices —
   General Price List, Casket Price List, itemisation, no package-only
   pricing. If a home sells goods through anything we build, the home is the
   funeral provider, and the pricing UI has to let them comply rather than
   quietly stopping them: itemised prices, a printable list, never forced
   bundling.

2. **Pre-need prepayment is regulated by every state separately** — trusting
   or insurance-funding requirements, seller licensure, escrow, cancellation
   and refund rights. Taking money for a funeral that has not happened is not
   a Stripe integration, it is a licensed activity. Pre-need stays "record the
   plan, take no money" until a lawyer in the relevant states says otherwise.
   At-need payment for goods and services already rendered is ordinary
   commerce and is in scope.

3. **We take no money from families at all.** No processing, no funds held, no
   card data, no percentage of what a home sells. A family that owes the home
   money is linked out to the home's own payment page. The only money in this
   system is the home's monthly subscription to us.

## House style

Match what is already here. It is consistent and it is deliberate.

- Comments explain *why*, especially where a choice looks wrong. Look at
  `lib/db/src/schema/family-contacts.ts` for the register.
- Tests run against a real Postgres with no mocks. The failures worth catching
  here are queries returning the wrong rows.
- Every table carries `funeralHomeId` and every staff query filters on it
  first, from the signed-in user's own row — never from the request.
- British spelling in prose and comments.

Then there is [`CRAFT.md`](./CRAFT.md), which is the bar the interface is held
to. It is longer than this file and it is not optional reading.
