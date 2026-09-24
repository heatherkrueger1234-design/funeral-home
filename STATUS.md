# Status — where things stand

Last checked: **23 September 2026**, branch counts re-measured against main on
the same day. Update this file when any of it changes; a stale status page is
worse than none.

## The short version

- **The code is healthy.** CI's typecheck, tests, codegen-drift and build jobs
  are green on main.
- **The `e2e` job was red from the day it was added** and is now fixed. It was
  never a test failure: CI exported the fixed public encryption key, which
  `lib/db/crypto.ts` refuses in production, so the API could not boot and
  Playwright never ran a test. Worth knowing because it passed locally the
  whole time — nothing sets that variable there.
- **The scheduled jobs fail every day**, because there is nowhere for them to
  send their request yet. This is a settings problem, not a code problem.
- **There are two "main" branches.** Most of the recent confusion comes from
  this. A block of work from 14 September lives only on the old one.
- **29 branches exist; 18 of them contain nothing main does not** and can be
  deleted without losing a line.

---

## Problem 1 — The red X on Actions every day

**What you see:** the *Aftercare* and *Trial reminders* workflows fail once a
day. *Usage* has not run yet; its first run (02:00 UTC) will fail the same way.
CI itself is fine.

**Why:** each of those jobs does one thing: send an authenticated request to the
live server (`POST /api/tasks/…`) so it does the day's sending. They need two
repository secrets to know where that server is, and neither is set:

```
API_URL and TASK_SECRET must be set as repository secrets.
```

The job fails on purpose when they are missing, so nobody believes the
aftercare emails are going out when they are not.

**Fix — pick one:**

1. **Once the app is deployed:** in GitHub, *Settings → Secrets and variables →
   Actions*, add
   - `API_URL` — the deployed API's base address, e.g. `https://continuumaftercare.com`
   - `TASK_SECRET` — the same value as `TASK_SECRET` on the server (see `.env.example`)

   Then run each workflow once by hand with *dry run* ticked to confirm.
2. **Until then:** in the *Actions* tab, open each of the three workflows and
   choose *Disable workflow*. Turn them back on after doing step 1.

Do not "fix" this by making the jobs pass when the secrets are missing. The
day that hides a real misconfiguration, a family's check-in silently never goes
out.

## Problem 2 — Two main branches

| | `claude/funeral-home-portal-uj9bik` | `claude/app-capability-check-mvfn8x` |
| --- | --- | --- |
| Role | **Main.** GitHub's default branch. | The integration branch from the old build plan |
| Last activity | Today | 21 Sep |
| Has | Everything live: portal, console, admin, rename, routing, polish | Components 3–6 as first built |
| Missing | Storefront, catalogue, statement, forms/authorisations, engagement scoring | 75 commits of everything since |

The six-component plan (now `docs/history/parallel-build-plan.md`) told each agent to merge into
`app-capability-check`. That branch was merged into main **once** (PR #1, 14
Sep). After that, components 3, 4, 5 and 6 kept landing on it, and it was never
merged back. Meanwhile everyone else kept working on main.

The two have now drifted by **456 files and ~55,000 lines**. It is not a merge
anyone should attempt in one go.

What is on the old branch and nowhere else:

- **Storefront and catalogue** (`lib/db/src/schema/{storefront,catalogue}.ts`) —
  a home showing a family goods, itemised per the FTC Funeral Rule
