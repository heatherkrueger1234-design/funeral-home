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
scheduled jobs, offsite backups, monitoring, the billing lifecycle — has been
exercised rather than assumed. Doing that found several failures that would
each have hit the first pilot home; they are fixed.

What is still missing is the part no rehearsal substitutes for: **it has never
run on a public host with a public domain, no real mail provider has ever
carried one of these messages, no card has ever been charged, and no real
family has ever opened the family portal.**

Every one of those four is blocked on something only Heather can buy or sign
for. They are listed, with prices, in *What I need from Heather* at the end of
this file. Nothing else is in the way.

---

# Go live

One path. Not options — where there was a choice, it has been made, and the
reasoning is in `DEPLOY.md` if you want it. Follow these in order; each step
says what "it worked" looks like, and if you do not see that, stop there
rather than carrying on.

Budget half a day at the keyboard, and a week of waiting before that — Stripe
verification and Postmark's domain approval are the slow ones, so start those
first and let them run while you do everything else.

Steps 1–9 get the site up and publicly trusted. Steps 10–17 are the ones that
decide whether it is still running in six months, and skipping them is how
this dies quietly on a Sunday.

**Before you start**, have everything in *What I need from Heather* in hand.
Step 5 will refuse to proceed without it, which is the point.

## 1. Generate the encryption key, on your own machine

First, before anything exists to encrypt. Every uploaded photograph and every
social security number in the database — and in every backup — is AES-256-GCM
under this key.

```sh
pnpm --filter @workspace/scripts run generate-encryption-key
```

Put it in a password manager, and nowhere else. Not in a chat window, not in
an email, not in a terminal that is being recorded — anything with history is
somewhere it has been published. `SECRETS.md` has the full reasoning.

**It worked:** 44 characters ending in `=`, saved somewhere that is neither
this host nor the backup. There is no recovery path if it is lost: the
ciphertext stays and is worth nothing.

## 2. Point DNS at the host

In Cloudflare DNS, two `A` records, both **DNS-only** — grey cloud, not orange:

| Type | Name | Content |
| --- | --- | --- |
| A | `family` | the host's public IPv4 |
| A | `console` | the host's public IPv4 |

The proxy has to stay off. With it on, Cloudflare terminates TLS itself, Caddy
never sees the connection it needs for the ACME challenge, and you end up
debugging two certificate systems instead of one.

Do this before the host exists if you like — DNS propagation is the slow part,
and there is no harm in the records pointing at an address that is not
answering yet.

**It worked:**

```sh
getent ahostsv4 family.holdingtoday.com | head -1
getent ahostsv4 console.holdingtoday.com | head -1
```

Both print the host's public address. If they print nothing, wait; if they
print something else, fix it now — Let's Encrypt allows five failures per
hostname per hour and a typo discovered later costs you the rest of the hour.

## 3. Provision the host and install Docker

DigitalOcean, Basic Droplet, 8 GB / 4 vCPU, New York. Ubuntu 24.04.

```sh
ssh root@<host>
curl -fsSL https://get.docker.com | sh
```

**It worked:** `docker compose version` prints v2 or later.

## 4. Put the code on the host

```sh
git clone https://github.com/heatherkrueger1234-design/funeral-home /srv/funeral-home
cd /srv/funeral-home
cp .env.example .env
chmod 600 .env
```

Then fill in `.env`. The four the stack refuses to start without are
`POSTGRES_PASSWORD`, `ENCRYPTION_KEY`, `FAMILY_PORTAL_URL` and `CONSOLE_URL`.
Set `FAMILY_DOMAIN`, `CONSOLE_DOMAIN` and `ACME_EMAIL` as well, and set

```sh
ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory
```

for now. Step 7 removes it.

**It worked:** `.env` is mode 600 and every value above is non-empty.

## 5. Preflight

```sh
./deploy/preflight.sh
```

It changes nothing and is safe to run as many times as you like. It refuses to
pass on the things that are invisible at `up` time and expensive afterwards:
DNS that does not point here, a missing env value, a clock far enough out that
a fresh certificate will not validate, a disk without room to take a dump, and
port 80 held by something else.

