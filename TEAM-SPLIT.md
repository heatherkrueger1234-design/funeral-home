# Building this in parallel: six components, six owners

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
| 3 | Storefront and catalogue | `lib/db/src/schema/{catalogue,storefront}.ts`, `artifacts/api-server/src/routes/catalogue.ts`, `lib/api-spec/paths/catalogue.yaml`, storefront pages in both frontends | 1 |
| 4 | The statement, and the handoff to the home | `lib/db/src/schema/orders.ts`, `artifacts/api-server/src/routes/orders.ts`, `lib/api-spec/paths/orders.yaml` | 1, 3 |
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
[`COLORADO.md`](./COLORADO.md) has the verified statutory constraints, divided
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

---

# The craft standard

Every component is held to this. It is not decoration — it is the product. A
director shows this to a family on the worst week of their life, and it has to
look like it was made by people who took that seriously.

## What "very well funded, a year of work" actually looks like

It is worth being precise, because the instinct is wrong. A well-funded team
with a year does not ship *more*. It ships **less, finished**.

What it actually produces:

- **One** way to do each thing, not three.
- Every state designed — not just the happy one.
- Copy written by someone who cared about each sentence.
- Consistency so tight it stops being visible.
- Restraint. No gradient because gradients exist. No animation because the
  library had one.

What it never produces: a novel visual idea per screen, decoration in place of
hierarchy, or a feature nobody asked for sitting next to a broken empty state.

**So: if you are choosing between a new flourish and finishing an existing
screen properly, finish the screen. Every time.**

## Typography — settled, do not relitigate

Already chosen, already right, now locked:

- **Lora** (serif) for headings and anything that should feel like a printed
  order of service. `--font-display`.
- **Nunito** (sans) for interface and body. `--font-sans`.
- Two families. Not three. Never a third.
- Body text never below 16px on the family portal — it is read on a phone, at
  arm's length, by someone in their seventies, possibly crying.
- Measure caps at ~66 characters. Long paragraphs get `max-w-prose`.
- Numerals in tables and prices: `font-variant-numeric: tabular-nums`.

## Colour — tokens only

- **Never hardcode a hex in a component.** Every colour comes from the tokens
  in `index.css`. If you need a colour that does not exist, add a token and say
  why in a comment.
- `--accent` is **the funeral home's own colour**, injected at runtime. Your UI
  must look correct with a deep green, a navy, a burgundy and a muted gold.
  Test with at least two before you call it done.
- Red (`--destructive`) is for destructive confirmation only. **Never** for a
  deadline, an overdue task, or anything in the family portal. A red badge
  telling a widow she is late with her mother's obituary is unforgivable.
  Overdue is communicated in words, calmly.
- No dark mode in the family portal. The director console may have one later;
  it is not in scope for anybody now.

## Space, rhythm, shape

- Spacing is the 4px scale, via Tailwind. No arbitrary `px` values.
- Radii from the tokens: `--radius-sm/md/lg`. Nothing else.
- Shadows: at most two levels, both soft. This is a product about dignity, not
  a dashboard about growth.
- Generous whitespace. Crowding reads as cheap, and cheap here reads as
  disrespectful.

## Motion

- 150–250ms, ease-out. Nothing longer, nothing bouncy, nothing that draws
  attention to itself.
- Motion may confirm (a row settling after it saves) or orient (a panel sliding
  from the edge it belongs to). It may never entertain.
- Honour `prefers-reduced-motion`. Always.
- Nothing on this site celebrates. No confetti, no checkmark that pops, no
  progress bar that fills triumphantly. Somebody died.

## Tone and copy — the compassion rules

The writing is most of the compassion. These are rules, not preferences:

- **Plain, warm, unhurried.** "When you're ready" not "Action required".
- **Never cheerful.** No exclamation marks in the family portal. No "Great
  job!", no "You're all set!", no emoji.
- **Never urgent.** No countdown timers, no "only 2 days left", no red.
  Deadlines are stated once, kindly, with what happens if they slip.
- **Never gamified.** No streaks, no percentage complete as a score, no badges.
  A progress indicator may show *what is left*, never *how well they are doing*.
- **Name the person.** "Margaret's photographs", not "Case #4417 assets".
- **Say what happens next.** Every action's copy answers "and then what?"
- **Never blame.** No "You failed to…", no "Invalid input". Say what is needed.
- Buttons are verbs describing the outcome: "Send the link", not "Submit".
- British spelling in comments and internal prose; **US spelling in anything a
  family or director reads** — these are American funeral homes.

## "Everything they need before they know they need it"

This is the hardest requirement and the one that separates this from ordinary
software. Concretely, it means:

- **Never ask twice.** If the case knows the date of birth, no form asks for it
  again. Anything derivable is derived and shown as already filled, editable.
- **Arrive filled.** Print templates, obituary drafts and forms open populated
  from what the case already knows. The user's job is to correct, not to type.
- **One next thing, always visible.** Every screen makes the single most likely
  next action obvious without hunting. Not a wall of equal buttons.
- **Surface the thing they were about to go looking for.** On the day of a
  service, the director wants the order of service and the family's phone
  number — put them there, that day, without being asked.
- **Right defaults, quietly.** The standard schedule applies itself. Aftercare
  dates propose themselves. The user confirms rather than constructs.
- **Never a dead end.** Every empty state says what this is for and offers the
  one action that fills it. Every error says what to do next. Every "no results"
  offers the way out.

## Every state is designed

A screen is not done when the happy path renders. It is done when all of these
exist and have been looked at:

**empty · loading · partial · error · success · offline · too much data · the
longest realistic name · the shortest**

Loading is skeletons that match the real layout, never a spinner in a void.
"Too much data" means 1,000 photographs and a 40-person family, and it must not
degrade into a scroll of doom.

## Self-explanatory

- **No onboarding tour.** If a screen needs a tour, the screen is wrong.
- **No icon-only buttons** anywhere a family can reach. Icons accompany labels,
  they do not replace them.
- **No tooltip carries required information.** Tooltips do not exist on touch.
- A director who has never been trained must be able to open a case and text a
  family without asking anyone. That is the test.

## Accessibility, as a floor

- WCAG AA contrast, checked, including against every brand accent.
- Full keyboard operation, visible focus rings — never `outline: none` without
  a replacement.
- Real labels on every input. Form errors announced, tied to their field.
- Touch targets 44px minimum. Half these users are on a phone, in a car park,
  outside a hospital.
- Test at 200% browser zoom. Older eyes.

## Clean code, held to the same bar

- **Match the surrounding code.** This codebase has a voice: comments explain
  *why*, especially where a decision looks wrong at first glance. Read
  `lib/db/src/schema/family-contacts.ts` before writing your first comment.
- Name things after what they mean to a funeral director, not to a programmer.
- No dead code, no commented-out blocks, no `any`, no `@ts-ignore` without a
  sentence saying why.
- If it is hard to explain, it is probably wrong. Simplify rather than comment
  around it.
- Tests for the things that would actually break: the wrong rows coming back,
  the wrong tenant, the wrong person seeing something.
- Leave every file you touch cleaner than you found it — but do not reformat
  files you did not otherwise change. Noise in a diff costs everyone.
