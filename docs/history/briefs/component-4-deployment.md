# Component 4 — Getting this on a real host

**Branch:** `claude/component-4-deployment` → PR into `claude/app-capability-check-mvfn8x`
**Depends on:** nothing. Start immediately.
**Read:** `DEPLOY.md` and `LAUNCH.md` in full before anything else.

## Why this is a component and not a chore

Everything else in this build adds features to a product **that has never run
anywhere**. No host, no domain, no TLS, no mail, no real payment, and no real
family has ever opened the family portal. `LAUNCH.md` is blunt about it and it
is the honest assessment: ready for a supervised pilot, not ready to sell.

Until one funeral home is using this with one real family, every other
component is a guess. You are the one turning the guess into a fact, which
makes this the highest-leverage job on the board rather than the plumbing one.

## What is already done, and is not your job to redo

`DEPLOY.md` has the verified list. In short: all four images build, the stack
comes up with every container healthy, migrations apply through the `tools`
container, a genuine iPhone HEIC goes in through nginx and comes back as a
JPEG, and a backup taken inside the containers restores with the photo
byte-for-byte identical and an encrypted SSN still decrypting.

The stack works. **The deployment around it is what has never been tested.**

## What you own

- `deploy/**`, `docker-compose.yml`, the `Dockerfile`s
- `.github/workflows/**`
- `DEPLOY.md` and `LAUNCH.md` — keep both honest as you go
- Anything new: provisioning scripts, a staging compose file, monitoring config

You do **not** own application code. If deploying reveals an application bug —
and it will, the last round of container work turned up two — fix it if it is
small and obviously yours, and otherwise file it precisely enough for the
owning component to act on.

## The secrets rule, which matters more than the rest of this file

**You do not generate, hold, store or commit production secrets.** Not the
`ENCRYPTION_KEY`, not SMTP credentials, not Stripe keys, not the Twilio token,
not `TASK_SECRET`, not the Postgres password.

`ENCRYPTION_KEY` above all. Every uploaded photograph and every social security
number, in the database and in every backup, is AES-256-GCM under it. Lose it
and the ciphertext is worthless. Leak it and everything is readable. It is
generated once, by Heather, on a machine that is not a shared agent session,
and kept somewhere that is neither the host nor the backup.

So your deliverable around secrets is a **runbook**: what each one is, how to
generate it, where it goes, what breaks without it, and what it costs to lose
it. Never a value. Use obvious placeholders and `.env.example`, which already
exists and is good.

If you are given real credentials for a staging environment, treat them as
staging-only, keep them out of the repository and out of commit messages, and
say plainly in the PR that they were used.

## The work, in order

**1. Staging, end to end.** A real host, a real domain, real TLS. Bring the
stack up exactly the way `DEPLOY.md` says and find out where the document is
wrong — it will be, in the small ways documents are wrong until somebody
follows them. Then fix the document.

**TLS is not optional and the failure is silent.** In production the session
cookie is `Secure`, so served over plain HTTP the browser accepts it and never
sends it back: the director signs in, lands on the sign-in page again, and
nothing obvious explains why. The server logs a specific warning for exactly
this — make sure that warning is somewhere a human will see it.

**2. Mail.** Without SMTP, password resets, aftercare and intake alerts are
written to the log instead of sent, which means a director who forgets their
password cannot get back in without somebody reading a server log. Configure
it, send a real reset, click a real link.

**3. The aftercare job.** This is the feature the subscription is actually for
and it does nothing until something triggers it. `.github/workflows/aftercare.yml`
already posts daily at 14:00 UTC and needs `API_URL` and `TASK_SECRET` as
repository secrets, matching the server's. Without `TASK_SECRET` set on the
server the endpoint refuses everything, which is deliberate. Verify with
`?dryRun=1` first — that is how you check the wiring without writing to a
bereaved family.

**4. Backups, off this host.** They currently land next to the thing they are
protecting. Get them somewhere else automatically, then run
`verify-backup` and watch a restore actually happen. `.github/workflows/backup-drill.yml`
exists; make it real.

**5. Monitoring that wakes a human.** Uptime, certificate expiry, disk, and
whether the aftercare job ran. A dashboard nobody opens is not monitoring.

**6. Stripe, in test mode, through one full cycle.** The webhook signature
check is tested; a live charge is not. Trial → subscribe → renew → cancel, and
confirm `canceled` stops new cases while `past_due` does not, because a home
locked out of Thursday's funeral over an expired card would be a disgrace.

**7. Walk `LAUNCH.md`'s "Before the first pilot home" list** and make every line
true, then update the file to say so. Keep its honesty — it is the most useful
document in this repository precisely because it says what has not been done.

## Constraints

- **`db push` is not a migration tool.** `DEPLOY.md` has the caution; read it
  before you point anything at a database with real families in it.
- Neither Postgres nor the API is published. The only way in is through one of
  the two nginx containers, which is what keeps the session cookie same-origin.
  Do not "simplify" that.
- One API instance and one Postgres is fine for a pilot and not fine at fifty
  homes. Do not over-build now; do write down what has to change and when.
- Uploads currently live in Postgres — encrypted and correct, and the wrong
  long-term home for gigabytes of photographs. Same treatment: note the
  threshold, do not migrate today.
- Everything you automate must be re-runnable. A deployment that works once,
  by hand, at 2am, is not a deployment.

## Done when

The stack is running on a real host with real TLS and a real domain, a password
reset email actually arrives, the aftercare job has run against real data in
dry-run and been seen to pick the right rows, a backup has been taken to
somewhere off that host and restored from, something pages a human when it
breaks, and `DEPLOY.md` and `LAUNCH.md` both tell the truth about all of it.

Then one real funeral home can be put on it, which is the point.
