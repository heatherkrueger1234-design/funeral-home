# Putting this on a host

Four containers: Postgres, the API, and one nginx per front end. A fifth,
`tools`, is not a server — it is where migrations, backups and restores run.

**What has actually been verified, and what has not**, because the difference
matters at 3am:

| Verified how | What |
| --- | --- |
| Run, for real | The production esbuild bundle: registration, a case, a family link, a genuine iPhone HEIC uploaded and served back as JPEG, twelve photos zipped into a slideshow pack — all of it through this exact `nginx.conf`, with `nginx -t` passing on the expanded template. |
| Run, for real | `pnpm deploy --prod --legacy` produces a tree where `sharp`, `heic-decode` and `nodemailer` resolve and `esbuild`, `vitest` and `supertest` do not. |
| Run, for real | `docker build` for all four images, then `docker compose up`: four containers healthy, migrations applied through `tools`, a home registered and a real iPhone HEIC uploaded and served back through nginx. A full `docker compose restart` left the photograph byte-for-byte identical. |
| Run, for real | **TLS in front, end to end.** Caddy terminating HTTPS, proxying to nginx, nginx to the API. A director signs in over HTTPS and the `Secure` session cookie makes the round trip; an authenticated request succeeds; the plain-HTTP warning stays silent. The same sign-in over plain HTTP was reproduced first, and does exactly what this file warns it does. |
| Run, for real | **Two proxy hops.** With `TRUST_PROXY_HOPS=2`, twenty-five sign-in attempts each claiming a different `X-Forwarded-For` all shared one rate-limit bucket and got a 429 — the spoof is ignored and the real client is still identified. |
| Run, for real | **A password reset, delivered.** Real SMTP conversation, message received, link opened over HTTPS, new password set, old password rejected, token refused on reuse. |
| Run, for real | **Aftercare picks the right rows.** Seven enrolments — due, pending consent, unsubscribed, not yet due, already sent, already failed — and `?dryRun=1` reported exactly the two that were genuinely due, wrote nothing and sent nothing. A real run then delivered exactly those two, with the right message for each offset, and a second run was a clean no-op. Unauthenticated and wrong-secret callers got 401. |
| Run, for real | **A backup off the host, and a restore from it.** Dump shipped to S3-compatible object storage over the network, size read back and compared; every local copy then deleted; the dump pulled back and restored. The encrypted photograph came back byte-identical and every table matched. |
| Run, for real | **Monitoring that pages.** A webhook received the page when the database was stopped, when the newest backup went stale, and when aftercare stopped running — and no heartbeat was sent on a failed run, so the dead-man's switch fires too. |
| Run, for real | **The Stripe subscription lifecycle**, driven through the real webhook endpoint with genuine HMAC signatures: trialing → active → past_due → unpaid → active → canceled. `canceled` returns 402 on a new case; `past_due` opens one. Forged and replayed signatures were refused. |
| Run, for real | **Preflight refuses on the preconditions that are invisible at `up` time.** Clock skew measured against Let's Encrypt's own server; free disk compared against the live database size; and a real listener bound on :80 and fetched back, confirming loopback first so a busy port is never reported as a firewall. Exercised on a host with neither `ss` nor `netstat`, which is the fallback path that previously claimed :80 was clear when it had not looked. |
| Run, for real | **Both Let's Encrypt directory endpoints answer**, so the staging URL this file tells you to set `ACME_CA` to is current and correct. That is the whole of what can be checked about issuance without a domain. |
| Run, for real | **The monitor's new failures fire, and suppress the heartbeat.** Missing offsite configuration pages; `docker compose ps` returning nothing is now a problem rather than "no unhealthy containers", which is what it was reading as on a host where nothing was running. |
| Partly run | **The certificate-expiry and offsite-staleness checks in `monitor.sh` have run, but only down their unconfigured branches** — there is no TLS listener and no rclone remote on the machine this was written on. The arithmetic and the thresholds are untested against a real certificate and a real bucket. First real exercise is steps 12 and 13 of `LAUNCH.md`. |
| **Not run** | **No public host, no public domain, no publicly-trusted certificate.** All of the above was proven on an ephemeral machine, with Caddy signing its own certificates and the domains in `/etc/hosts`. That exercises the proxy wiring, which is the half that fails quietly. It does **not** prove DNS resolves, that port 80 is reachable from the internet, or that Let's Encrypt will issue. See *Rehearse, then go live*. |
| **Not run** | **No real mail provider.** The SMTP conversation was real; the server on the other end was a local one, not Gmail or Postmark. Sending limits, SPF/DKIM/DMARC alignment and whether a grieving family's mail client files it as spam are all untested. |
| **Not run** | **No real Stripe account.** The events were signed with a test secret and shaped like Stripe's. No card has ever been charged, and no checkout page has been opened. |
| **Not run** | **No real family has ever used the family portal.** |

