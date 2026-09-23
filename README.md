# Continuum Aftercare

Software a funeral home buys so it stops cat-herding grieving families through
paperwork and photo collection by text message at midnight.

It is deliberately **not** a case-management system — homes already own one.
What it owns is the collaboration with the family: one texted link, the
photographs, the obituary, the timeline, the printed order of service, and the
grief check-ins afterwards. [`replit.md`](./replit.md) is the full product
description and the reasoning behind every omission; it has that filename
because Replit's tooling reads it, not because it is a deployment note.

## Two products, one seam

| Reads it | Name |
| --- | --- |
| A director, about their account or their bill | **Continuum Aftercare** — this repository |
| A family, about the arrangement or in a check-in | the funeral home's own name |
| A family, once they are handed on after the funeral | **Holding Today** — a separate product, `holdingtoday.com`, Memory-Haven repository |

The home pays for Continuum Aftercare. The family is handed on to Holding Today
afterwards. Nothing family-facing in this repository carries either of our
names, and that is the point of the seam.

## Start here

```sh
pnpm install
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/funeral_home
export ENCRYPTION_KEY=$(pnpm --filter @workspace/scripts run generate-encryption-key --silent)

pnpm --filter @workspace/db run push   # create the tables
pnpm run typecheck
pnpm run test                          # integration tests, against real Postgres
pnpm run build
```

Needs Postgres and an encryption key; it refuses to start without the key
rather than quietly storing photographs in the clear. `pnpm` only — the
`preinstall` hook rejects npm and yarn, because a second lockfile in a
workspace this size is a day of everyone's life.

To see it with plausible data in it, `pnpm --filter @workspace/scripts run
seed-showcase` builds a complete fictional funeral home with four cases and
generated photographs. The logins it prints are in
[`replit.md`](./replit.md#demoing-it).

## Where things live

| Path | What |
| --- | --- |
| `artifacts/api-server` | The API. Express, Drizzle, one Postgres database. |
| `artifacts/director-console` | Where a funeral home's staff work. Also the only sign-in screen for staff and platform admins. |
| `artifacts/family-portal` | What the texted link opens. No account, no password. |
| `artifacts/admin-console` | Platform side: who our customers are, who is on trial, who to worry about. |
| `artifacts/website` | The marketing site. |
| `artifacts/mockup-sandbox` | Component previews, development only. |
| `artifacts/e2e-tests` | Playwright, against a real stack. |
| `lib/api-spec` | `openapi.yaml`, the source of truth. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before touching it. |
| `lib/api-zod`, `lib/api-client-react` | **Generated.** Never edited by hand. |
| `lib/db` | Drizzle schema. Every table carries `funeralHomeId`. |
| `lib/mailer` | Templated mail. Logs instead of sending when SMTP is unset. |
| `scripts` | Backups, seeding, the aftercare sender, one-off operational jobs. |
| `deploy` | Caddy and the container deployment. |

## The documents

**Before you write code**

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — the codegen rule, the shared files
  that will bite you, the product's hard boundaries, house style.
- [`CRAFT.md`](./CRAFT.md) — the bar the interface is held to. Longer than the
  contributing guide and not optional.
- [`COLORADO.md`](./COLORADO.md) — the statutory constraints that decide how
  several features are shaped. Not background reading.

**Running and selling it**

- [`replit.md`](./replit.md) — what the product is, every environment variable,
  the print studio, what money gates, how to demo it.
- [`DEPLOY.md`](./DEPLOY.md) — containers, TLS, mail, backups, scheduled work.
- [`LAUNCH.md`](./LAUNCH.md) — what has to be true before a real home uses it.
- [`PRICING.md`](./PRICING.md) — what we charge and why.
- [`RETENTION.md`](./RETENTION.md) — what is kept, for how long, and how to get
  rid of it. Written for the person who has to answer an insurer.

**Legal**

- [`LEGAL/`](./LEGAL/) — DPA, terms of service, privacy policy, and a brief for
  the lawyer. **None of it has been reviewed by one yet**, and
  [`LEGAL/README.md`](./LEGAL/README.md) is explicit about which claims are
  placeholders.

**History**

- [`docs/history/`](./docs/history/) — the plan this was built under and the
  original component briefs. Archived, not instructions.

## Honest status

The product works and is tested — the API suite runs against real Postgres
with no mocks, and there are frontend and Playwright suites alongside it
(`pnpm run test`). What is *not* done, so nobody is surprised:

- The legal documents need a lawyer.
- No error tracking and no uptime monitoring. The first time production breaks,
  a customer tells us.
- Colorado's 72-hour filing clock is only partly built.
- A home cannot read the `platform_audit` log about itself. The DPA promises it
  "on request", which we can only honour by hand — self-serve would be a
  stronger sentence in a sales conversation.

`LAUNCH.md` is the fuller version of this list.