**It worked:** `Ready. Bring it up with:` and no red `FAIL` lines. Fix what it
names and run it again. Do not continue past a `FAIL` — every one of them is a
thing that fails later, further from its cause.

Two `warn` lines are expected here and are fine: `ACME_CA is set` (that is step
4 doing its job) and possibly one about not reaching `:80` through the host's
own public address, which is usually the provider declining to route traffic
back to itself rather than a closed port.

## 6. Bring it up against the staging CA

```sh
docker compose run --rm tools pnpm --filter @workspace/db run push
docker compose run --rm tools pnpm --filter @workspace/scripts run load-postal-codes
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d
docker compose ps
```

Schema first: the API starts without the tables and then every screen 500s.
The postal codes are the 33,791 ZIP centroids that make "cemeteries near me"
work; skip them and proximity search returns nothing rather than erroring.

**It worked:** six containers, all reporting healthy — `db`, `api`, the three
front ends, and `caddy` — and

```sh
docker compose logs caddy | grep -i "certificate obtained"
```

prints a line for each domain. Then:

```sh
curl -I https://family.holdingtoday.com/healthz
```

fails with a certificate error naming Let's Encrypt's staging CA. **That error
is the success condition.** It means DNS, port 80, the challenge and issuance
all work, without spending any of the production rate limit.

If issuance failed instead, read `docker compose logs caddy`. Nine times in
ten it is DNS, and once it is a firewall that never allowed :80 inbound —
open it in the provider's console, not on the host.

## 7. Switch to real certificates

Only now. Remove the `ACME_CA` line from `.env`, then:

```sh
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --force-recreate caddy
```

**It worked:**

```sh
curl -sSI https://console.holdingtoday.com/healthz | head -1
```

prints `HTTP/2 200` with no certificate warning, and a browser shows a padlock.

## 8. Register the first home, and sign in

Open `https://console.holdingtoday.com`, register, and sign in.

**It worked:** you land inside the console and stay there after a refresh.

This is a real test, not a formality. The session cookie is marked `Secure` in
production, and a browser accepts a `Secure` cookie over plain HTTP and then
never sends it back — so a proxy misconfiguration shows up as signing in,
landing back on the sign-in page, and nothing appearing to be wrong. If that
happens, `docker compose logs api | grep Secure` says so in one line.

## 9. Check the health endpoints

```sh
curl -s https://console.holdingtoday.com/api/healthz
```

**It worked:** `"database":true`. `"mail"` will be `false` — step 10 fixes it.

### And the platform console, which has no public door

The two customer-facing front ends are served by Caddy. The platform console —
ours, where you see every home on the platform — deliberately is not. A
signed-in platform admin can read every home's cases, so the cost of one
stolen password there is not one home, it is all of them, and that is not
worth a public login page.

It is bound to loopback on the host. Reach it through an SSH tunnel:

```sh
ssh -L 8082:127.0.0.1:8082 root@<host>
```

then open `http://127.0.0.1:8082` in a browser on your own machine.

**It worked:** the platform sign-in page loads. Browsers treat `127.0.0.1` as
a secure context, so the `Secure` session cookie is accepted over the tunnel
with no certificate involved. If sign-in bounces you back to the sign-in page,
that is the `Secure` cookie being refused — say so rather than working around
it, because the same symptom on a public host means something different.

There is no platform admin until one is created; a stack with no row in
`platform_admins` has a console nobody can sign in to, which is the correct
state to leave it in until you need it.

---

At this point the site is public, trusted and usable. Everything below is what
keeps it that way.

## 10. Mail, and prove it reaches an inbox

Add Postmark's three DNS records — it gives you the exact values; they are a
`TXT` for SPF, a `CNAME` or `TXT` for DKIM, and a `TXT` for DMARC at
`_dmarc`. Start DMARC at `p=none`.