All four of those are blocked on a credential or a card, not on work. What each
one needs, what it costs and who has to sign for it is in `LAUNCH.md` under
*What I need from Heather*; the ordered path to close them is the runbook above
it. **`LAUNCH.md` is the single go-live sequence — this file explains the
pieces, that one is the order you touch them in.**

## Before anything else

```sh
cp .env.example .env
```

Then fill in the four the stack refuses to start without: `POSTGRES_PASSWORD`,
`ENCRYPTION_KEY`, `FAMILY_PORTAL_URL`, `CONSOLE_URL`.

Generate the key with:

```sh
pnpm --filter @workspace/scripts run generate-encryption-key
```

**`ENCRYPTION_KEY` is the one that cannot be recovered.** Every uploaded file
and every social security number in the database and in every backup is
AES-256-GCM under it. Lose it and the photographs are gone — the ciphertext is
still there and is worth nothing. Changing it does not re-encrypt anything;
existing files simply stop opening. Keep a copy somewhere that is neither this
host nor the backup.

Generate it on a machine you control, once. Not in a shared session, not in a
chat window: anything with history is somewhere it has been published.

**`SECRETS.md` is the full list** — every secret this deployment needs, where
it goes, what breaks without it, and what it costs to lose it.

## Mail

Without SMTP, password resets, aftercare and intake alerts are written to the
API log instead of sent. In practice that means a director who forgets their
password cannot get back in without somebody reading a server log, which is
not a support process.

`SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` are what switch it on — the transport
is plain SMTP and not tied to a provider, so Gmail with an app password works
today and moving to Postmark or Fastmail later is a settings change. Port 465
is treated as implicit TLS and 587 as STARTTLS.

`SMTP_FROM` is what a grieving family sees as the sender. Use an address that
belongs to the funeral home, not to this software.

Check it with `GET /api/healthz`, which reports `"mail": true` once a
transport is configured, then actually send one:

```sh
curl -X POST https://console.example.com/api/auth/forgot-password \
     -H 'Content-Type: application/json' -d '{"email":"you@example.com"}'
```

It answers 202 whether or not the address exists, on purpose. Watch the
inbox, and click the link — it should open the console over HTTPS, take a new
password, and refuse to work a second time.

One thing this has never been tested against is a real provider, so before a
pilot: set SPF, DKIM and DMARC on the sending domain, and send one to a Gmail
address and one to an Outlook address and confirm neither lands in spam. Mail
from a new domain about a death is exactly the shape of thing filters dislike.

## Bring it up

Check first. `deploy/preflight.sh` changes nothing, is safe to re-run, and
refuses to pass on the preconditions that are invisible at `up` time and
expensive afterwards — an env file missing one of the four required values,
DNS that does not point at this host yet, a clock far enough out that a
freshly-issued certificate will not validate, a disk without room to take a
dump, and port 80 held by something else:

```sh
./deploy/preflight.sh
```

The DNS one matters more than it looks. Let's Encrypt proves you control a
domain by connecting back to it, and allows five failures per hostname per
hour; a typo discovered at `up` time locks you out for the rest of the hour.

```sh
# Schema first — the API will start without the tables but every screen 500s.
docker compose run --rm tools pnpm --filter @workspace/db run push

# The 33,791 ZIP centroids that make "cemeteries near me" work. Skip it and
# proximity search returns nothing rather than erroring.
docker compose run --rm tools pnpm --filter @workspace/scripts run load-postal-codes

docker compose up -d
docker compose ps          # all four should report healthy
```

The family portal lands on `FAMILY_PORTAL_PORT` (8080), the director console
on `CONSOLE_PORT` (8081). Neither Postgres nor the API is published: the only
way in is through one of the two nginx containers, which is what keeps the
session cookie same-origin.

`pnpm install` will print `Ignored build scripts: sharp@0.34.5` during the
build. That is expected and not a problem — sharp 0.34 ships its native code
as platform-specific packages rather than through an install script, and it
was confirmed decoding a real iPhone HEIC inside the built container.

### Keep the Postgres client in step with the server

