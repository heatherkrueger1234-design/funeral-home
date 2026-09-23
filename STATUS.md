# Status — where things stand

Last checked: **23 September 2026**. Update this file when any of it changes;
a stale status page is worse than none.

## The short version

- **The code is healthy.** CI (typecheck, tests, codegen drift, build) is green
  on the main branch and on the open pull request #25.
- **The scheduled jobs fail every day**, because there is nowhere for them to
  send their request yet. This is a settings problem, not a code problem.
- **There are two "main" branches.** Most of the recent confusion comes from
  this. A block of work from 14 September lives only on the old one.
- **29 branches exist; about half are finished and can be deleted.**

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
| Role | **Main.** GitHub's default branch. | The integration branch from `TEAM-SPLIT.md` |
| Last activity | Today | 21 Sep |
| Has | Everything live: portal, console, admin, rename, routing, polish | Components 3–6 as first built |
| Missing | Storefront, catalogue, statement, forms/authorisations, engagement scoring | 75 commits of everything since |

The six-component plan in `TEAM-SPLIT.md` told each agent to merge into
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

| PR | Into | State | What to do |
| --- | --- | --- | --- |
| **#25** Photo card polish + admin/home/client audit | main | CI green, mergeable | Review and merge. Brings in the memory book, the role audits and the marketing site. |
| **#8** Component 5 — forms and the 72-hour clock | the *old* branch | Stale since 14 Sep | Wait on the Problem 2 decision. Merging it only moves it onto the dead branch. |

## Problem 4 — Branch clean-up

**Safe to delete — fully contained in main already** (nothing is lost):

```
claude/e2e-business-viability-yc2973        (identical to main)
claude/continuum-aftercare-login-separation-jz9l3k
claude/home-descendant-template-wbapxg
claude/missing-login-link-7m9wqx
claude/scores-launch-readiness-ku9cv8
claude/funeral-pricing-strategy-pcb8ve
claude/new-session-g63cjh
claude/bug-hunt-ltpnxw
claude/security-issues-5cpjhp
claude/app-bug-hunt-launch-ffh45g
claude/funeral-home-master-dashboard-gdg8pn
claude/polish-every-page-9jmstp
claude/component-2-admin
```

**Delete once PR #25 merges** (it carries their work):

```
claude/two-branches-heere-dxhyv8
claude/design-polish-refinement-pw0ush
claude/admin-home-client-e2e-audit-dqolc4
```

**Look at before deleting — has work main does not:**

| Branch | Unmerged work | Suggestion |
| --- | --- | --- |
| `claude/e2e-test-audit-grading-q34s5o` | A Playwright end-to-end suite (`artifacts/e2e-tests`) and an `e2e` CI job | **Worth salvaging.** Nothing currently tests the real UI in a browser. Port it in its own PR. |
| `claude/admin-login-continuumaftercare-lhykml` | An alternative `/console` + `/admin` path layout for Replit | Superseded by the `/`, `/admin`, `/family` layout now on main. Delete. |
| `claude/publishing-issue-alvr9f` | Admin-console Replit manifest, lockfile sync, removal of a `.conversation/` dump | Already solved on main in other commits. Delete. |
| `claude/polish-refine-design-72vt7u` | Four design commits (belongings, hard-death guidance, certificate number) | Check whether each landed on main in another form, then delete. |
| `claude/multi-repo-loading-business-wqd37k` | Pre-need, sealed notes, merchandise, the timezone fix | `forms.ts` was already salvaged from here into PR #8. The rest was left behind on purpose. Delete after Problem 2. |
| `claude/component-{3,4,5,6}-*`, `claude/component-5-forms-an85uj`, `claude/app-capability-check-mvfn8x` | The Problem 2 work | Keep until Problem 2 is decided. |

## Smaller known issues

- The marketing website only appears when `WEBSITE_URL` is set and the Docker
  `website` profile is started; the bare domain goes to the console.
- `LAUNCH.md` → *What is not ready* is the fuller list for launch readiness.

## What to do next, in order

1. Disable or configure the three scheduled workflows (Problem 1). Five minutes.
2. Merge PR #25.
3. Delete the branches marked safe above.
4. Decide keep-or-drop for each of the four old-branch features (Problem 2).
5. Port the Playwright suite from `claude/e2e-test-audit-grading-q34s5o`.