Then set `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM`
in `.env` — `SMTP_FROM` is an address at the funeral home's domain, never at
this software's — and restart:

```sh
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d api
curl -s https://console.holdingtoday.com/api/healthz   # "mail":true
```

Now actually send one, to a Gmail address and to an Outlook address:

```sh
curl -X POST https://console.holdingtoday.com/api/auth/forgot-password \
     -H 'Content-Type: application/json' -d '{"email":"you@gmail.com"}'
```

It answers `202` whether or not the address exists, on purpose.

**It worked:** both messages arrive **in the inbox, not in spam**, and the link
opens the console over HTTPS, takes a new password, and refuses to work a
second time.

Check the spam folder even when the inbox one arrived. Mail about a death, from
a domain with no sending history, is the exact shape of thing filters are built
to catch, and this is the one place where "it worked for me" is not evidence.

## 11. Aftercare: the secret, then the dry run

Set `TASK_SECRET` in `.env` to a long random string and restart the API. Then,
before anything writes to a real family:

```sh
curl -X POST "https://console.holdingtoday.com/api/tasks/aftercare?dryRun=1" \
     -H "Authorization: Bearer $TASK_SECRET"
```

**It worked:** JSON with `"dryRun":true` and `"mailConfigured":true`. Nothing
was written and nothing was sent. A `401` means the secret on the host and the
one you sent do not match. If `mailConfigured` is `false`, go back to step 10 —
running for real now would mark deliveries against mail that never left.

## 12. Backups, off this host

Write `/srv/funeral-home/rclone.conf` with the Backblaze B2 credential, scoped
to the one bucket, then:

```sh
chmod 600 /srv/funeral-home/rclone.conf
BACKUP_REMOTE=b2:krueger-backups/db \
RCLONE_CONFIG=/srv/funeral-home/rclone.conf \
  ./deploy/backup-offsite.sh
```

**It worked:** `verified holding-today-....sql offsite (N bytes)`. The script
reads back the size of what it wrote rather than trusting its own exit code —
a copy job that trusts its exit code is how a home ends up with a year of empty
files and finds out on the worst possible morning.

Then prove the restore, because a backup nobody has restored is a belief:

```sh
docker compose run --rm \
  -e VERIFY_DATABASE_URL=postgres://funeral:...@db:5432/restore_drill \
  tools pnpm --filter @workspace/scripts run verify-backup
```

**It worked:** every table's row count matches and the digest of the encrypted
photograph and SSN bytes matches on both sides. Row counts alone are exactly
what a corrupted backup preserves, which is why both are checked.

## 13. Monitoring, and prove it pages

Create the healthchecks.io check and copy its ping URL. Then:

```sh
ALERT_WEBHOOK=<your webhook> \
HEARTBEAT_URL=<healthchecks.io ping URL> \
BACKUP_REMOTE=b2:krueger-backups/db \
RCLONE_CONFIG=/srv/funeral-home/rclone.conf \
  ./deploy/monitor.sh
```

**It worked:** `monitor: all checks passed`, and healthchecks.io shows the ping
arriving. Set its grace period to about two hours — roughly twice the cron
interval below.

Now break something on purpose and confirm a human hears about it:

```sh
docker compose stop db
ALERT_WEBHOOK=<your webhook> ./deploy/monitor.sh ; docker compose start db
```

**It worked:** the alert arrives wherever that webhook goes, **and no heartbeat
was sent**. That second half is the dead-man's switch: a monitor cannot report
the host it runs on being down, so something external has to notice the ping
stopping.

## 14. The three cron lines

```sh
crontab -e
```

```
0 14 * * *  cd /srv/funeral-home && docker compose run --rm tools pnpm --filter @workspace/scripts run send-aftercare

30 3 * * *  BACKUP_REMOTE=b2:krueger-backups/db RCLONE_CONFIG=/srv/funeral-home/rclone.conf \
              /srv/funeral-home/deploy/backup-offsite.sh >> /var/log/fh-backup.log 2>&1

30 * * * *  ALERT_WEBHOOK=<webhook> HEARTBEAT_URL=<ping URL> \
            BACKUP_REMOTE=b2:krueger-backups/db RCLONE_CONFIG=/srv/funeral-home/rclone.conf \
              /srv/funeral-home/deploy/monitor.sh >> /var/log/fh-monitor.log 2>&1
```

