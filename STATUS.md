# Status — where things stand

Last checked: **5 October 2026**, against `origin` as it stood that evening;
the branches and pull requests again on **7 October**, after PR #41 merged.
Update this file when any of it changes; a stale status page is worse than
none. (The 23 September version listed six "left for an owner" items that
had in fact been built. Check before you trust a list.)

## The short version

- **Every suite was green, and the code still was not finished.** A launch
  review on the evening of 5 October — five independent audits, each finding
  checked against the code before anything changed — found defects 770
  passing tests had not: an outsider could take over the platform console;
  every member of staff was sent the platform's private notes on their home;
  imported service times printed six hours early; a late "yes" to check-ins
  sent three grief notes in a minute; a STOP could be forgotten. Main has the
  fixes, from PR #41 (merged 6 October): twenty that evening, and that night
  every finding the review had left open but two that are decisions — billing
  before the first charge, a STOP written as a sentence, links passed on,
  photographs on old phones, the abuse ceilings, backups that could not be
  trusted, logs holding family links. Each comes with a test that fails on
  the old code (*What the launch review changed* and *What the second pass
  changed*, below). What is still open is under *Still open*.
- **What is left for launch is mostly not code.** A price, a lawyer, a real
  deployment, and four accounts (mail, Twilio, Stripe, a backup bucket) —
  and, before the first charge, Stripe's dashboard set as `PRICING.md` says
  and one cycle in test mode.
- **Two things to do this week that cost nothing:** make this repository
  private, and switch off Replit's analytics injection. Both are below.
- **Nothing live runs current code.** Both Replit apps serve builds from
  before 28 September, and the one on your domain shows the old family portal
  at every address.

---

## What is live, and where the work is

| Where | What it holds | State |
| --- | --- | --- |
| `claude/funeral-home-portal-uj9bik` | **Main**, GitHub's default branch. Everything through PR #41 (6 October), the launch review's fixes included. | Green |
| `ccr-159a35a1-xifk0k` | Merged as PR #41: the launch review's fixes, twenty that evening and twenty-seven that night, and the hourly uptime check (`dae846e`, first pushed as `3636527` to `ccr-7f48fd16-gacxdi` after PR #39 merged). Reused since for follow-ups. | Merged |
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
   send a real family a link to a Replit deployment. A build of current code
   refuses the script by itself (each page now carries its own
   Content-Security-Policy), but nothing live is current code.
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
   manager; Stripe test keys, `stripe-setup -- --apply`, the four dashboard
   settings in `PRICING.md` ("Before you charge a single home"), and one
   test-mode cycle with a per-funeral invoice, a subscription started during
   a trial, and a cancellation; a Twilio number after the lawyer.
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

## What the launch review changed, 5 October (evening)

Merged to main in PR #41. Each is its own commit with the reasoning, and
each comes with a test that fails on the code before it.

- **The platform console could be taken over.** Confirming an address
  proved the inbox, not the password: whoever registered a listed address
  first kept their password and session, and the owner's click on the
  confirmation let them in. Now a listed address being confirmed, or a
  confirmed one being listed, clears its password, sessions and outstanding
  links, and emails the inbox a link to choose a password. Each platform
  admin gets that email once (`replit.md`, "How you get in").
- **Every member of staff was sent the platform's notes on their home**
  (plan, amount, discount, admin notes) with every sign-in and page load.
- **Imported service times were six hours early** — read in the server's
  UTC — and "1:00 PM" was read as 1:00 AM; impossible dates rolled into the
  next month. Imports now use the home's clock and refuse what they cannot
  read; a service given only a day is left blank and listed.
- **Late grief notes went out together.** A family who said yes ten weeks
  on got "Thinking of you", "Two months on" and a birthday note seven weeks
  late in one minute; the same would have happened the day SMTP is switched
  on. A note now goes inside its window (a day for birthdays and
  anniversaries, a week for the holidays, a fortnight for the monthly ones)
  or is marked missed, which the director sees.