The `tools` image installs `postgresql-client-16` from PGDG to match the
`postgres:16` in `docker-compose.yml`. If you move the database to a different
major version, change **both** — `PG_MAJOR` is a build arg for exactly this.

Getting it wrong fails in two different ways, and the second is the dangerous
one. A client older than the server refuses to dump at all, which is loud. A
client *newer* than the server dumps happily and produces a file that will not
restore, because it writes settings the older server does not recognise — a
backup that looks fine until the morning you need it. Both were observed while
building this image; neither was visible from the host, where the versions
happened to match.

## You must terminate TLS in front of this

Not a recommendation. In production the session cookie is always marked
`Secure`, because this holds death certificates and social security numbers
and a cookie that will also travel over plain HTTP is not a trade worth
making. A browser accepts a `Secure` cookie over plain HTTP and then never
sends it back — so over plain HTTP a director signs in, lands back on the
sign-in page, and nothing appears to be wrong.

The server says so when it happens. Look for this in the API log:

```
Issued a Secure session cookie over a connection this server sees as plain
HTTP, so the browser will accept it and never send it back
```

There is a compose overlay that does the whole thing:

```sh
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d
```

It adds Caddy on 80 and 443, moves both front ends to loopback-only bindings,
and sets `TRUST_PROXY_HOPS=2`. Caddy obtains and renews certificates from
Let's Encrypt on its own, which matters more than it sounds: a certificate
that quietly failed to renew is one of the two ways a deployment like this
dies on a Sunday. It needs `FAMILY_DOMAIN`, `CONSOLE_DOMAIN` and `ACME_EMAIL`
in `.env`, and **both domains must already resolve to this host** before you
bring it up — Let's Encrypt proves you control them by connecting back on
port 80. DNS first, then `up`.

### Rehearse, then go live

The proxy wiring is the half that fails quietly, and it can be proven before
DNS exists:

```sh
docker compose -f docker-compose.yml -f docker-compose.tls.yml \
               -f docker-compose.tls-internal.yml up -d
# then, in /etc/hosts:
#   127.0.0.1 family.staging.localhost console.staging.localhost
```

Caddy signs its own certificates. Sign in, and confirm you stay signed in —
that is the whole test, and it catches every proxy-header mistake. What it
cannot tell you is whether issuance will work, so when you point a real
domain at a real host, set `ACME_CA` to
`https://acme-staging-v02.api.letsencrypt.org/directory` for the first run.
The certificate will be untrusted, which is the point: Let's Encrypt allows
five failures per hostname per hour in production and you do not want to
discover a DNS typo by being locked out for the rest of the hour. Unset it
once a staging certificate issues cleanly.

### If something else terminates TLS

Whatever it is — a load balancer, another nginx, a tunnel — it must set
`X-Forwarded-Proto`. The nginx in this repo forwards an inbound one through
rather than overwriting it with its own scheme; it did not always, and the
symptom was exactly the silent sign-in failure above.

Then count your hops and set `TRUST_PROXY_HOPS` to match. Both `req.secure`
and the rate limiter's idea of the client address are read that many entries
from the right of `X-Forwarded-For`:

- **too low** — the limiter counts the innermost proxy as the client, so every
  family shares one bucket and one family's retries throttle everybody;
- **too high** — a client can spoof its own address and take somebody else's
  rate budget.

One for `docker-compose.yml` alone. Two with `docker-compose.tls.yml`. Three
if you put a CDN in front of that.

## Scheduled work

Three cron lines and one repository secret. Every one of these is
re-runnable: running any of them twice in a row is harmless.

```sh
# Aftercare, 14:00 UTC. Mid-morning across the US rather than 3am, which is a
# bad time to receive a message about somebody who died.
0 14 * * *  docker compose -f /srv/funeral-home/docker-compose.yml \
              run --rm tools pnpm --filter @workspace/scripts run send-aftercare

# Backup, and get it off this host in the same job. See below.
30 3 * * *  BACKUP_REMOTE=... RCLONE_CONFIG=/srv/funeral-home/rclone.conf \
              /srv/funeral-home/deploy/backup-offsite.sh >> /var/log/fh-backup.log 2>&1

# The checks that page a human.
30 *  * * *  ALERT_WEBHOOK=... HEARTBEAT_URL=... \
              /srv/funeral-home/deploy/monitor.sh >> /var/log/fh-monitor.log 2>&1
```