Aftercare runs at 14:00 UTC — mid-morning across the US rather than 3am, which
is a bad time to receive a message about somebody who died. All three are
re-runnable: running any of them twice in a row is harmless.

**It worked:** tomorrow, `/var/log/fh-monitor.log` has entries and
healthchecks.io has not paged.

## 15. The outside-in check

In the repository settings, add two **variables** — `FAMILY_DOMAIN` and
`CONSOLE_DOMAIN` — and two **secrets** — `ALERT_WEBHOOK`, and `TASK_SECRET`
matching the host's, with `API_URL` as a variable if you want GitHub to run
aftercare instead of cron.

Then run `.github/workflows/uptime.yml` by hand once.

**It worked:** a green run reporting `200` for all four endpoints and the days
remaining on both certificates.

## 16. Stripe

Only the funeral home's subscription to us runs through Stripe. No family ever
pays anything through this product.

In the Stripe dashboard create the product and price, then add an endpoint at
`https://console.holdingtoday.com/api/billing/webhook`. Copy the signing secret
into `STRIPE_WEBHOOK_SECRET`, the price id into `STRIPE_PRICE_ID` and the
secret key into `STRIPE_SECRET_KEY`, and restart the API.

Do this in **test mode** first and subscribe a test home with Stripe's
`4242 4242 4242 4242`.

**It worked:** the home's status moves to `trialing` or `active` in the
database, and Stripe's dashboard shows the webhook delivering `200`. Then swap
to live keys and repeat once with a real card.

## 17. Open one real case

One home, one real family, and watch what happens.

**It worked:** a director opened a case, texted a link, and a family member
opened it on a phone and uploaded a photograph — without anybody explaining how.

---

# What is not ready

| Gap | Severity | What it would take |
| --- | --- | --- |
| **No production deployment exists.** Everything was proven on an ephemeral machine with self-signed certificates and hostnames in `/etc/hosts`. | **Blocking** | The runbook above, once the host and domain exist. |
| **No real family has ever used the family portal.** Every test is synthetic. | **High** | One pilot home, one real case, watch. |
| **No mail has ever gone through a real provider.** The SMTP conversation was real; the server was local. SPF/DKIM/DMARC alignment and whether a grieving family's inbox files it as spam are untested. | **High** | Step 10. |
| **No card has ever been charged.** The webhook and the gating are proven against signed synthetic events; Stripe's own checkout has never been opened. | **High** | Step 16. |
| **SMS is unconfigured.** Directors copy the family link by hand. | Medium | A Twilio number. Degraded, not down. |
| **One API instance, one Postgres, no replication.** | Medium | Fine for a pilot. `DEPLOY.md` says at what point each piece has to change. |
| **Uploads live in Postgres.** Encrypted, correct, and the wrong long-term home for gigabytes of photographs. | Medium | Object storage, at roughly 20 GB per home. |
| **`ENCRYPTION_KEY` cannot be rotated.** No procedure, and no plan for the day it is exposed. | Medium | Written before it is needed, not after. `SECRETS.md` says plainly that this is missing. |
| **The in-memory rate limiter does not survive a restart or a second instance.** | Low | The public front door has database-backed hourly ceilings behind it; the rest would want Redis at scale. |
| **No load test.** A home uploading 1,000 photographs at once is untried. | Low | The zip ceiling is checked before streaming, which was the sharp edge. |

## What has been proven by running it

Against a real PostgreSQL, with the production esbuild bundle, through the real
nginx config, in the built containers:

- A home registers, opens a case, invites a family, and the family uploads a
  genuine iPhone HEIC that comes back as a JPEG.
- Twelve photographs stream out as an uncorrupted slideshow zip.
- A family who was never sent a link asks a home to open one, and a director
  accepts it; a second director accepting the same request gets a 409.
