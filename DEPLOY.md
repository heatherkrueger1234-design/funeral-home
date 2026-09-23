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
| Run, for real | `docker build` for all four images, then `docker compose up`: four containers healthy, migrations applied through `tools`, a home registered and a real iPhone HEIC uploaded and served back through nginx, and a backup taken and restored inside the containers. A full `docker compose restart` left the photograph byte-for-byte identical. |
| Run, for real | Caddy → this `nginx.conf` → the API, with TLS from Caddy's own CA on `*.localhost`: HTTPS reaches the API as HTTPS, plain HTTP redirects, and one visitor exhausting the sign-in limit does not lock out another. The same test against the previous config locked both out. |
| Run, for real | `send-test-email` against an SMTP server on 587 with STARTTLS: delivered over TLS; a wrong password, a half-set config and an API key with no `SMTP_FROM` each fail with the reason; a server that refuses STARTTLS is refused rather than sent the password in clear. |
| **Not run** | A real Let's Encrypt certificate on a real domain, a real mail provider, or a real Stripe key. Those need your DNS and your accounts. |

## Before anything else

```sh
cp .env.example .env
```

Then fill in the ones the stack refuses to start without: `POSTGRES_PASSWORD`,
`ENCRYPTION_KEY`, `FAMILY_PORTAL_URL`, `CONSOLE_URL`, `ADMIN_CONSOLE_URL` and
`ACME_EMAIL`.

And point DNS at the host **before** the first `up`: an A record (and AAAA,
if the host has IPv6) for each of the three hostnames in those URLs, and
ports 80 and 443 open to the internet. Caddy asks Let's Encrypt for the
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
workflow in `.github/workflows/aftercare.yml`, or a cron line on the host:

```sh
0 14 * * *  docker compose -f /srv/funeral-home/docker-compose.yml \
              run --rm tools pnpm --filter @workspace/scripts run send-aftercare
```

Backups likewise. `BACKUP_DIR` inside the `tools` container is the `backups`
volume:

```sh
30 3 * * *  docker compose -f /srv/funeral-home/docker-compose.yml \
              run --rm tools pnpm --filter @workspace/scripts run backup-database
```

That volume is on this host's disk, which means it is not a backup — it does
not survive the failure it exists for. Copy it off the host:

```sh
docker run --rm -v funeral-home_backups:/b -v "$PWD:/out" alpine \
  tar czf /out/backups.tar.gz -C /b .
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
emergency.

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

One Postgres, one API, no replication, no object storage, backups on the same
host until you copy them off. That is honestly sized for a pilot with a
handful of homes on it. The things to fix before it is more than that, roughly
in order: move uploads out of Postgres, put the backups somewhere else
automatically, and run more than one API container — which needs nothing
changed, since sessions are in the database rather than in memory.