- **The itemised statement** and the handoff to the home's own payment page
- **Forms and authorisations** on Colorado's 72-hour death-certificate clock
  (this is also what open PR #8 adds)
- **Engagement scoring** (`lib/db/src/schema/engagement.ts`)

Some of this main has since rebuilt differently (`policies.ts`, the admin
console, the deployment/TLS work), which is part of why a straight merge
would conflict everywhere.

**Decision needed (owner, not an agent):** for each of the four items above —
*bring it to main* or *drop it*. Then:

- *Bring it:* one small pull request per item, into main, copying that one
  feature's files across and fixing them against current main. Not a branch
  merge.
- *Drop it:* close PR #8 and say so in this file, so nobody rebuilds it by
  accident.

Either way, nothing new should be based on `app-capability-check-mvfn8x`.

## Problem 3 — Open pull requests

One is open. **#25 and #27 have merged** since this file was first written, so
the photo-card polish, the role audits, the marketing site and the first pass at
this documentation are all on main now.

| PR | Into | State | What to do |
| --- | --- | --- | --- |
| **#8** Component 5 — forms and the 72-hour clock | the *old* branch | Stale since 14 Sep | Wait on the Problem 2 decision. Merging it only moves it onto the dead branch. |

## Problem 4 — Branch clean-up

**These 18 branches are ready to delete and I could not do it.** This session's
git credentials push commits fine but GitHub answers 403 on deleting a ref, one
at a time or in a batch, so it needs to come from a machine whose credentials are
not scoped that way. One paste:

```sh
git push origin --delete claude/admin-home-client-e2e-audit-dqolc4 \
    claude/admin-login-continuumaftercare-lhykml \
    claude/app-bug-hunt-launch-ffh45g \
    claude/bug-hunt-ltpnxw \
    claude/component-2-admin \
    claude/continuum-aftercare-login-separation-jz9l3k \
    claude/design-polish-refinement-pw0ush \
    claude/e2e-test-audit-grading-q34s5o \
    claude/funeral-home-master-dashboard-gdg8pn \
    claude/funeral-pricing-strategy-pcb8ve \
    claude/home-descendant-template-wbapxg \
    claude/missing-login-link-7m9wqx \
    claude/new-session-g63cjh \
    claude/organize-code-issue-breakdown-4g89yg \
    claude/polish-every-page-9jmstp \
    claude/scores-launch-readiness-ku9cv8 \
    claude/security-issues-5cpjhp \
    claude/two-branches-heere-dxhyv8
```

If that 403s for you too, it is a repository ruleset rather than a token scope —
look under Settings → Rules → Rulesets for a rule matching `claude/*` that
denies deletion.

Regenerate the list any time, rather than trusting this one:

```sh
pnpm --filter @workspace/scripts run dead-branches
```

That checks both things that matter: whether every commit is already on main,
**and** whether the branch changes anything at all, which is the only way to
spot a squash-merged branch (its work is on main, its commits are not, so it
reads as "ahead" forever). It prints the delete command and deletes nothing.

### Why deleting these loses nothing

Every commit on each one is already an ancestor of main —
`git rev-list --count main..branch` is 0 for all 18, checked immediately before
the attempt. And they are reversible even so: each tip is a commit that still
exists in main's history, so any branch here comes back with
`git branch <name> <sha> && git push origin <name>`.

| Branch | Tip |
| --- | --- |
| `claude/admin-home-client-e2e-audit-dqolc4` | `fb61c668787e` |
| `claude/admin-login-continuumaftercare-lhykml` | `84f00a08c874` |
| `claude/app-bug-hunt-launch-ffh45g` | `3449fc547ad3` |
| `claude/bug-hunt-ltpnxw` | `b3364dd1fd5a` |
| `claude/component-2-admin` | `34dc412e1220` |
| `claude/continuum-aftercare-login-separation-jz9l3k` | `e2c05eec542f` |
| `claude/design-polish-refinement-pw0ush` | `9d8afcb33bd9` |
| `claude/e2e-test-audit-grading-q34s5o` | `8a014234fd98` |
| `claude/funeral-home-master-dashboard-gdg8pn` | `7de63282e191` |
| `claude/funeral-pricing-strategy-pcb8ve` | `b06c1a7861e7` |
| `claude/home-descendant-template-wbapxg` | `511f51365b57` |
| `claude/missing-login-link-7m9wqx` | `18b78e056c92` |
| `claude/new-session-g63cjh` | `b0f16e1d078b` |
| `claude/organize-code-issue-breakdown-4g89yg` | `f80a9d281798` |
| `claude/polish-every-page-9jmstp` | `8a1165c4595a` |
| `claude/scores-launch-readiness-ku9cv8` | `f122da7b23d1` |
| `claude/security-issues-5cpjhp` | `9c15ac080fd1` |
| `claude/two-branches-heere-dxhyv8` | `4d116c641d42` |

**Held back deliberately:** `claude/e2e-polish-qa-twqkoy` went from 7 commits
ahead to 0 while this was being written, because main absorbed it. It is just as
safe, but it belongs to a session that may still be running and there is no
reason to delete a branch out from under a live agent. Take it on the next pass.

**Has work main does not** — the number is commits ahead of main:

| Branch | Ahead | Suggestion |
| --- | --- | --- |
| `claude/e2e-business-viability-yc2973` | 1 | Live. This documentation work. |
| `claude/publishing-issue-alvr9f` | 3 | Solved on main in other commits. Delete. |
| `claude/multi-repo-loading-business-wqd37k` | 4 | Pre-need, sealed notes, merchandise. The timezone fix from here is already on main. Delete after Problem 2. |
| `claude/polish-refine-design-72vt7u` | 4 | Four design commits. Check whether each landed in another form, then delete. |
| `claude/component-3-storefront-zx98e1` | 7 | Problem 2. |
| `claude/component-4-payments-78wtgq` | 11 | Problem 2. |
| `claude/component-5-forms` | 11 | Problem 2 — this is PR #8's head. |
| `claude/component-6-engagement` | 17 | Problem 2. |
| `claude/component-4-deployment-30nocy` | 25 | Problem 2. |
| `claude/app-capability-check-mvfn8x` | 31 | Problem 2. The old integration branch itself. |
| `claude/component-5-forms-an85uj` | 34 | Problem 2 — a second, larger forms attempt. Compare with `component-5-forms` before either is merged; two answers to the same problem is one too many. |

Deleting a branch is not reversible from the GitHub UI, so this is the owner's
call and not an agent's, even for the eighteen that are provably lossless.

## Smaller known issues

- The marketing website only appears when `WEBSITE_URL` is set and the Docker
  `website` profile is started; the bare domain goes to the console.
- `LAUNCH.md` → *What is not ready* is the fuller list for launch readiness.

## The polish pass of 24 September

All three apps were walked page by page, in a real browser at desktop and phone
width, with the showcase data in them, and every screen's code read through.
What that found and fixed is in the commit history; the ones worth knowing:

- **Invitations died after an hour.** A new owner's or new director's
  invitation used the password-reset lifetime. They now last seven days.
- **Replying from the inbox left the family "waiting".** Only opening the
  thread marked their messages read. Replying now does too, on both sides.
- **A relative tabbing through the preparation notes undid the director's
  sign-off** without changing a word. Only a real change resets it now.
- **The case list could show "No open cases"** at a home with many closed
  ones, because it fetched 100 of everything and hid the closed ones.
- **Changing the family's ZIP code on *Local help* was impossible**, and the
  setup checklist's "open a case" step linked to the page it was on.
- Every page that used to go blank, or say "nothing here", when its data failed
  to load now says so and offers *Try again*.
- The e2e suite covers the admin console, and the full message round trip
  between a family and the inbox, for the first time.

Left for an owner, because each is a decision or needs a new API parameter
rather than a fix:

- The admin *Homes* list cannot filter by state (trial, suspended, past due)
  or sort, and the access log cannot page past 200. Both need `admin.ts`
  parameters first; sorting in the browser would only sort one page.
- A home marked "ours" disappears from *Homes* with no way to list it again.
- Pre-need files still use after-death wording on *Belongings*, *Certificate*
  and the family hub.
- The family portal uses the red `--destructive` colour for form errors, which
  `CRAFT.md` rules out for families. Needs a softer token, which is a design
  call.
- The groups endpoints (`/admin/groups`) have no screen.

## What to do next, in order

1. Disable or configure the three scheduled workflows (Problem 1). Five minutes,
   and it is the only thing here that is currently failing daily.
2. Delete the eighteen branches marked safe above.
3. Decide keep-or-drop for each of the four old-branch features (Problem 2).
   This is the one that needs an owner, not an agent.

Done since this list was written: PR #25 and #27 merged, and the Playwright
suite was ported from `claude/e2e-test-audit-grading-q34s5o` and made to run.