- Someone arranging their own funeral is **not** enrolled in grief check-ins.
- `pg_dump` → `DROP DATABASE` → restore, with an encrypted photograph matching
  byte-for-byte.
- A case exports as a folder that opens without this software, **after the home
  has cancelled**.
- A case erases for real: the encrypted bytes are gone, not merely
  unreferenced.
- All four images build; the stack comes up healthy; a full restart leaves the
  photograph byte-for-byte identical.
- **A director signs in over HTTPS and stays signed in** — the plain-HTTP
  failure was reproduced first. This needed a fix: nginx was overwriting the
  `X-Forwarded-Proto` anything in front of it sets.
- **A password reset arrives and the link works**, and is refused on reuse.
- **Aftercare picks the right rows**: seven enrolments, the dry run named
  exactly the two owed, the real run delivered those two, the rerun was a
  no-op.
- **A backup went off the host and was restored from**, every local copy
  deleted first.
- **Something pages a human** — proven by stopping the database, letting the
  backup go stale, and stopping aftercare.
- **The whole subscription lifecycle** through the real webhook with real
  signatures. This needed a fix too: the webhook was mounted where the body had
  already been parsed, so it could never have verified a genuine Stripe event.

237 tests, 5 projects typechecking, 4 apps building.

## Decisions that look like gaps and are not

- **No price list, no invoices, no contracts.** The FTC Funeral Rule governs
  how prices are disclosed and every state's pre-need statute differs. This
  holds the collaboration with the family; the home's own systems hold the
  sale.
- **No automatic deletion of case data, ever.** Retention is set by state law
  and the home's insurer. See `RETENTION.md`.
- **The vendor directory ships empty.** Invented headstone companies would
  produce numbers a grieving family would actually dial.
- **The hymn and poem library ships empty.** Shipping verbatim published text
  is a copyright problem the homes would inherit.
- **Office hours are shown, never enforced.** A 2am message is delivered at
  2am; the family is told when it will be read and given the 24-hour number.

## Before selling to homes you cannot ring

- A second API instance and a managed Postgres with point-in-time recovery.
- A support route that is not "email the developer".
- **A written incident plan for the case that matters: the encryption key is
  compromised, or lost.** Still the largest unwritten thing here. There is no
  key-rotation path at all, so an exposure is retroactive across every backup
  ever taken, and the honest answer today is "get help and tell the homes".
  Write it while nobody is panicking.
- Deliverability monitoring. A mail provider that starts silently dropping
  aftercare is indistinguishable, from inside, from a quiet month.

---

# What I need from Heather before the site can be public

Seven things. I cannot do any of them: every one needs a card, a legal
identity, or a decision that is yours. Everything that did not need one is
already done.

Prices were checked against the providers' own pages in September 2026 and are
what they advertise for the plan named; confirm at signup, because one of them
had moved by a factor of three since I last had a figure for it.

**Total: about $64 a month, the domain included, plus Stripe's percentage on
what you actually collect.** Optional host backups add $9.60.

| | Per month |
| --- | --- |
| Host — DigitalOcean 8 GB droplet | $48.00 |
| Mail — Postmark Basic | $15.00 |
| Offsite backups — Backblaze B2 | $0 until 10 GB |
| Dead-man's switch — healthchecks.io | $0 |
| Domain — Cloudflare Registrar | $0.92 ($11/year) |
| Stripe | 2.9% + 30¢ per charge |
| **Running total** | **about $64** |

The order matters — 1 and 2 block the runbook at step 2, and the rest can
follow while it is running.

### 1. A domain, and the registrar

**Recommendation: `holdingtoday.com`, registered at Cloudflare Registrar.**

**What it is.** The name families and directors type. Two hostnames come off
it: `family.` and `console.`

**Why.** Cloudflare sells domains at cost with no renewal markup and no upsell
screen, and its DNS is free, fast and has a sane API. It also means the domain
and the DNS are in one account rather than two, which matters at 2am.

