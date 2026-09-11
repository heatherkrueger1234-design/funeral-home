# Launch readiness

An honest assessment, written against what has actually been run rather than
what is supposed to work. Dated at the last commit on
`claude/funeral-home-portal-uj9bik`.

## The one-line answer

**Ready for a supervised pilot with a handful of funeral homes. Not ready to
sell unattended.** The product works end to end and the data is safe; what is
missing is operational — no deployment has ever been built, and no real family
has ever used it.

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

163 tests, 4 projects typechecking, 3 apps building.

## What is not ready

| Gap | Severity | What it would take |
| --- | --- | --- |
| **The container images have never been built or run.** No Docker daemon on the machine they were written on. | **Blocking** | Build them once on a real host. Expect to fix something. |
| **No production deployment exists.** Nothing is running anywhere. | **Blocking** | A host, a domain, TLS, a Postgres. Half a day. |
| **No real family has ever used the family portal.** Every test is synthetic. | **High** | One pilot home, one real case, watch what happens. |
| **Email and SMS are unconfigured.** Password resets, aftercare and intake alerts are written to the log instead of sent. | **High** | SMTP credentials and a Twilio number. |
| **Stripe has never taken a real payment.** The webhook signature check is tested; a live charge is not. | **High** | Test-mode keys, one real subscription cycle. |
| **One API instance, one Postgres, no replication.** | Medium | Fine for a pilot. Not fine at fifty homes. |
| **Uploads live in Postgres.** Encrypted, correct, and the wrong long-term home for gigabytes of photographs. | Medium | Object storage, when a home's database gets uncomfortable. |
| **Backups land on the same host** until somebody copies them off. | Medium | An offsite copy job. `DEPLOY.md` has the command. |
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

1. Build the images and bring the stack up. **Terminate TLS** — the session
   cookie is `Secure` in production and the server logs a specific warning if
   it is issued over plain HTTP.
2. `pnpm --filter @workspace/db run push`, then load the ZIP centroids.
3. Configure SMTP. Without it, a director who forgets their password cannot
   reset it without someone reading the server log.
4. Set `TASK_SECRET` and schedule the aftercare job. It is the feature the
   subscription is really for, and it does nothing until something triggers it.
5. Take one backup, then run `verify-backup` and watch it restore.
6. Generate `ENCRYPTION_KEY` and **put a copy somewhere that is not the host
   and not the backup.** Losing it loses every photograph.
7. Put the home's public page URL on their website, from Settings.

## Before selling to homes you cannot ring

- A second API instance and a managed Postgres with point-in-time recovery.
- Offsite backups, automatically.
- Uptime monitoring that pages a human, not a dashboard nobody opens.
- A support route that is not "email the developer".
- A written incident plan for the case that matters: the encryption key is
  compromised, or lost.