`.github/workflows/aftercare.yml` is the alternative to that first line if you
would rather GitHub ran it: it posts to `/api/tasks/aftercare` daily and needs
`API_URL` and `TASK_SECRET` as repository secrets, matching the server's.
**Without `TASK_SECRET` set on the server the endpoint refuses every caller**,
which is deliberate — an unauthenticated endpoint that sends email to the
bereaved is not a thing to leave open — and the visible symptom is that
aftercare silently never runs.

Check the wiring with `?dryRun=1` before anything writes to a real family:

```sh
curl -X POST "https://console.example.com/api/tasks/aftercare?dryRun=1" \
     -H "Authorization: Bearer $TASK_SECRET"
# {"due":2,"sent":0,"failed":0,"skipped":2,"dryRun":true,"mailConfigured":true}
```

`due` is how many check-ins are genuinely owed. Nothing is written and nothing
is sent. If `mailConfigured` is `false`, fix SMTP before you drop the
`dryRun`, or the run will mark deliveries against mail that never left.

## Backups, and getting them off this host

`backup-database` writes into the `backups` volume, which is on the same disk
as the database it is protecting. That is not a backup: it survives somebody
dropping a table and none of the failures that actually lose a funeral home's
photographs — the disk, the host, the provider account, the ransomware that
encrypts every path the machine can write to.

`deploy/backup-offsite.sh` takes a dump, copies it somewhere else, and then
**reads back the size of what it wrote** before reporting success. That last
step is the point: a copy job that trusts its own exit code is how a home ends
up with a year of empty files and finds out on the worst possible morning.

It needs two things in the environment and holds no credentials itself:

```sh
BACKUP_REMOTE=b2:krueger-backups/db      # any rclone remote
RCLONE_CONFIG=/srv/funeral-home/rclone.conf
```

rclone rather than the AWS CLI so the same script works against S3, Backblaze
B2, Wasabi, Cloudflare R2 or a machine in the funeral home's own office — a
small home should not need an AWS account to have an offsite backup. Scope the
credential to the one bucket, and turn on the provider's object-lock or
versioning: a key that can delete is a key that ransomware can use.

It copies rather than syncs, deliberately. A sync would mirror local deletions
to the remote, so the 30-day local retention would silently cap the offsite
copy at 30 days too.

### Prove the restore works before you need it

A backup nobody has restored is a belief, not a backup.
`scripts/src/verify-backup.ts` restores the newest dump into a scratch
database, compares every table's row count against the live database, and then
compares a digest of the **encrypted photograph and SSN bytes** on both sides.

That last part is not decoration. Row counts are exactly what a corrupted
backup preserves: a bytea escaped one way and restored another, or a
`pg_dump` newer than its server, produces a dump where every count matches and
every photograph is ruined. This check was added after the drill was found to
be comparing only counts while this file claimed otherwise, and it was
confirmed to fail on a single flipped byte.

It refuses to run when `VERIFY_DATABASE_URL` equals `DATABASE_URL`, and treats
zero rows restored as a failure rather than a clean empty database.

```sh
docker compose run --rm \
  -e VERIFY_DATABASE_URL=postgres://funeral:...@db:5432/restore_drill \
  tools pnpm --filter @workspace/scripts run verify-backup
```

**Restore from the offsite copy, not the local one**, at least once, so you
have done the thing you will actually have to do:

```sh
docker run --rm -v funeral-home_backups:/backups \
  -v /srv/funeral-home/rclone.conf:/config/rclone/rclone.conf:ro \
  rclone/rclone:1 copy "$BACKUP_REMOTE" /backups --include 'holding-today-*.sql'
```

`.github/workflows/backup-drill.yml` runs the verification weekly and on any
change to the schema or the backup scripts, so the drill fails in CI rather
than in an emergency.

## Monitoring

Three legs, and the reason there are three is that each one is blind to a
failure the others catch.

1. **`deploy/monitor.sh`, on the host.** Containers, the API and its database,
   disk, backup freshness both locally and at the remote, the certificate this
   host is actually serving, and whether aftercare has run. It pages
   `ALERT_WEBHOOK` — any URL taking a JSON POST: Slack, PagerDuty Events v2,
   ntfy, Discord. It **refuses to start** without one rather than pretend to be
   monitoring.

   Local and offsite backup freshness are separate checks on purpose.
   `backup-offsite.sh` takes the dump first and copies it second, so an expired
   key or a renamed bucket leaves the local dump fresh and reassuring every
   night while the only copy that survives this host dying goes stale. Asking
   the volume is not asking the remote.