**Cost.** About **$11 a year** for a `.com`. DNS is free.

**What breaks without it.** Everything. There is no certificate without a
domain, no mail without a domain to sign for, and no link to text a family.

**What you have to do.** Create the Cloudflare account, search for the name,
buy it. Then add me — or give me a scoped API token for the zone — so I can
create the records in step 2. Turn on two-factor authentication on that
account: whoever holds the domain can redirect the site and issue certificates
for it.

### 2. DNS access

**Included with the above** — this is not a separate purchase, it is a separate
*permission*, and it is the one people forget.

**What it is.** The ability to create records on the zone: two `A` records for
the hosts, three `TXT`/`CNAME` records for mail, and later a `CAA` record.

**Why it is called out separately.** Owning the domain and being able to change
its records are different things, and the mail records in particular are edited
several times while deliverability is being tuned. Going through somebody else
for each change turns a ten-minute job into a week.

**Cost.** None.

**What breaks without it.** The certificate cannot issue and mail lands in
spam.

**What you have to do.** Either add me as a member of the Cloudflare account
with DNS edit rights on that zone only, or create an API token scoped to
`Zone:DNS:Edit` for that one zone and send it through a password manager — not
a chat window.

### 3. The host

**Recommendation: DigitalOcean Basic Droplet, 8 GB / 4 vCPU, New York region.
Ubuntu 24.04.**

**What it is.** One virtual machine: 4 vCPU, 8 GB RAM, 160 GB SSD. Everything
runs on it — Postgres, the API, both front ends, Caddy.

**Why that size.** The stack is six containers, one of them a database. 8 GB is
comfortable rather than tight — the image pipeline decodes iPhone HEICs in
memory, which is the spiky part — and 160 GB holds several homes' photographs
with room for the nightly dump, which needs roughly twice the database's own
size because `pg_dump` writes binary as hex. A US region because the families
are American and the data should sit in the United States; you will be asked
about that, probably by an insurer.

**Why DigitalOcean.** Mostly by elimination, and the reasoning is worth
keeping so nobody switches back to save money that is no longer there.
Hetzner was the obvious choice on price and is not any more: its US CPX31 went
from €20.99 to €62.49 a month on 15 June 2026, a 2.98x increase, which makes
it *more* expensive than this for the same specification. AWS and Google are
two to three times this for a single box and price their egress in a way that
punishes serving photographs. DigitalOcean is a US company with flat pricing,
a support line that answers, and snapshots and managed Postgres sitting right
there for when the pilot outgrows one machine.

**Cost.** **$48 a month.** (The rungs either side of it — 4 GB / 2 vCPU at $24
and 16 GB / 8 vCPU at $96 — are confirmed on DigitalOcean's own pricing page;
this is the middle one. Worth a glance at the page before you click, since I
have just been caught out by a stale price elsewhere.)

Add their automated backups at **$9.60 a month** (20% of the droplet) if you
want it. They are not a substitute for the offsite backup in step 12 — same
provider account, same blast radius — but they turn "rebuild the host" into
"roll it back", which is worth having the first time you break something.

**What breaks without it.** There is nothing to deploy to.

**What you have to do.** Create the account, add a payment method, create the
droplet with an SSH key rather than a root password, and send me the address.

### 4. A mail provider

**Recommendation: Postmark, Basic plan.**

**What it is.** The service that actually delivers password resets, grief
check-ins and intake alerts.

**Why, and this is the one not to decide on price.** Postmark carries
transactional mail only — it refuses bulk marketing outright, which is why its
sending reputation is what it is, and it separates transactional from broadcast
streams so one cannot poison the other. SendGrid's free tier and Amazon SES at
$0.10 per thousand are both cheaper, and both put you on shared infrastructure
whose reputation you do not control, or hand you the reputation problem to
solve yourself. A message telling a widow her password was reset, or checking
in six months after her husband died, cannot go to spam. That is worth $15 a
month and it is not close.

