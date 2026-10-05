# Putting this on a host

Caddy for TLS, Postgres, the API, and one nginx per front end. One more,
`tools`, is not a server — it is where migrations, backups and restores run.

**What has actually been verified, and what has not**, because the difference
matters at 3am:

| Verified how | What |
| --- | --- |
| Run, for real | The production esbuild bundle: registration, a case, a family link, a genuine iPhone HEIC uploaded and served back as JPEG, twelve photos zipped into a slideshow pack — all of it through this exact `nginx.conf`, with `nginx -t` passing on the expanded template. |
| Run, for real | `pnpm deploy --prod --legacy` produces a tree where `sharp`, `heic-decode` and `nodemailer` resolve and `esbuild`, `vitest` and `supertest` do not. |
| Run, for real | `backup-database` → `DROP DATABASE` → `restore-database`, with an encrypted photo matching byte-for-byte and an encrypted SSN decrypting afterwards (`pnpm --filter @workspace/scripts run verify-backup`). |
| Run, for real | `backup-database` with `BACKUP_OFFSITE` set: the encrypted dump copied with rclone and its size checked on the far side, the local copy deleted, the far copy fetched back and restored with every table matching (5 Oct 2026, against a directory standing in for the bucket; the weekly drill does the same). An unreachable destination fails the run. The tools image's `apt` step was built on `node:24-bookworm-slim` and gives `pg_dump` 16.15 and rclone 1.60.1. |
| Run, for real | `docker build` for all four images, then `docker compose up`: four containers healthy, migrations applied through `tools`, a home registered and a real iPhone HEIC uploaded and served back through nginx, and a backup taken and restored inside the containers. A full `docker compose restart` left the photograph byte-for-byte identical. |
| Run, for real | Caddy → this `nginx.conf` → the API, with TLS from Caddy's own CA on `*.localhost`: HTTPS reaches the API as HTTPS, plain HTTP redirects, and one visitor exhausting the sign-in limit does not lock out another. The same test against the previous config locked both out. |
| Run, for real | `send-test-email` against an SMTP server on 587 with STARTTLS: delivered over TLS; a wrong password, a half-set config and an API key with no `SMTP_FROM` each fail with the reason; a server that refuses STARTTLS is refused rather than sent the password in clear. |
| **Not run** | A real Let's Encrypt certificate on a real domain, a real mail provider, a real Stripe key, or a real bucket for the backups. Those need your DNS and your accounts. |

## Before anything else

```sh
cp .env.example .env
```

Then fill in the ones the stack refuses to start without: `POSTGRES_PASSWORD`,
`ENCRYPTION_KEY`, `FAMILY_PORTAL_URL`, `CONSOLE_URL`, `ADMIN_CONSOLE_URL` and
`ACME_EMAIL`.

And point DNS at the host **before** the first `up`: an A record for each of
the five hostnames in those URLs — the three front ends, the bare domain and
www — and ports 80 and 443 open to the internet.

