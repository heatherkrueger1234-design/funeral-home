# Launch readiness

An honest assessment, written against what has actually been run rather than
what is supposed to work.

A tick here means somebody executed it and watched the result, not that the
code looks right. Where something was rehearsed rather than done for real —
TLS against a self-signed certificate, SMTP against a local mail server — it
says so, because the gap between those two is where this kind of document
usually starts lying.

## The one-line answer

**Ready for a supervised pilot with a handful of funeral homes. Not ready to
sell unattended.** The product works end to end, the data is safe, the stack
builds and runs in containers, and the deployment around it — TLS, mail, the
scheduled jobs, offsite backups, monitoring, the billing lifecycle — has now
been exercised rather than assumed. Doing that found three failures that would
each have hit the first pilot home; they are fixed.

What is still missing is the part no rehearsal substitutes for: **it has never
run on a public host with a public domain, no real mail provider has ever
carried one of these messages, no card has ever been charged, and no real
family has ever opened the family portal.**

## What has been proven by running it

Not by tests alone — these were executed against a real PostgreSQL with the
production esbuild bundle, through the real nginx config:

- A home registers, opens a case, invites a family, and the family uploads a
  genuine iPhone HEIC that comes back as a JPEG (383,240 bytes).
- Twelve photographs stream out as an uncorrupted slideshow zip.
- A family who has never been sent a link asks a home to open one, and a
  director accepts it; a second director accepting the same request gets a 409
  and no second case appears.
- Someone arranging their own funeral fills in a pre-need file, closes it, and
  is **not** enrolled in grief check-ins. Years later the home records the
  death and the obituary and photographs are still there, with the funeral
  schedule now built.
- `pg_dump` → `DROP DATABASE` → restore, with an encrypted photograph matching
  byte-for-byte and an encrypted SSN decrypting afterwards.
- A case exports as a folder that opens without this software, and exports
  **after the home has cancelled**.
- A case erases for real: the encrypted photo bytes are gone from `uploads`,
  not merely unreferenced.
- **All four container images build**, the stack comes up with every container
  healthy, migrations apply through the `tools` container, a family uploads a
  real HEIC through nginx into the API container, and a backup taken inside the
  containers restores and verifies. A full restart leaves the photograph
  byte-for-byte identical.

And, with a TLS terminator actually in front of it:

- **A director signs in over HTTPS and stays signed in.** The same sign-in over
  plain HTTP was reproduced first and fails exactly the way it was documented
  to: the browser takes the `Secure` cookie and never sends it back. Getting
  that to work needed a fix — the nginx here was overwriting the
  `X-Forwarded-Proto` that anything in front of it sets, so the documented
  deployment silently broke sign-in.
- **A password reset arrives and the link works.** Real SMTP, message received,
  new password set, old one rejected, token refused on reuse.
- **Aftercare picks the right rows.** Seven enrolments — due, awaiting consent,
  unsubscribed, not yet due, already sent, already failed — and the dry run
  named exactly the two that were owed, wrote nothing, sent nothing. The real
  run then delivered exactly those two and the rerun was a no-op.
- **A backup went off the host and was restored from.** Every local copy was
  deleted first. The encrypted photograph came back byte-identical.
- **Something pages a human.** Confirmed by stopping the database, by letting
  the backup go stale, and by stopping aftercare — and a failed run sends no
  heartbeat, so the dead-man's switch fires too.
- **The whole subscription lifecycle**, through the real webhook with real
  signatures: `canceled` stops new cases, `past_due` does not. This needed a
  fix too — the webhook was mounted where the body had already been parsed, so
  it could never have verified a single genuine Stripe event.

163 tests, 4 projects typechecking, 3 apps building.

## What is not ready

| Gap | Severity | What it would take |
| --- | --- | --- |
| ~~The container images have never been built or run.~~ **Done.** | Cleared | — |
| ~~Nothing has ever run behind TLS.~~ **Done, on a rehearsal host.** Caddy in front, `Secure` cookie round-tripping, two proxy hops counted correctly. Three real bugs found and fixed doing it. | Cleared | — |
| ~~Email is unconfigured and untested.~~ **Done.** A real password reset was sent, received and clicked. | Cleared | — |
| ~~The aftercare job has never run.~~ **Done.** Dry run picks exactly the right rows; the real run delivers them and is idempotent. | Cleared | — |
| ~~Backups land on the same host.~~ **Done.** `deploy/backup-offsite.sh` copies them off and verifies what it wrote; a restore was performed from the offsite copy with every local copy deleted first. | Cleared | — |
| ~~Nothing pages a human.~~ **Done.** `deploy/monitor.sh` plus a dead-man's switch plus an off-host uptime workflow. Proven by breaking three different things. | Cleared | — |
| ~~Stripe has never been through a cycle.~~ **Done in test mode.** The full lifecycle through the real webhook; `canceled` stops new cases, `past_due` does not. | Cleared | — |
| **No production deployment exists.** Everything above was proven on an ephemeral machine with self-signed certificates and hostnames in `/etc/hosts`. There is still no host, no domain, and no publicly-trusted certificate. | **Blocking** | A host, a domain, DNS, and `docker compose -f docker-compose.yml -f docker-compose.tls.yml up`. Half a day, and the hard parts are already rehearsed. |
| **No real family has ever used the family portal.** Every test is synthetic. | **High** | One pilot home, one real case, watch what happens. |
| **No mail has ever gone through a real provider.** The SMTP conversation was real; the server was local. Deliverability — SPF, DKIM, DMARC, and whether a grieving family's inbox files a message about a death as spam — is entirely untested. | **High** | A provider account, the three DNS records, and one test to Gmail and one to Outlook. |
| **No card has ever been charged.** The webhook and the gating are proven; Stripe's own checkout page has never been opened. | **High** | Test-mode keys and one real checkout, then live keys. |
| **SMS is unconfigured.** Directors copy the family link by hand. | Medium | A Twilio number. Degraded, not down. |
| **One API instance, one Postgres, no replication.** | Medium | Fine for a pilot. Not fine at fifty homes — `DEPLOY.md` now says at what point each piece has to change. |
| **Uploads live in Postgres.** Encrypted, correct, and the wrong long-term home for gigabytes of photographs. | Medium | Object storage, at roughly 20 GB per home. |
| **`ENCRYPTION_KEY` cannot be rotated.** There is no procedure, and no plan for the day it is exposed. | Medium | Written before it is needed, not after. `SECRETS.md` says plainly that this is missing. |
| **The in-memory rate limiter does not survive a restart or a second instance.** | Low | The public front door already has database-backed hourly ceilings behind it; the rest would want Redis at scale. |
| **No load test.** A home uploading 1000 photographs at once is untried. | Low | The zip ceiling is now checked before streaming, which was the sharp edge. |

