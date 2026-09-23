# Building this in parallel: six components, six owners

> **Archived — do not follow this.** The build happened and this is the plan it
> happened under, kept for the decisions it explains. Two things in it were
> never true: `lib/api-spec/openapi.yaml` was never split into one file per
> domain, and the branches named below are not where the code ended up.
>
> The live rules are in [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md). The
> craft standard, which used to be the second half of this file, is now
> [`../../CRAFT.md`](../../CRAFT.md), unchanged.

Read this before you touch anything. It exists because six agents working in
one pnpm workspace on one OpenAPI contract will otherwise spend more time
resolving merge conflicts than writing features.

Branch for every component: `claude/app-capability-check-mvfn8x` in
`heatherkrueger1234-design/funeral-home`, unless your brief says otherwise.

## The rule that matters most

`lib/api-spec/openapi.yaml` is the source of truth. `orval` generates
`lib/api-zod` (server validators) and `lib/api-client-react` (frontend hooks)
from it, both with `clean: true`, and CI fails when the checked-in generated
code drifts from the spec.

That means:

- **Nobody edits `lib/api-zod/src/generated` or
  `lib/api-client-react/src/generated` by hand. Ever.** They are build output.
  Change the spec, run codegen, commit what falls out.
- **Nobody edits a spec file they do not own.** Component 1 splits the single
  `openapi.yaml` into one file per domain under `lib/api-spec/paths/` so that
  each component owns its own. Until that split lands, *do not add paths to
  the spec at all* — build behind it and wire up after.
- Run `pnpm --filter @workspace/api-spec run codegen` after any spec change,
  then `pnpm run typecheck`, and commit the generated diff in the same commit
  as the spec change. A spec change committed without its generated code is a
  red build for everyone else.

## The second rule

**Component 1 lands before components 2–6 wire anything up.** Everything else
depends on there being one definition of who a user is and what they may do.
Components 2–6 can start immediately on schema, business logic and UI — just
do not build a second permission model while waiting. If you need to gate
something and C1 has not landed, leave a `TODO(C1)` and a plain function call
where the check goes.

## Ownership

No two components own the same file. If your work genuinely needs a file
another component owns, say so rather than editing it.

| # | Component | Owns | Depends on |
| --- | --- | --- | --- |
| 1 | Identity, roles, levels, passwords | `lib/db/src/schema/{platform,users,family-contacts,sessions}.ts`, `artifacts/api-server/src/middleware/*`, `artifacts/api-server/src/lib/{auth,platform-auth,family-link}.ts`, `artifacts/api-server/src/routes/{auth,index}.ts`, the spec split | — |
| 2 | Platform admin console | `artifacts/admin-console/**` (new app), `artifacts/api-server/src/routes/admin.ts`, `lib/api-spec/paths/admin.yaml` | 1 |
| 3 | Storefront, catalogue and the statement | `lib/db/src/schema/{catalogue,storefront,orders}.ts`, `artifacts/api-server/src/routes/{catalogue,orders}.ts`, `lib/api-spec/paths/{catalogue,orders}.yaml`, storefront pages in both frontends | 1 |
| 4 | Deployment: a real host, TLS, mail, backups, monitoring | `deploy/**`, `docker-compose.yml`, the `Dockerfile`s, `.github/workflows/**`, `DEPLOY.md`, `LAUNCH.md` | nothing — starts immediately |
| 5 | Forms, policies and documents | `lib/db/src/schema/{forms,policies}.ts`, `artifacts/api-server/src/routes/forms.ts`, `lib/api-spec/paths/forms.yaml` | 1 |
| 6 | Engagement, dates and aftercare handoff | `lib/db/src/schema/engagement.ts`, `artifacts/api-server/src/routes/engagement.ts`, `lib/api-spec/paths/engagement.yaml`, existing `aftercare.ts` | 1 |

Shared files that anybody may need to touch — coordinate in the PR, keep the
diff to one or two lines:

- `lib/db/src/schema/index.ts` — add your `export *` line, alphabetical within
  its section, nothing else.
- `artifacts/api-server/src/routes/index.ts` — add your `router.use(...)`
  **below the correct gate**. Read the comment block first; putting a router
  above a gate is how a family's photographs end up public.
- `replit.md` — document what you built. Append; do not rewrite other sections.

## What this product is, and is not

Carried over from `replit.md` and still true. Do not quietly reverse these:

- Not a case-management system. Homes already own one.
- No venue booking, no contracts.
- Office hours are shown, never enforced.
- Nothing is auto-deleted, ever. Retention is the home's legal call.
- The vendor directory and the hymn library ship empty, on purpose.
- **Remember Me stays out.** No wills, no medical directives, no stored
  passwords-for-life, no private letters vault. It is a separate product in a
  separate repository, and the reason is in `Remember-Me/README.md`: a funeral
  home's insurer asks what the vendor's software stores about their families,
  and the answer has to stay boring.

## Colorado law: read `COLORADO.md`

This product is built for Colorado homes first, and Colorado rewrote its entire
funeral regime in 2024 after the Return to Nature and Sunset Mesa scandals.
[`COLORADO.md`](../../COLORADO.md) has the verified statutory constraints, divided
into one section per component. **Read your section before you write code** —
it is not background reading, it decides how several of these components are
shaped. Section 1 in particular is where the family access levels come from.

The headlines, so everybody has seen them:

- Practitioner licensure is required by **1 January 2027**. That is three
  months away and every home you sell to is mid-scramble.
- A death certificate must be filed through the state's electronic system
  within **72 hours** of taking custody. That clock drives the deadline
  defaults.
- Who may authorise anything is a **statutory priority order** (C.R.S.
  15-19-106), not whoever answered the phone.
- **Pre-need prepayment requires a Division of Insurance licence, $100,000 of
  net worth or bond, and 85% of funds in trust. We are not building it.**

## Legal constraints you must not design around

Two of these components can create real regulatory exposure. They are called
out again in the briefs; they are here so everyone has seen them.

1. **The FTC Funeral Rule** governs how a *funeral provider* discloses prices —
   General Price List, Casket Price List, itemisation, no package-only
   pricing. If a funeral home sells goods through our storefront, the home is
   the funeral provider and the pricing UI has to let them comply rather than
   quietly stopping them. Component 3 must therefore support itemised prices
   and a printable price list, and must never force bundling.

2. **Pre-need prepayment is regulated by every state separately** — trusting
   or insurance-funding requirements, seller licensure, escrow, cancellation
   and refund rights. Taking money for a funeral that has not happened is not
   a Stripe integration, it is a licensed activity. **Component 4 does not
   build pre-need prepay.** At-need payment for goods and services already
   rendered is ordinary commerce and is in scope. Pre-need stays "record the
   plan, take no money" until a lawyer in the relevant states says otherwise.

3. **We take no money from families at all.** No processing, no funds held, no
   card data, no percentage of what a home sells. A family that owes the home
   money is linked out to the home's own payment page. The only money in this
   system is the home's monthly subscription to us. Component 4 produces the
   itemised statement and the handoff, and nothing else.

## House style

Match what is already here. It is consistent and it is deliberate.

- Comments explain *why*, especially where a choice looks wrong. Look at
  `lib/db/src/schema/family-contacts.ts` for the register.
- Tests run against a real Postgres with no mocks. The failures worth catching
  here are queries returning the wrong rows.
- Every table carries `funeralHomeId` and every staff query filters on it
  first, from the signed-in user's own row — never from the request.
- British spelling in prose and comments.