**Cost.** **$15 a month** for 10,000 messages — far more than a pilot sends.
There is a free tier of 100 messages a month, which is enough to test with
before you pay.

**What breaks without it.** Password resets and aftercare are written to the
server log instead of sent. In practice a director who forgets their password
cannot get back in without somebody reading a log file, and the grief check-ins
— the thing the home is paying for — silently never arrive.

**What you have to do.** Create the account, verify the sending domain, and
send me the server API token and the three DNS records it gives you. Approval
for a new account can take a day or two, so start it early.

### 5. A Stripe account

**Recommendation: Stripe, standard pricing. There is no real alternative for
this.**

**What it is.** How funeral homes pay their monthly subscription to you. **No
family ever pays anything through this product** — a family who owes the home
money is linked out to the home's own payment page, and we hold no card data
and take no percentage of what a home sells.

**Why Stripe.** The webhook handling, signature verification and the whole
subscription lifecycle are already built and tested against it.

**Cost.** No monthly fee. **2.9% + 30¢** per successful charge. On a $200/month
subscription that is about $6.10.

**What breaks without it.** Nobody can subscribe. Homes stay on trial until it
expires and then cannot open new cases.

**What you have to do.** Create the account in the business's legal name, and
complete verification — EIN, business address, bank account. This is the
slowest item on this list; allow a week. Then send me the test-mode keys first,
and the live keys and webhook signing secret once step 16 passes in test mode.

### 6. Offsite backup storage

**Recommendation: Backblaze B2, one bucket, one application key scoped to it.**

**What it is.** Where the nightly database dump goes, so that losing the host
does not lose the photographs.

**Why.** $6 per terabyte per month with the first 10 GB free, and it speaks the
S3 API that `deploy/backup-offsite.sh` already uses. The same script works
against S3, Wasabi or R2 if you would rather — this one is the cheapest at
pilot size by a wide margin.

**Cost.** **Free** for a pilot; about **$6 a month** once you are past a
terabyte, which is a long way off.

**What breaks without it.** The backups sit on the same disk as the database
they are protecting, which protects you from somebody dropping a table and from
nothing else that actually loses a funeral home's photographs — the disk, the
host, the provider account, or ransomware.

**What you have to do.** Create the account and the bucket, then create an
application key scoped to **that bucket only**, and turn on object lock or
versioning. A key that can delete is a key ransomware can use. Send me the key
through a password manager.

### 7. Somewhere to be paged, and something watching the pager

**Recommendation: healthchecks.io free tier for the dead-man's switch, and a
Slack incoming webhook — or ntfy on your phone — for the alerts.**

**What it is.** Two different things, and both are needed. `ALERT_WEBHOOK` is
where the monitor sends a problem it found. `HEARTBEAT_URL` is the dead-man's
switch: the monitor pings it on every clean run, and the external service pages
when the ping *stops*.

**Why both.** A monitor running on the host cannot report that host being down
— it dies with it, and the silence looks exactly like health. That is how a
home discovers on Tuesday that the portal has been down since Saturday.

**Cost.** **Free.** healthchecks.io's free tier covers 20 checks; one Slack
webhook costs nothing.

**What breaks without it.** `deploy/monitor.sh` refuses to run at all without
`ALERT_WEBHOOK`, rather than pretending to be monitoring. And without the
heartbeat, the three failures with no symptoms — a certificate that stopped
renewing, a backup that stopped leaving the host, aftercare that stopped going
out — are invisible until a family notices.

**What you have to do.** Create the healthchecks.io check and copy its ping
URL. Decide where a 3am alert should land and make sure it reaches a person
rather than a channel nobody has muted. Send me both URLs.

---

### One thing I deliberately have not done

**I have not generated the encryption key**, and I will not. It is step 1 of
the runbook, on your machine, once. Anything generated in a shared session has
been published, and this is the one secret with no recovery path: lose it and
every photograph and every social security number in the database and in every
backup becomes ciphertext nobody can read. `SECRETS.md` has the reasoning and
the full list of every other secret this deployment needs.