**No AAAA records**, unless you have given the compose network IPv6 of its
own (Docker's `enable_ipv6`, which needs IPv6 set up in the Docker daemon
first — Docker's "IPv6 networking" documentation). Without it, Docker's port
proxy accepts an IPv6 visitor and hands the connection to Caddy from one
internal IPv4 address, so every IPv6 visitor looks like the same person to
every rate limit: twenty mistyped passwords from anybody on IPv6 lock every
director on IPv6 out of signing in for fifteen minutes, and one family's
uploads count against every other's. With IPv6 really reaching the API, the
limits count each household's /64 as one caller. Caddy asks Let's Encrypt for the
certificates the first time each name is requested; if DNS is not there yet
it fails, retries with back-off, and Let's Encrypt starts rate-limiting after
a handful of failures.

Generate the key with:

```sh
pnpm --filter @workspace/scripts run generate-encryption-key
```

**`ENCRYPTION_KEY` is the one that cannot be recovered.** Every uploaded file
and every social security number in the database is AES-256-GCM under it, and
every backup file (`backup-database`'s `.sql.enc` output) is encrypted whole
under the same key — not just those two columns. Lose it and the photographs
are gone — the ciphertext is still there and is worth nothing. Changing it
does not re-encrypt anything; existing files simply stop opening, and no
existing backup will decrypt. Keep a copy somewhere that is neither this host
nor the backup.

## Bring it up

```sh
# Schema first — the API will start without the tables but every screen 500s.
docker compose run --rm tools pnpm --filter @workspace/db run push

# The 33,791 ZIP centroids that make "cemeteries near me" work. Skip it and
# proximity search returns nothing rather than erroring.
docker compose run --rm tools pnpm --filter @workspace/scripts run load-postal-codes

docker compose up -d
docker compose ps
docker compose logs -f caddy   # watch for "certificate obtained successfully"
```

Caddy is the only container published, on 80 and 443. Each app is at its own
URL from `.env`; nothing else is reachable. Not Postgres, not the API, not
the nginx containers, which is what keeps the session cookie same-origin and
the forwarded client address trustworthy.

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

## TLS

`docker compose up` terminates TLS itself: the `caddy` service gets a Let's
Encrypt certificate for each hostname and renews it, with no cron and no
certbot. `deploy/Caddyfile` explains what it needs (DNS and ports 80/443,
above). Certificates are kept in the `caddy-data` volume; leave it alone, or
you will be asking Let's Encrypt again and running into its limit of five
certificates a week for the same names.

It is not optional. In production the session cookie is always marked
`Secure`, because this holds death certificates and social security numbers.
Over plain HTTP a browser accepts that cookie and never sends it back, so a
director signs in and lands straight back on the sign-in page with nothing
to say why. The API logs this when it happens:

```
Issued a Secure session cookie over a connection this server sees as plain
HTTP, so the browser will accept it and never send it back
```

## Using your own load balancer instead of Caddy

A cloud load balancer, Cloudflare, or a proxy you already run can terminate
TLS instead. Remove the `caddy` service, publish the nginx containers' port
80 to wherever your proxy can reach them (and nowhere else), and check the
two things this stack depends on:

- **The proxy sets `X-Forwarded-Proto: https`.** nginx passes that through
  to the API; without it the API thinks every visitor is on plain HTTP and
  logs the warning above.
- **`TRUST_PROXY_HOPS` counts the proxies in front of the API**, nginx
  included. Caddy + nginx is 2, which is what compose sets. Behind Cloudflare
  *and* a load balancer *and* nginx it is 3. Too low and every visitor shares
  the proxy's address, so one person's failed sign-ins lock every director
  out. Too high and a visitor can pick the address the rate limiter sees by
  sending a header. The API refuses to start on anything but a whole number.

## Email

Password resets, staff invitations, aftercare check-ins and intake alerts all
go out over SMTP. Until it is set they are written to the API log. Any
provider that speaks SMTP works; these are the settings for the usual ones:

| Provider | `SMTP_HOST` | `SMTP_USER` | `SMTP_PASS` |
| --- | --- | --- | --- |
| Postmark | `smtp.postmarkapp.com` | Server API token | Server API token |
| Resend | `smtp.resend.com` | `resend` | API key |
| SendGrid | `smtp.sendgrid.net` | `apikey` | API key |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | SMTP username (not your AWS key) | SMTP password |
| Google Workspace | `smtp.gmail.com` | the full address | an [app password](https://support.google.com/accounts/answer/185833) |

`SMTP_PORT` is 587 for all of them. On 587 the mailer insists on STARTTLS,
so a connection with encryption stripped out fails rather than sending the
password in clear. Use 465 only if a provider requires implicit TLS.

For a pilot, a transactional provider (Postmark, Resend, SES) is the better
choice over Google Workspace: Workspace caps you at 2,000 messages a day and
treats a burst of password resets like spam.

**`SMTP_FROM`** is the platform's sender, e.g.
`Continuum Aftercare <care@yourdomain.com>`. It must be on a domain you have
verified with the provider, and with an API-key provider it is required,
because the username there is not an address. Aftercare check-ins keep its
address but swap in the home's own name (its "aftercare sender name", or the
home's name), and set Reply-To to the home's request inbox, falling back to
the owner, so a family who writes back reaches their director. Mail to staff
(resets, invitations, intake alerts) goes out as `SMTP_FROM` unchanged. With it missing, or with only
some of the four settings present, nothing is sent and the log names the
problem.

### Keep it out of spam

The provider will show you the exact records during domain verification; add
them at your DNS host. There are three kinds, and all three matter: Gmail
and Yahoo require SPF or DKIM from every sender and all three from anyone
sending in volume, and filter what arrives without them:

- **SPF**: one TXT record on the domain listing who may send for it, e.g.
  `v=spf1 include:spf.mtasv.net ~all` for Postmark. A domain can have only
  one SPF record; if you already send from Google Workspace, add the
  provider's `include:` to the existing one rather than adding a second.
- **DKIM**: one or more TXT or CNAME records the provider generates.
- **DMARC**: a TXT record at `_dmarc.yourdomain.com`. Start with
  `v=DMARC1; p=none; rua=mailto:you@yourdomain.com` and tighten to
  `p=quarantine` once reports show everything passing.

### Prove it works

```sh
docker compose run --rm tools pnpm --filter @workspace/scripts run send-test-email -- you@example.com
```

It connects, signs in and sends one message, and on any failure prints the
mail server's own reason and exits non-zero. Then check the message landed
in the inbox and not spam. `GET /api/healthz` reports `"mail": true` once
the settings are complete, but only this proves the provider accepts them.

## Scheduled work

Aftercare sends nothing unless something triggers it. Either the GitHub
workflow in `.github/workflows/aftercare.yml`, or a cron line on the host.
Run it **hourly**: each check-in falls due at mid-morning in the home's own
time zone, and the sender only sends between nine and seven there, so an
hourly run sends each one in the morning of the day it is about.

```sh
17 * * * *  docker compose -f /srv/funeral-home/docker-compose.yml \
              run --rm tools pnpm --filter @workspace/scripts run send-aftercare
```

Backups likewise. `BACKUP_DIR` inside the `tools` container is the `backups`
volume:

```sh
30 3 * * *  docker compose -f /srv/funeral-home/docker-compose.yml \
              run --rm tools pnpm --filter @workspace/scripts run backup-database
```

That volume is on this host's disk, which means it is not a backup on its
own — it does not survive the failure it exists for. Set `BACKUP_OFFSITE` and
every run copies its dump off the host as well.

### Backups off the host

`backup-database` hands each finished dump to [rclone](https://rclone.org),
which is in the `tools` image, then asks the far side for the file and checks
its size. A copy that fails, or arrives the wrong size, fails the run with
the reason, so the scheduler reports it; the local backup is still there.

Any S3-compatible bucket works. Make a bucket used for nothing else, and an
access key that can **write to that bucket and nothing more** — not delete,
not list other buckets. Then, in `.env`:

```sh
BACKUP_OFFSITE=offsite:continuum-backups
RCLONE_CONFIG_OFFSITE_TYPE=s3
RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=...
RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=...
# A key limited to one bucket cannot check the bucket exists; say so.
RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true

# Cloudflare R2:
RCLONE_CONFIG_OFFSITE_PROVIDER=Cloudflare
RCLONE_CONFIG_OFFSITE_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
# Backblaze B2 (its S3 endpoint, shown on the bucket's page):
#RCLONE_CONFIG_OFFSITE_PROVIDER=Other
#RCLONE_CONFIG_OFFSITE_ENDPOINT=https://s3.us-west-004.backblazeb2.com
# AWS S3:
#RCLONE_CONFIG_OFFSITE_PROVIDER=AWS
#RCLONE_CONFIG_OFFSITE_REGION=us-east-2
```

`offsite` is the name rclone knows the destination by; the
`RCLONE_CONFIG_OFFSITE_*` settings define it, and anything rclone supports
(SFTP to another machine, a mounted disk) works the same way. Run one backup
by hand and look for `copied off this host to …` before trusting the cron
line.

Three things that matter more than they look:

- **Keep `ENCRYPTION_KEY` somewhere else too** — a password manager, not this
  host and not the bucket. The dumps are encrypted with it, so the bucket on
  its own is useless to a thief, and equally useless to you if the key died
  with the host.
- **Expire old copies with the bucket's own lifecycle rule** (90 days is
  sensible), not from this host. `BACKUP_OFFSITE_RETAIN_DAYS` exists for a
  destination without lifecycle rules, but it needs a key that can delete,
  and whoever gets into this host then gets that too.
- **The bucket's region is where the data lives.** Pick a US one: the draft
  privacy policy says family data stays in the United States.

To restore from the far side, fetch it back inside `tools` (which has rclone
and the settings) and restore as usual:

```sh
docker compose run --rm tools sh -c \
  'rclone copy offsite:continuum-backups /backups/from-offsite --include "holding-today-*.sql.enc" && ls /backups/from-offsite'
docker compose run --rm tools pnpm --filter @workspace/scripts run \
  restore-database -- --file /backups/from-offsite/<newest>.sql.enc
```

### Prove the restore works before you need it

A backup nobody has restored is a belief, not a backup.
`scripts/src/verify-backup.ts` restores the newest dump into a scratch
database and checks that an encrypted photo comes back byte-identical and an
encrypted SSN still decrypts. It refuses to run when `VERIFY_DATABASE_URL`
equals `DATABASE_URL`, and treats zero rows restored as a failure rather than
a clean empty database.

```sh
docker compose run --rm \
  -e VERIFY_DATABASE_URL=postgres://funeral:...@db:5432/restore_drill \
  tools pnpm --filter @workspace/scripts run verify-backup
```

`.github/workflows/backup-drill.yml` runs it weekly and on any change to the
schema or the backup scripts, so the drill fails in CI rather than in an
emergency. It restores the copy that came back from the far side (a
directory standing in for the bucket), not the one left on the runner's
disk, because on the day it matters the disk is gone.

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

The security headers — `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy` and the Content-Security-Policy — live in
`deploy/security-headers.conf`, which is copied in beside the template and
`include`d rather than written into it. That is not tidiness: an nginx
`location` inherits `add_header` from the server block only while it declares
none of its own, so the three locations here that set a `Content-Type` or a
`Cache-Control` were silently being served with no security headers at all —
including the one that serves `index.html`, and the one that serves every
script and stylesheet. `include` is the only mechanism nginx offers for
putting them back. **Add a header to a `location` and you must include that
file beside it**, or you have just dropped the rest.

If you put a CDN or a WAF in front of these containers, check it is not adding
a second `Content-Security-Policy`: two of them are intersected, not
overridden, and the result is usually a blank page nobody can explain.

nginx's access logs hold no links. Its default line has the whole request and
the Referer, which between them carry every family's link and every reset,
invitation and confirmation token, so both templates log the path without its
query string, a family link as `/f/REDACTED`, and no Referer. Caddy keeps no
access log at all: the Caddyfile has no `log`. Error logs are another matter.
A request that fails at nginx (the API unreachable, an upload over 50 MB) or
at Caddy (an app's nginx unreachable) is written to its error log in full,
Referer and all, so treat those as holding links.

## Website

`artifacts/website` is the public page for funeral homes deciding whether to
sign up. It is optional and off by default. To serve it:

1. Point a DNS record at the host for its name, and set `WEBSITE_URL` (with
   the scheme, no trailing slash) and `WEBSITE_CONTACT_EMAIL` in `.env`.
2. Start it with the profile: `docker compose --profile website up -d --build`,
   or put `COMPOSE_PROFILES=website` in `.env` so a plain `up` includes it.
   Caddy already has a block for `WEBSITE_URL` and fetches its certificate
   like the others'; with `WEBSITE_URL` unset that block answers only a name
   under `.invalid` and asks Let's Encrypt for nothing.

It is built by the same `Dockerfile.web`, with two differences set in
`docker-compose.yml`: its own nginx config (`deploy/website.conf.template`:
no `/api`, a 404 for unknown paths, a week's cache on the screenshots) and its
own headers (`deploy/website-security-headers.conf`: no `X-Robots-Tag`,
because unlike the apps this page is meant to be indexed, and a CSP of
`script-src 'none'`, because it ships no script at all). The page is rendered
to HTML at build time, so every setting is baked in: after changing
`WEBSITE_URL`, `CONSOLE_URL` or the contact address, run
`docker compose build website`. By hand:

```sh
docker build -f Dockerfile.web --build-arg APP=website \
  --build-arg NGINX_CONF=deploy/website.conf.template \
  --build-arg NGINX_HEADERS=deploy/website-security-headers.conf \
  --build-arg VITE_SITE_URL=https://example.com \
  --build-arg VITE_CONSOLE_URL=https://console.example.com \
  --build-arg VITE_CONTACT_EMAIL=hello@example.com -t fh-website .
```

Leave `WEBSITE_PRIVACY_URL` and `WEBSITE_TERMS_URL` empty until the documents
in `LEGAL/` have been reviewed; until then the footer says they are available
on request rather than linking to drafts. Nothing in the family portal, a
home's public page or any family email links to the website, and nothing
should: it sells to funeral homes, and a family should never be routed to it.

## Health checks

- `GET /healthz` on either web container — nginx is serving files. Deliberately
  not proxied: that is a different question from whether the API is up, and
  conflating them takes both out at once.
- `GET /api/healthz` — the API *and* its database. Returns 503 when Postgres is
  unreachable, because a process that is listening but cannot reach Postgres
  serves an error on every screen, and calling that healthy keeps it in the
  load balancer. Mail and SMS are reported but never fail the check: a home
  without Twilio is degraded, not down.

## Knowing when it breaks

Two things, and the second is the one that wakes somebody up.

**Errors.** Set `SENTRY_DSN` to a Sentry project's DSN and the API reports
every server error, and every crash the three apps send back from a browser,
to it. Leave it empty and both are written to the API's log only — which is
the same as nobody being told. What leaves the server is deliberately thin: no
request bodies, headers, cookies, query strings or user records, no
breadcrumbs, the route pattern rather than the URL (a family's URL is their
credential), and every message scrubbed of email addresses, tokens, nine-digit
numbers and phone numbers. `error-tracking.test.ts` reads what would actually
have been sent. The browsers never talk to Sentry themselves: they report to
`POST /api/client-errors` on their own origin, which keeps the CSP unchanged
and keeps every family's IP address off a third party's servers.

Sentry is a sub-processor once this is on. Add it to the DPA's list before you
set the variable, not after.

**Is it up.** Point a monitor that pages a phone at `GET /api/healthz` — the
check that really asks the database (see *Health checks*). UptimeRobot and
Better Stack both do this on a free plan; one check every five minutes, alert
by SMS or push to whoever is on call. Add a second check on the family portal's
`/healthz` if you want to know nginx is serving.

`.github/workflows/uptime.yml` asks the same question every hour from
GitHub, as a backstop. (Hourly because a private repository pays for Actions
by the minute; see `STATUS.md`.) It skips with a notice until the `API_URL`
repository secret is set, and also checks the front ends when the
`FAMILY_PORTAL_URL` and `CONSOLE_URL` repository variables are. It is not the
pager: GitHub delays scheduled runs under load, and a failed run only emails
whoever last edited the file.

## How it holds up under photographs

Measured on 5 October 2026 with `scripts/src/load-test-uploads.ts`, against
the production bundle on a 4-core, 16 GB machine, with JPEGs the size and
pixel count of real phone photographs (it also ran the test suite at the same
time, so these are on the slow side):

| Case | Result |
| --- | --- |
| One family sends 1,000 12-megapixel photos (3.1 MB each), one at a time as the portal does | All 1,000 accepted, no errors, never near the rate limit. 16 minutes: about 0.95 s of server work each, mostly re-encoding to 3000 px. Another family opening their page meanwhile: p50 11 ms, max 66 ms. API memory peaked at 462 MB. The database grew 592 MB, about 0.6 MB a photo. |
| Ten families at once, 20 photos each | 220 photos a minute in all, CPU-bound. Another family's page: p95 70 ms, max 175 ms. Before the fix below it was p95 506 ms and max 848 ms. Memory peaked at 634 MB. |
| A misbehaving client: eight 48-megapixel photos (12.6 MB each) at once | All accepted; memory peaked at 1,014 MB. |

What follows from it:

- **Give the API container 2 GB at the least; 4 GB is comfortable.** One
  well-behaved family needs half a gigabyte; abuse needs a gigabyte.
- **CPU is the limit, not the database.** Each photograph costs most of a
  second of one core, because it is resized to 3000 px and re-encoded with
  mozjpeg (`images.ts`). Turning mozjpeg off makes that 3.7× faster and the
  files about 55% larger; with every photograph in every backup, smaller won.
- **Plan storage at about 0.6 MB a photograph,** in the database and again in
  every backup. A case at the 1,000 cap is about 600 MB.
- Two things the test found are fixed: converting a photograph used to hold a
  database connection for the whole second (ten families uploading held the
  whole pool, and everyone else waited), and photographs arriving together at
  the 999th could all land past the 1,000 cap.

Run it yourself against a throwaway database, never one in use:

```sh
API_URL=http://localhost:4310 API_PID=<pid> DATABASE_URL=<that database> \
  pnpm --filter @workspace/scripts run load-test-uploads -- --families 1 --photos 1000
```

## What this is not

One Postgres, one API, no replication, no object storage, and backups that
are only off the host if `BACKUP_OFFSITE` is set. That is honestly sized for a
pilot with a handful of homes on it. The things to fix before it is more than
that, roughly in order: move uploads out of Postgres (every photograph is in
every dump, so backups grow with them), and run more than one API container —
which needs nothing changed, since sessions are in the database rather than in
memory.
