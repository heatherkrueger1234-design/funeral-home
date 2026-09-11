# Putting this on a host

Four containers: Postgres, the API, and one nginx per front end. A fifth,
`tools`, is not a server — it is where migrations, backups and restores run.

**What has actually been verified, and what has not**, because the difference
matters at 3am:

| Verified how | What |
| --- | --- |
| Run, for real | The production esbuild bundle: registration, a case, a family link, a genuine iPhone HEIC uploaded and served back as JPEG, twelve photos zipped into a slideshow pack — all of it through this exact `nginx.conf`, with `nginx -t` passing on the expanded template. |
| Run, for real | `pnpm deploy --prod --legacy` produces a tree where `sharp`, `heic-decode` and `nodemailer` resolve and `esbuild`, `vitest` and `supertest` do not. |
| Run, for real | `backup-database` → `DROP DATABASE` → `restore-database`, with an encrypted photo matching byte-for-byte and an encrypted SSN decrypting afterwards (`pnpm --filter @workspace/scripts run verify-backup`). |
| **Not run** | `docker build` and `docker compose up`. There was no Docker daemon on the machine these were written on. The Dockerfiles are the one part of this stack nobody has executed — expect to fix something the first time you build them. |

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

## Bring it up

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
was confirmed working from the deployed tree.

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

Two causes, and the log line names both: no TLS in front of the deployment, or
a reverse proxy that is not setting `X-Forwarded-Proto`. Whatever terminates
TLS — a load balancer, Caddy, another nginx — must set it. The nginx in this
repo already does, for the hop it owns.

## Behind another proxy

`app.ts` sets `trust proxy` to 1, meaning exactly one hop. Both `req.secure`
and the rate limiter's idea of a client IP depend on that number being right.
Two proxies in front and the rate limiter starts counting the inner proxy's
address, so one family's retries throttle everybody's.

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