- **A STOP from the number a family gave for check-in texts** was forgotten
  when the home moved to its own number; so was a carrier-level STOP.
- **The director console stayed signed in** after its session ended, cases
  on screen and saves failing silently. The family portal now shows the
  expired-link screen on a refused save, and "Forget it here" forgets an
  unsent message too.
- **Backups over 2 GiB could not be restored or verified**; a failed dump
  left plaintext behind; nginx's access logs held every family link and
  reset token.
- **Query values reached the logs and the error tracker** (a front-door
  request's names, email and note), and malformed requests were 500s anyone
  could send to drain the tracker's quota.
- **Uploads and password checks are capped for the whole process** — the
  two denial-of-service edges listed below on 5 October morning.
- **IPv6 callers are counted by their /64**, and DEPLOY.md no longer advises
  AAAA records the compose network cannot honour.
- Also: deactivating staff ends their sessions; "forgot password" no longer
  takes longer for real accounts; a photo pack too large for one archive is
  refused before it starts; a blank `STRIPE_PRICE_ID` no longer switches the
  no-card trial off; every Stripe signature is checked during a secret roll;
  "your trial ends tomorrow" is no longer sent on the day it ends.

## What the second pass changed, 5 October (night)

Also in PR #41: the findings the evening's review had left open, each its
own commit with a test that fails on the code before it.

**Billing, before the first charge.**

- **The webhook believes Stripe, not the event.** It fetches the
  subscription as it is now and applies that, one delivery per customer at a
  time. Checkout's "created, unpaid" and "updated, paid" often share a
  second, and the second of the two was dropped as stale, with "incomplete"
  read as cancelled: a home that paid could be left unable to open a case.
  An old subscription ending no longer cancels its replacement, a home whose
  subscription ends moves onto another of its own that is still running,
  and an unreachable Stripe is a 503 so Stripe sends the event again.
- **A trial Stripe holds is a trial**, not "Active": its funerals are waived
  as the price list promises, the console says when the first payment is
  taken, and the home is not refused a case in the minutes Stripe takes to
  take it. A home whose subscription ended can subscribe again; it was sent
  to Stripe's portal, which cannot start one.
- **Checkout gives the trial a home has left**, not thirty fresh days from
  every button (and another month after every cancellation), asks for a
  card, and refuses a second subscription.
- **The meter cannot stall or lose a funeral quietly.** Homes with nobody to
  bill no longer fill its pages, failures go after new funerals, a funeral
  is stamped when it reaches Stripe (one stamped 35 days back, or in an
  invoiced period, was never billed), and `usage.yml` goes red on one that
  has failed for three days.
- **Imported cases are counted**; history a spreadsheet brings across is
  waived. **A group is charged for the locations it has**, as they come and
  go. **Trial reminders survive a mail failure**, are not crowded out by
  finished trials, are not sent to a group's locations, and start again for
  a location that leaves its group. The renewal date is read where Stripe's
  current API keeps it.

**Texting and abuse.**

- **A STOP written as a sentence** — "Please stop sending these, it is too
  painful" — opts out, and "please cancel the viewing" and "can we stop by"
  do not: a table of fifty-two replies pins it (*Still open*, for the
  lawyer).
- **Twilio's signature is believed** with the default port in the URL or
  out of it; a STOP signed the other way was refused.
- **Account emails are capped per address** — "account exists", resets,
  confirmations — counted by a hash of the address in `sent_emails`, without
  changing any answer or how long it takes.
- **The front door's hourly ceilings hold** when requests arrive together.
- **Invitations** are emailed only once somebody at the home has confirmed
  an address, three an hour and six a day to one address, to at most twenty
  new people a day; the owner always has the link, and is told when and why
  it was not emailed.

**Families.**

- **Stopping or replacing a link stops the links passed on from it**, and
  says whose; the director can keep them for family.
- **Grids draw from thumbnails**, made once and kept, erased with the case
  and left out of exports, so a bin of hundreds no longer holds every
  full-size photograph in an old iPhone's memory.
- "Forget it here" asks a borrowed device's user to clear its history; the
  expired-link screen says when the change being saved was not kept; the
  console empties its cache when somebody else signs in, says when it cannot
  reach the server instead of asking for a password, and takes HEIC by its
  extension. The front ends' tests are now typechecked.

**Operations.**

- **Each app's HTML carries its own Content-Security-Policy and
  `no-referrer`**: Replit's analytics script is refused and no request sends
  a family's link as a Referer, with or without nginx in front.
- **Caddy's log** writes `/f/REDACTED` and drops the Referer.
- **`verify-backup` checks the restore against counts taken inside the
  dump's own snapshot**, so a busy night no longer reads as a broken backup,
  and decrypts a photograph and an SSN, which `DEPLOY.md` said it did and it
  did not.
- **A backup stopped part way leaves no plaintext**, whatever stops it.
- **The API says when `TRUST_PROXY_HOPS` looks too low**, once a day.
- The website says how long a family link really lasts.

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
  Each app's HTML now carries the two a page can, the Content-Security-Policy
  and `no-referrer`, so what is missing there is what only a header can do:
  X-Frame-Options and `frame-ancestors`, nosniff, HSTS.
- **Infrastructure, sized for a pilot:** uploads in Postgres (about 0.6 MB a
  photograph, in every backup), one API instance, an in-memory rate limiter.
  `DEPLOY.md`, "What this is not".

## Still open

Found, checked against the code, and not fixed: each needs a decision, a
live account, or a measurement on the real host.

**Billing.** Stripe has still never taken a payment. Set its dashboard as
`PRICING.md` says ("Before you charge a single home") and run one cycle in
test mode: monthly, annual, a per-funeral invoice, a subscription started
during a trial, and a cancellation.

**For the lawyer.** How a reply is read as STOP (`revokesConsent`). A clause
that asks for the texts to stop opts out, as does "stop" alone; "cancel" and
"end" count only about the texts, so "please cancel the viewing" does not;
a negative is not read, so "if you don't stop texting me" stops; and
"revoke" anywhere opts out, so "revoke the cremation authorization" would.
The FCC asks for "any reasonable means"; have counsel confirm this reading.
Every opt-out is answered with how to undo it (START).

**Abuse.**

- **Registration answers 201 for a new address and 202 for a taken one**,
  so whether an address has an account can be learned by trying to
  register it. Kept on purpose: the per-address ceilings take away the
  harassment it allowed, and closing it would mean nobody can use the
  product until they have clicked a link in an email.
- **Texts on the shared number have no ceiling per home.** A home on trial
  can text a family link, from the platform's shared sender, to any number
  it types and ticks consent for, and enough of that would get the number
  filtered for every home on it. Before homes without their own registered
  number are switched on, add a daily ceiling per home for the shared
  sender, sized against a busy home's aftercare days; it needs a record of
  texts sent, which does not exist yet.
- **An address added as staff and never used is held by that home**: its
  owner cannot register a home of their own until it is removed there.

**Families.** If a director ticks "keep" on stopping a link while a relative
is being added from it, that new relative's link is kept too.

**Operations.**

- nginx's error log keeps a failing request's whole address and cannot be
  told otherwise. With the apps sending no Referer, that means an aftercare
  stop token while the API is down, a family link only if nginx cannot read
  `index.html`, and a staff search's terms (`DEPLOY.md`, on logs). Caddy's
  log now keeps none of them.
- On Replit, `TRUST_PROXY_HOPS` is the default 1, unmeasured. The API now
  warns in its log, once a day, when a request shows the number is too low
  (a private `req.ip`, a public address further back): after the first real
  visit to a deployment of current code, look for `TRUST_PROXY_HOPS` in its
  log. None means 1 is right, unless the API sees Replit's router at a
  public address, which the check cannot tell from a visitor.
- The tools container's init (`init: true`), which lets a stopped
  backup clean up after itself, was checked as PID 1 of a PID namespace with
  tini, not under Docker itself. Each run first clears what an earlier one
  left, which is the backstop.
