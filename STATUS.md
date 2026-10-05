# Status — where things stand

Last checked: **5 October 2026**, against `origin` as it stood that morning.
Update this file when any of it changes; a stale status page is worse than
none. (The 23 September version listed six "left for an owner" items that
had in fact been built. Check before you trust a list.)

## The short version

- **The code is healthy, and in one place again.** Everything is on main:
  4 October's work (PR #38), then the twelve stranded commits from 2 October
  with main's 72-hour clock kept and 5 October's fixes on top (PR #39).
  Typecheck and lint are clean and every suite passes (counts in `LAUNCH.md`).
- **What is left for launch is not code.** A price, a lawyer, a real
  deployment, and four accounts (mail, Twilio, Stripe, a backup bucket).
- **Two things to do this week that cost nothing:** make this repository
  private, and switch off Replit's analytics injection. Both are below.
- **Nothing live runs current code.** Both Replit apps serve builds from
  before 28 September, and the one on your domain shows the old family portal
  at every address.

---

## What is live, and where the work is

| Where | What it holds | State |
| --- | --- | --- |
| `claude/funeral-home-portal-uj9bik` | **Main**, GitHub's default branch. Everything through PR #39 (5 October). | Green |
| `ccr-7f48fd16-gacxdi` | Merged as PR #39: the step-up work (price book, recorded SMS consent, aftercare by text, print themes, obituary composer, ESLint, router splits, case sections) integrated with main's clock, plus everything in *What changed on 5 October*. Reused since for small follow-ups. | Merged |
| `claude/step-up-app-launch-prep-j18yry` | Its twelve commits are all on main (PR #39). | Delete |
| PR #36 `claude/rescued-launch-readiness` | Launch-readiness fixes rescued from stranded branches, from 28 September. | Open; check what main has since |
| PR #34 `claude/launch-sprint-catalogue` | The Funeral Rule catalogue, storefront and itemised statement. | Open — the keep-or-drop decision |
| PR #8 `claude/component-5-forms` | Forms and authorisations into the **old** integration branch. | Open since 14 Sep; wait on a lawyer, then close |
| `demo/2026-10-04` | Replit's "Published your App" commit from 28 September's main, with Replit's own edits to every `artifact.toml` and the lockfile. | **Never merge it**: it repoints every texted link and breaks CI |
| **continuumaftercare.com** | A Replit app built 26 September from code of 21–23 September. **Every address, including `/admin/`, serves the old family portal**: no director can sign in there. | Out of date |
| **funeral-home.replit.app** | The `demo/2026-10-04` publish: director console at `/`, family portal at `/family/`, platform console at `/admin/`. | Out of date |

Both Replit apps answer `/api/healthz` with `mail: false, sms: false`, have no
`TASK_SECRET` (so no scheduled job has ever run there), inject Replit's
analytics script into every page, and send no security headers. The Docker
path (`DEPLOY.md`) has none of those problems.

---

## What only an owner can do

In the order that unblocks the most:

1. **Make the repository private.** It is public: the code, the drafts in
   `LEGAL/`, `PRICING.md` and everything in the history can be read and
   copied by anyone. GitHub also switches off a public repository's
   scheduled workflows after sixty days without activity, which would quietly
   stop the aftercare sender. On github.com in a browser: Settings → General
   → Danger Zone → Change visibility. Nothing in the code depends on it being
   public, but **Actions minutes stop being free.** A free account includes
   2,000 a month, and when they run out every workflow stops until the month
   turns, the aftercare sender included. The scheduled jobs use about 1,500
   a month (uptime and aftercare hourly, the rest daily or weekly) and CI
   about 18 a push to an open pull request. Before aftercare matters, put a
   card on file with a small Actions spending limit, or take GitHub Pro
   (3,000 minutes), so a busy month cannot switch it off.
2. **Switch off Replit's analytics** on both apps (the deployment's settings).
   It sends each page's full address to Replit, and a family's address
   carries their link, which is their credential. Until it is off, do not
   send a real family a link to a Replit deployment.
3. **Choose the price.** Main shows $169 a location a month plus $7 a
   funeral on the website and in every home's Settings. The pricing research
   (delivered separately, not in this public repository) recommends keeping
   that level with a cap of 25 funerals per location per month, a 60-day
   trial instead of 30, and about ten founding pilots at 30% off for two
   years. Decide, or hide that line, before main is deployed.
4. **A lawyer.** The brief for counsel (delivered separately) lists about
   thirty sentences in the drafts that are not true of the code, eight of
   them since fixed in code, and the questions to settle: what reaches which
   vendor, texting consent, contract mechanics, retention. Twilio now
   requires public privacy and terms URLs before it registers a sender, so
   texting waits on this too. Keep `ANTHROPIC_API_KEY` unset until the DPA
   names Anthropic.
5. **Deploy main for real**, or at least republish Replit from it and
   point the domain at that app. `DEPLOY.md` is the Docker path; give the API
   container 2 GB at least (`DEPLOY.md`, "How it holds up under
   photographs").
6. **Accounts.** A mail provider (then `send-test-email` until it lands in an
   inbox); a bucket for `BACKUP_OFFSITE` and the encryption key in a password
   manager; Stripe test keys, `stripe-setup -- --apply`, one test-mode cycle
   including a per-funeral invoice; a Twilio number after the lawyer.
7. **Know when it breaks.** A Sentry project and `SENTRY_DSN` (after the DPA
   lists Sentry), a phone-paging monitor on `/api/healthz`, and the `API_URL`
   secret so `uptime.yml` runs.
8. **Turn on the scheduled jobs.** `API_URL` and `TASK_SECRET` repository
   secrets, one dry run of each of `aftercare.yml` (now hourly), `usage.yml`
   and `trial-reminders.yml`, then `REQUIRE_TASK_SECRETS=true`.
9. **Repair the plans saved before 5 October**, on any database that held
   one (the Replit databases):
   `pnpm --filter @workspace/scripts run fix-plan-records`, read what it says,
   then again with `-- --apply`. It prints case numbers, never names.
10. **One pilot home, one real family.** Every test so far is synthetic.
11. **Delete the merged branches** (below). Lossless, and only an owner should.

---

## Branch clean-up

Regenerate the list rather than trusting this one; it is a snapshot.

```sh
pnpm --filter @workspace/scripts run dead-branches
```

On 4 October, 22 branches contained nothing main does not have; the script
prints the exact `git push origin --delete …` command. Add
`claude/step-up-app-launch-prep-j18yry`, whose work merged in PR #39. Old polish branches whose work landed in another form
(`claude/polish-*`, `claude/design-polish-*`, `claude/publishing-issue-alvr9f`,
`claude/multi-repo-loading-business-wqd37k`): read the one or two commits,
then delete. Deleting a branch is not reversible from the GitHub UI, which is
why this is an owner's job and not an agent's.

---

## What changed on 5 October

Each is its own commit, merged in PR #39, with the reasoning in the
message.

- **The stranded 2 October work is merged**, keeping main's 72-hour clock and
  porting the other's "physician certified" time onto it.
- **A relative on somebody's plan is spoken to about them, not as them**
  ("Beverly's plan", "where they live"), and the planner as "you". The
  director marks who the planner is.
- **The dead are no longer written to.** When a plan became a funeral, the
  planner's link stayed live and closing the case enrolled them in grief
  check-ins at their own address. Now their link closes, they are nobody's
  next of kin, and aftercare never includes them. `fix-plan-records` repairs
  older plans, including a planner named as informant on their own
  certificate.
- **Texting.** "Stop please" and the FCC's other revocation words opt out;
  STOP to a home's own registered number is no longer refused; HELP is
  answered once and names the home; any other reply is told where a person is
  instead of vanishing.
- **Check-ins arrive on their day**, at mid-morning where the home is; the
  sender runs hourly and keeps to 9:00–19:00 local. "Today would have been her
  birthday" used to arrive the day after.
- **A home can stop a family's check-ins** when they telephone, as the
  unsubscribe page always promised.
- **Erasing a case erases the public-page request** it came from.
- **Production logs no longer hold reset links, family links or families'
  words**, for mail and texts.
- **Passwords** are hashed at OWASP's strength and upgraded at sign-in.
- **Backups copy themselves off the host** (`BACKUP_OFFSITE`), and the weekly
  drill restores from the far copy.
- **A load test of 1,000 phone photographs** passed, and fixed the two things
  it found: conversion held a database connection (one family's uploads
  slowed everybody's pages) and the 1,000 cap could be overrun.
- **docker-compose passes every setting the API reads**, checked in CI; ten
  were missing, including the per-funeral price.
- **The platform console returns to sign-in** when its session ends.
- **American English** in the demo, the marketing site and the screens.

## Known gaps, after 5 October

- **The C.R.S. 15-19-106 authorisation order, and forms**, wait on a lawyer
  (`COLORADO.md`).
- **The legal drafts are untrue in places** and were deliberately left for
  counsel, with the brief, rather than rewritten here.
- **Replit pages have no security headers.** The Docker path's nginx sets
  them (`deploy/security-headers.conf`); Replit's static hosting does not.
- **Two denial-of-service edges, older than this branch** (found by its
  security review): uploads are read into memory whole (up to 50 MB each)
  before any check, so one forwarded family link sending forty at once
  could hold 2 GB; and each sign-in attempt costs about 240 ms of a
  four-thread pool, limited only per address. Both want a process-wide
  concurrency cap (uploads waiting their turn with a 429 the portal already
  retries, sign-ins queueing) before the platform is advertised.
- **Infrastructure, sized for a pilot:** uploads in Postgres (about 0.6 MB a
  photograph, in every backup), one API instance, an in-memory rate limiter.
  `DEPLOY.md`, "What this is not".
