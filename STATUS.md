# Status — where things stand

Last checked: **4 October 2026**, against `origin` as it stood that evening.
Update this file when any of it changes; a stale status page is worse than
none. (The 23 September version of this file listed six "left for an owner"
items that had in fact been built since. Check before you trust a list.)

## The short version

- **The code is healthy.** Typecheck is clean, and on branch
  `ccr-7f48fd16-gacxdi` every suite passes: 545 API integration tests against
  real Postgres, 60 platform-console, 53 family-portal and 24 director-console
  unit tests, and the 7 Playwright browser tests.
- **The 4 October pass fixed everything in its audit that code could fix** —
  see *What changed on 4 October* below. What is left for launch is not code.
- **The work now lives in too many places**, and sorting that out is the most
  important thing to do next. It is an owner's call. **Problem 1.**
- **Nothing here can take a real home's money or a real family's link yet**,
  for reasons that are accounts and decisions, not bugs. **Problem 2.**

---

## Problem 1 — the work is in seven places

| Where | What it holds | State |
| --- | --- | --- |
| `claude/funeral-home-portal-uj9bik` | **Main.** GitHub's default branch. Everything up to PR #37 and the Phase 1 admin work (PR #35's content). | Green |
| `ccr-7f48fd16-gacxdi` | The 4 October pass: the leak fixes, the 72-hour clock, the access log, error tracking, the calm-colour and pre-need work, the border fix, the platform console's tests. Built against main. | Green, pushed, no PR yet |
| `claude/step-up-app-launch-prep-j18yry` | **12 commits main never received** (2 October): the $169-a-location-plus-$7-a-funeral price book, recorded SMS consent with STOP/HELP, aftercare by text, seven print themes, the obituary composer, ESLint and a large dead-code removal, the family and admin router splits, a texting setup panel, its own port of the 72-hour clock, and the case tabs grouped into four sections. | CI green on 2 Oct, **no PR** |
| PR #36 `claude/rescued-launch-readiness` | Launch-readiness fixes rescued from stranded branches. | Open |
| PR #34 `claude/launch-sprint-catalogue` | The Funeral Rule catalogue, storefront and itemised statement, brought across from the old integration branch. | Open — the old keep-or-drop decision |
| PR #8 `claude/component-5-forms` | Forms, authorisations and the 72-hour clock, into the **old** integration branch. | Open since 14 Sep, stale |
| `demo/2026-10-04` | A Replit "Published your App" commit built from **28 September's** main. | Whatever is live on Replit predates all of the above |

### This branch and the step-up branch overlap

Both were built without knowing about the other, and a trial merge of
`claude/step-up-app-launch-prep-j18yry` into `ccr-7f48fd16-gacxdi` conflicts
in 25 files. Three of the overlaps are real choices; the rest are mechanical.

1. **Both port the 72-hour certificate clock, into a table with the same name
   and different columns** (`death_certificate_filings`). Only one may ever
   reach a database: `db push` would turn one into the other and drop columns
   doing it. Recommended: keep this branch's — it applies Colorado's 72 hours
   only to Colorado homes, refuses a pre-need file and a time in the future,
   attributes a filing only when it is recorded, has no duplicate notes field,
   and has 12 tests to the other's 4 — and port the other's `certifiedAt` (the
   physician's certification, as seen in EDRS) onto it if wanted. Drop the
   step-up branch's `routes/certificate.ts`, `schema/certificates.ts`,
   `certificate-clock.test.ts`, its `certificatesDue` dashboard field and its
   `CertificateClock.tsx`.
2. **Both regroup the case tabs.** This branch draws a hairline between five
   groups in one bar; the step-up branch makes four named sections with the
   tabs beneath them. Recommended: keep the step-up branch's, which goes
   further, and drop this branch's `GroupBreak`.
3. **The step-up branch deletes unused UI primitives** (`field.tsx`,
   `form.tsx`, `input-group.tsx`, and the family portal's `alert.tsx` and
   `badge.tsx`) that this branch recoloured. Take the deletions.

The mechanical ones: `openapi.yaml` and the generated code (resolve the spec,
then rerun codegen — never hand-merge generated files), `pnpm-lock.yaml`
(rerun `pnpm install`), the two dashboard certificate lists, Settings (both
edit it), `Obituary.tsx` (pre-need wording against the new composer — reapply
the wording on the composer), and the router splits (this branch's changes to
`family.ts`, `home.ts` and `admin.ts` move into the split files).

**Recommended order:** merge this branch into main; then bring the step-up
branch across in one pull request, resolving the above; then decide PR #34
(it is the storefront keep-or-drop below); then close PR #8 (its clock is now
built on main, and its forms and authorisations need a lawyer first — see
`COLORADO.md`). Nothing new should be based on the old
`claude/app-capability-check-mvfn8x`.

### The old integration branch

`claude/app-capability-check-mvfn8x` still holds the storefront and
catalogue, the itemised statement, forms and authorisations, and engagement
scoring. Main has since built engagement figures (the platform console), and
the 72-hour clock (this branch). PR #34 is the storefront-and-statement half.
Keep or drop is the owner's decision, item by item, and the reasoning against
a straight merge in the 23 September version of this file still holds: bring
a feature across in its own pull request, never the branch.

---

## Problem 2 — what only an owner can do

In the order that unblocks the most:

1. **Choose the price**, then create it in Stripe and run one test-mode cycle.
   The step-up branch proposes $169 a location plus $7 a funeral and builds
   the price book for it; nothing on main has a price. `PRICING.md` has the
   five-step checklist.