## Decisions that look like gaps and are not

These were chosen, and the reasoning is in the code next to them:

- **No price list, no invoices, no contracts.** The FTC Funeral Rule governs
  how prices are disclosed, and every state's pre-need statute differs. A
  national SaaS generating that paperwork would be selling homes a compliance
  problem. This holds the collaboration with the family; the home's own systems
  hold the sale.
- **No automatic deletion of case data, ever.** Retention is set by state law
  and by the home's insurer. A default that purged at 36 months would destroy
  records a home is obliged to keep. See `RETENTION.md`.
- **The vendor directory ships empty.** Inventing plausible headstone
  companies and telephone numbers would produce numbers a grieving family
  would actually dial.
- **The hymn and poem library ships empty.** Shipping verbatim published text
  is a copyright problem the homes would inherit.
- **Office hours are shown, never enforced.** A 2am message is delivered at
  2am; the family is told when it will be read and given the 24-hour number.
  Silently holding it would be worse than the midnight text this replaces.

## Before the first pilot home

Every line here is now either done, or a thing only a real host can finish.
Ticks mean *rehearsed and working*; the unticked ones need the host.

1. ~~Build the images and bring the stack up.~~ **Done.** All four build and
   the stack comes up healthy.
2. **Terminate TLS.** The mechanism is done and rehearsed —
   `docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d`, with
   Caddy taking care of Let's Encrypt. **Still needs a real domain pointed at a
   real host.** Rehearse with `docker-compose.tls-internal.yml` first, and use
   Let's Encrypt's staging CA for the first real run.
3. ~~`db push`, then load the ZIP centroids.~~ **Done**, through the `tools`
   container. 33,791 postal codes loaded.
4. **Configure SMTP.** Done as a mechanism and proven end to end against a real
   SMTP server. **Still needs a provider account and SPF/DKIM/DMARC on the
   sending domain** — and one test message each to Gmail and Outlook, because
   mail about a death from a new domain is what spam filters are built to
   catch.
5. ~~Set `TASK_SECRET` and schedule the aftercare job.~~ **Done.** The endpoint
   refuses unauthenticated callers, the dry run picks exactly the right rows,
   the real run sends them and is idempotent. Cron lines are in `DEPLOY.md`.
   Set the secret on the host and as a repository secret, matching.
6. ~~Take one backup, then run `verify-backup` and watch it restore.~~ **Done**,
   including from an offsite copy with every local copy deleted first. The
   verification now compares the encrypted bytes and not just the row counts —
   it was only comparing counts, while claiming otherwise.
7. **Generate `ENCRYPTION_KEY` and put a copy somewhere that is not the host and
   not the backup.** Not done and deliberately not done here: it is generated
   once, by Heather, on a machine that is not a shared session. `SECRETS.md`
   has the procedure and what losing it costs.
8. ~~Set up monitoring that pages a human.~~ **Done.** `deploy/monitor.sh`, a
   dead-man's switch, and `.github/workflows/uptime.yml`. Needs an
   `ALERT_WEBHOOK` that reaches a person and a `HEARTBEAT_URL`. Proven by
   breaking the database, the backup and the aftercare schedule in turn.
9. **Put the home's public page URL on their website**, from Settings.
10. **Open one real case with one real family, and watch.**

## Before selling to homes you cannot ring

- A second API instance and a managed Postgres with point-in-time recovery.
  `DEPLOY.md` says what each costs and when it stops being optional.
- ~~Offsite backups, automatically.~~ Done — `deploy/backup-offsite.sh`.
- ~~Uptime monitoring that pages a human, not a dashboard nobody opens.~~ Done,
  in three legs, because each one is blind to something the others catch.
- A support route that is not "email the developer".
- **A written incident plan for the case that matters: the encryption key is
  compromised, or lost.** Still the largest unwritten thing here. There is no
  key-rotation path at all, which means an exposure is retroactive across every
  backup ever taken and the honest answer today is "get help and tell the
  homes". That needs to be written down while nobody is panicking.
- Deliverability monitoring. A mail provider that starts silently dropping
  aftercare is indistinguishable, from inside, from a quiet month.
