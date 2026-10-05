# Status — where things stand

Last checked: **5 October 2026**, against `origin` as it stood that morning.
Update this file when any of it changes; a stale status page is worse than
none. (The 23 September version of this file listed six "left for an owner"
items that had in fact been built since. Check before you trust a list.)

## The short version

- **Whatever Replit is serving is old.** The live app was published from
  `demo/2026-10-04`, a "Published your App" commit on top of **28 September's**
  main. Nothing since — the 4 October leak fixes, the 72-hour clock, the
  access log, error tracking, and everything on the step-up branch — is live.
  Publishing again from an up-to-date main is the fix. **Problem 1.**
- **The step-up branch is merged** (on `ccr-525b8716-xwvpm4`, 5 October), so
  once that reaches main, main holds all the work. 723 unit and integration
  tests pass (584 API against real Postgres, 60 platform console, 53 family
  portal, 26 director console), lint and typecheck are clean, codegen is in
  step with the spec, and every app builds.
- **Nothing here can take a real home's money or a real family's link yet**,
  for reasons that are accounts and decisions, not bugs. **Problem 2.**

---

## Problem 1 — getting the newest code live

Replit publishes **whatever is checked out in the Replit workspace**, not
GitHub's default branch. Its last publish (`demo/2026-10-04`, 4 Oct 12:51 UTC)
sat on 28 September's main. To publish what is here now:

1. Merge `ccr-525b8716-xwvpm4` into main (`claude/funeral-home-portal-uj9bik`).
2. In the Replit workspace: `git fetch origin` and check out main at its new
   head. `scripts/post-merge.sh` runs `pnpm install --frozen-lockfile` and
   `db push`; run both by hand if the workspace did not merge through Replit.
   **`db push` matters**: this release adds `sms_opt_outs`, SMS consent
   columns on contacts, texting and aftercare settings on homes, pronouns
   and a suggested draft on obituaries, and a theme on print items.
   The API starts without them and then 500s.
3. Publish. Check `/api/healthz`, sign in, open a case's Certificate tab.

**One thing to decide before publishing.** On main, every
`.replit-artifact/artifact.toml` points the apps at each other on
`https://continuumaftercare.com`. The 4 October publish rewrote all four to
`https://funeral-home.replit.app`. If the custom domain is not attached to the
Replit deployment yet, publishing main as it stands sends password resets,
family links and the cross-app buttons to a domain that does not answer.
Attach the domain first, or publish with the `replit.app` URLs.

The same publish also dropped `orval` from `lib/api-spec/package.json` and
pruned the lockfile. Both are Replit's own edits on that branch, not on main,
and do not need carrying back.

### What the step-up merge decided

The step-up branch and the 4 October pass were built without knowing about
each other. Resolved as `STATUS.md` recommended on 4 October:

1. **The 72-hour certificate clock:** kept main's (`death_certificate_filings`
   as `routes/vitals.ts` writes it, Colorado-only, 12 tests). Dropped the
   step-up branch's `routes/certificate.ts`, `schema/certificates.ts`, its
   test, its `certificatesDue` dashboard field, its `/cases/{id}/certificate`
   endpoints and its `CertificateClock.tsx`. Its first-case guide now reads
   custody from main's filing record. Its `certifiedAt` was not ported.
2. **The case tabs:** kept the step-up branch's four named sections; dropped
   main's hairline `GroupBreak`.
3. **Unused UI primitives:** took the step-up branch's deletions.
4. **The router splits:** taken. Main's 4 October fix that stops the family's
   certificate reads carrying `staffNotes` and the SSN's last four was
   re-applied in `routes/family/arrangements.ts` — the split would otherwise
   have quietly undone it. `vitals.test.ts` covers it.
5. **Smaller things the merge caught:** the step-up branch's new
   `home.sms.update` action had no words in a home's own access log (now it
   does, with a test that every `home.*` action has a sentence); its toasts
   used red (`destructive`) where main had moved to the notice colour; the
   new obituary composer said "they" to someone writing their own pre-need
   obituary, and asked them when they died; and a suggested draft cut off by
   the token limit would have been offered as finished.

---

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

1. **Confirm the price**, then create it in Stripe and run one test-mode cycle.
   The price book now says $169 a location plus $7 a funeral (from the
   step-up branch); `stripe-setup` creates the prices from it. `PRICING.md` has the
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