2. **Deploy for real, or confirm what Replit is serving.** The stack has never
   run on a host with real TLS, mail or a payment. `DEPLOY.md` is the path:
   a host, DNS for five names, `docker compose up`. Then SMTP until
   `send-test-email` lands in an inbox, and a Twilio number.
3. **A lawyer**, for the three things `COLORADO.md` names: the storefront
   pricing UI, anything that records an authorisation, and the DPA (with the
   terms and privacy policy in `LEGAL/`). If Sentry is switched on (item 4),
   it joins the DPA's sub-processors first.
4. **Know when it breaks.** Create a Sentry project and set `SENTRY_DSN`;
   point a phone-paging monitor at `/api/healthz`; set the `API_URL`
   repository secret so `uptime.yml` runs too. `DEPLOY.md`, "Knowing when it
   breaks".
5. **Turn on the scheduled jobs.** Set the `API_URL` and `TASK_SECRET`
   repository secrets, run each of `aftercare.yml`, `usage.yml` and
   `trial-reminders.yml` once by hand with *dry run* ticked, then set the
   repository variable `REQUIRE_TASK_SECRETS=true` so a missing secret fails
   loudly from then on. Until the secrets exist they skip with a notice.
6. **One pilot home, one real family.** Every test so far is synthetic.
7. **Delete the merged branches** (Problem 3). Lossless, and only an owner
   should do it.

---

## Problem 3 — branch clean-up

Regenerate the list rather than trusting this one; it is a snapshot.

```sh
pnpm --filter @workspace/scripts run dead-branches
```

On 4 October, **22 branches contained nothing main does not have** and can be
deleted without losing a line:

```
claude/admin-home-client-e2e-audit-dqolc4   claude/funeral-pricing-strategy-pcb8ve
claude/admin-home-onboarding                claude/home-descendant-template-wbapxg
claude/admin-login-continuumaftercare-lhykml  claude/launch-readiness-review-9v7t54
claude/app-bug-hunt-launch-ffh45g           claude/missing-login-link-7m9wqx
claude/bug-hunt-ltpnxw                      claude/new-session-g63cjh
claude/component-2-admin                    claude/organize-code-issue-breakdown-4g89yg
claude/continuum-aftercare-login-separation-jz9l3k  claude/polish-audit-full-app-knbotn
claude/design-polish-refinement-pw0ush      claude/polish-every-page-9jmstp
claude/e2e-polish-qa-twqkoy                 claude/scores-launch-readiness-ku9cv8
claude/e2e-test-audit-grading-q34s5o        claude/security-issues-5cpjhp
claude/funeral-home-master-dashboard-gdg8pn claude/two-branches-heere-dxhyv8
```

The script prints the exact `git push origin --delete …` command. Everything
else it lists as "ahead" is in Problem 1, or is an old polish branch whose
work landed in another form (`claude/polish-*`, `claude/design-polish-*`,
`claude/publishing-issue-alvr9f`, `claude/multi-repo-loading-business-wqd37k`):
read the one or two commits, then delete. Deleting a branch is not reversible
from the GitHub UI, which is why this is an owner's job and not an agent's.

---

## What changed on 4 October

Each of these is its own commit on `ccr-7f48fd16-gacxdi`, with the reasoning
in the message.

- **A family was being sent the home's private notes and the last four of the
  SSN.** Every family read, save and submit of the certificate details
  carried `staffNotes` and the masked number. Now staff-only, with tests that
  fail on the old code.
- **Colorado's 72-hour death-certificate clock.** Custody, the physician's
  EDRS request, and the home's own filing, on the Certificate tab; "Death
  certificates to file" on the master page; the deadline on the case's
  at-a-glance tile. Nothing family-facing, nothing red, and every surface says
  we file nothing.
- **A home's owner can read the platform's access log about their home**, in
  Settings. The DPA now says so, and its list of what the platform console
  can change is complete. Settings also lets a home correct its own address,
  which only the platform could set before.
- **Error tracking and crash screens.** Sentry on the server when
  `SENTRY_DSN` is set, scrubbed of anything personal; every app now has an
  error boundary (a family used to get a blank white page), and crashes are
  reported to the app's own API; `uptime.yml` asks the health check every
  fifteen minutes.
- **No red anywhere a family looks**, and none in the console for ordinary
  errors — the notice colour everywhere, red kept for destructive
  confirmations.
- **Pre-need files speak to the living person** on every page, and a plan no
  longer names its own planner as the informant on their own certificate.
- **Every designed border now shows.** An unlayered `*` rule beat every
  Tailwind border colour in all three apps; tiles, past-due rows and invalid
  fields all drew in the same grey.
- **The platform console has 60 tests**, and the four bugs writing them found
  are fixed: dates a day out for US readers, a plan's price not following the
  billing period, unlabelled audit actions, and a stale access history.
- **The master page heading** is "Today" and the date, not the home's name a
  second time; **the case tabs** are grouped.

## Known gaps, after 4 October

- **The C.R.S. 15-19-106 authorisation order, and forms**, are not built. They
  record legal authorisations, so they wait on a lawyer (`COLORADO.md`).
- **A relative invited onto a pre-need plan is addressed as the planner**
  ("Your plan"): the portal's voice knows the kind of file, not who is
  reading it.
- **Plans created before 4 October may name the planner as the certificate
  informant** — worth one query against real data before anybody relies on
  those records.
- **The platform console** shows per-panel errors, rather than the sign-in
  page, if its session expires while open.
- **Infrastructure**, unchanged and fine for a pilot: uploads in Postgres, one
  API instance, backups on the same host until copied off, an in-memory rate
  limiter, no load test. `DEPLOY.md`, "What this is not".
