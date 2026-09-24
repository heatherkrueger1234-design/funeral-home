# Continuum Aftercare

Software a funeral home buys so it stops cat-herding grieving families through
paperwork and photo collection by text message at midnight. One texted link,
the photographs, the obituary, the timeline, the printed order of service, and
the grief check-ins afterwards.

It is deliberately **not** a case-management system — homes already own one.
[`replit.md`](./replit.md) is the full product description and the reasoning
behind every omission; it has that filename because Replit's tooling reads it,
not because it is a deployment note.

**If you read one other file, read [`STATUS.md`](./STATUS.md)** — what is broken
right now, which branches matter, and what to do next.

## The one rule about branches

| Branch | What it is |
| --- | --- |
| `claude/funeral-home-portal-uj9bik` | **Main.** Everything live is here. Branch from it, open pull requests into it. |
| `claude/app-capability-check-mvfn8x` | **Old integration branch. Do not branch from it.** It holds component 3–6 work (storefront, statement, forms, engagement) that never came back to main. [`STATUS.md`](./STATUS.md) has the keep-or-drop decision this needs. |

## Two products, one seam

| Reads it | Name |
| --- | --- |
| A director, about their account or their bill | **Continuum Aftercare** — this repository |
| A family, about the arrangement or in a check-in | the funeral home's own name |
| A family, once they are handed on after the funeral | **Holding Today** — a separate product, `holdingtoday.com`, Memory-Haven repository |

The home pays for Continuum Aftercare. The family is handed on to Holding Today
afterwards. Nothing family-facing in this repository carries either of our
names, and that is the point of the seam.

## Running it

Needs Node 24, pnpm and Postgres. `pnpm` only — the `preinstall` hook rejects
npm and yarn, because a second lockfile in a workspace this size costs everyone
a day.

```sh
pnpm install
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/funeral_home
export ENCRYPTION_KEY=$(pnpm --filter @workspace/scripts run generate-encryption-key --silent)

pnpm --filter @workspace/db run push   # create the tables
pnpm run typecheck
# Integration tests TRUNCATE every table, so they get their own database.
# setup.ts refuses any database whose name does not end in _test.
createdb funeral_home_test
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/funeral_home_test pnpm run test
pnpm run build
```

The server refuses to start without `ENCRYPTION_KEY` rather than quietly
storing photographs in the clear.

Changed `lib/api-spec/openapi.yaml`? Run
`pnpm --filter @workspace/api-spec run codegen` and commit the generated files
in the same commit, or CI goes red for everyone.

To see it with plausible data in it, `pnpm --filter @workspace/scripts run
seed-showcase` builds a complete fictional funeral home with four cases and
generated photographs. The logins it prints are in
[`replit.md`](./replit.md#demoing-it).

## Where things live

```
artifacts/
  api-server/        Express API. Staff and family auth both mounted in src/routes/index.ts
  director-console/  What a funeral home works from          (served at /)
  family-portal/     What the family opens from their link   (served at /family)
  admin-console/     Our own platform console                (served at /admin)
  website/           The marketing site
  mockup-sandbox/    Component previews, not shipped
  e2e-tests/         Playwright, against a real stack
lib/
  api-spec/          openapi.yaml, the contract. Source of truth.
  api-zod/           GENERATED from the spec. Never edit by hand.
  api-client-react/  GENERATED from the spec. Never edit by hand.
  db/                Drizzle schema, one file per area. Every table carries funeralHomeId.
  mailer/            SMTP, shared by the API and the scripts. Logs instead of sending when unset.
scripts/             Backups, restore, demo seeds, the aftercare sender
deploy/              Caddy config for the Docker deployment
.github/workflows/   CI, plus three daily scheduled jobs (see STATUS.md)
templates/           The two spreadsheets a home fills in at setup
```

## The documents

**Before you write code**

| File | Read it when |
| --- | --- |
| [`STATUS.md`](./STATUS.md) | Always first. Current problems, open pull requests, branch clean-up. |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Before your first commit. The codegen rule, the shared files that will bite you, the product's hard boundaries, house style. |
| [`CRAFT.md`](./CRAFT.md) | Before you touch any interface. The bar this is held to — longer than the contributing guide, and not optional. |
| [`COLORADO.md`](./COLORADO.md) | You are touching anything the law cares about: who may authorise, the 72-hour certificate clock, pricing. Not background reading. |

**Running and selling it**

| File | Read it when |
| --- | --- |
| [`replit.md`](./replit.md) | You need what the product does, every environment variable, the print studio, what money gates, or how to demo it. |
| [`DEPLOY.md`](./DEPLOY.md) | You are putting it on a server: containers, TLS, mail, backups, scheduled work. |
| [`LAUNCH.md`](./LAUNCH.md) | You want to know what is ready for a real funeral home and what is not. |
| [`PRICING.md`](./PRICING.md) | You are touching billing or what we charge. |
| [`RETENTION.md`](./RETENTION.md) | You are touching deletion, backups or encryption — or a home's insurer is asking. |
| [`LEGAL/`](./LEGAL/README.md) | Terms, privacy policy, DPA. **Drafts waiting on a lawyer**, and `LEGAL/README.md` is explicit about which claims are placeholders. |
| [`docs/history/`](./docs/history/) | You want to know why something looks the way it does. The plan this was built under and the original component briefs. Archived, not instructions. |

## Honest status

The product works and is tested — the API suite runs against real Postgres with
no mocks, and there are frontend and Playwright suites alongside it. What is
*not* done, so nobody is surprised:

- The legal documents need a lawyer.
- No error tracking and no uptime monitoring. The first time production breaks,
  a customer tells us.
- The three daily scheduled jobs fail every day for want of two repository
  secrets. `STATUS.md`, problem 1.
- Colorado's 72-hour filing clock is only partly built.
- A home cannot read the `platform_audit` log about itself. The DPA promises it
  "on request", which we can only honour by hand.

[`STATUS.md`](./STATUS.md) and [`LAUNCH.md`](./LAUNCH.md) are the fuller
versions of this list.