2. **A dead-man's switch off the host.** `monitor.sh` pings `HEARTBEAT_URL` on
   every clean run, and only on a clean run. A monitor cannot report the host
   it runs on being down — it dies with it, and the silence looks exactly like
   health. Something external has to notice the ping *stopping*.
   healthchecks.io, Better Stack or Cronitor; the free tier is enough for one
   deployment. Set the grace period to about twice the cron interval.

   All three of the failures with no symptoms — a certificate that stopped
   renewing, a backup that stopped leaving this host, aftercare that stopped
   going out — are wired to this. Each one suppresses the heartbeat as well as
   sending the page, which is what covers the case where the webhook itself is
   what is broken.

3. **`.github/workflows/uptime.yml`, from outside.** Every fifteen minutes it
   asks whether both front ends answer, whether the API answers, and how many
   days are left on each certificate. Needs `FAMILY_DOMAIN` and
   `CONSOLE_DOMAIN` as repository *variables*, and optionally `ALERT_WEBHOOK`
   as a secret.

The check worth understanding is aftercare. Nothing breaks when it stops: no
error, no 500, no unhappy director. The check-ins simply stop going out, and
the thing the home is paying for is not happening. That is why it is a
monitored condition and not a dashboard panel.

## A caution about `db push`

`drizzle-kit push` diffs the schema and applies the difference. It is the
right tool for getting started and the wrong one for a database with a home's
cases in it: a renamed column reads as a drop plus an add, and the drop takes
the data with it. Before running it against anything real, take a backup
first, and read what it proposes — it prints the statements and asks.

## Building the images by hand

```sh
docker build -t fh-api .
docker build -t fh-tools --target tools .
docker build -f Dockerfile.web --build-arg APP=family-portal    -t fh-family  .
docker build -f Dockerfile.web --build-arg APP=director-console -t fh-console .
```

`Dockerfile.web` is one file for both front ends because they are the same
build — a Vite SPA that calls `/api` on its own origin. The nginx config is a
template expanded at container start; override `NGINX_API_ORIGIN` to point at
an API somewhere else, and `NGINX_RESOLVER` if you are not on Docker's
embedded DNS (on Kubernetes, the cluster DNS service address).

## Running the test suite in the `tools` container

It works, with two things to know, both of which look like the application is
broken and are not:

- **`NODE_ENV` must be set to `test`.** The image sets `NODE_ENV=production`,
  and `test/setup.ts` only defaults it with `??=`, so it stays "production" —
  which makes the session cookie `Secure`, which supertest will not send back
  over its plain-HTTP loopback. The symptom is over a hundred tests failing
  with 401 and nothing obviously wrong.
- **One test needs `unzip`,** which the image does not carry. CI runners do.

```sh
docker compose run --rm -e NODE_ENV=test \
  -e DATABASE_URL=postgres://funeral:...@db:5432/funeral_home_test \
  tools pnpm run test
```

## Health checks

- `GET /healthz` on either web container — nginx is serving files. Deliberately
  not proxied: that is a different question from whether the API is up, and
  conflating them takes both out at once.
- `GET /api/healthz` — the API *and* its database. Returns 503 when Postgres is
  unreachable, because a process that is listening but cannot reach Postgres
  serves an error on every screen, and calling that healthy keeps it in the
  load balancer. Mail and SMS are reported but never fail the check: a home
  without Twilio is degraded, not down.

## What this is not

One Postgres, one API, no replication, no object storage. That is honestly
sized for a pilot with a handful of homes on it.

What has to change, and the point at which it does:

| Change | When |
| --- | --- |
| **Move uploads out of Postgres into object storage.** They are encrypted and correct where they are, and they are also the reason the database and every dump grow without limit. | When a home's dump gets uncomfortable to move around — call it 20 GB, or when `backup-offsite.sh` starts taking longer than the gap between runs. |
| **A second API container.** Needs nothing changed: sessions live in the database, not in memory. | When one machine's downtime is somebody's Thursday funeral. Realistically, the first home who cannot be rung up personally. |
| **Managed Postgres with point-in-time recovery.** Nightly dumps mean the worst case is losing a day of a family's writing. | Same point as above. This is the bigger of the two. |
| **A shared rate limiter.** The in-process one does not survive a restart and does not see a second instance. The public front door already has database-backed hourly ceilings behind it, so this is about fairness rather than safety. | The moment there is a second API container. |

None of these is worth doing today, and all of them are worth knowing about
before the tenth home rather than after it.
