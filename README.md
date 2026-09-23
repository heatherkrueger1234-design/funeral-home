# Continuum Aftercare

Software a funeral home uses to collect photographs, obituary details and
paperwork from a grieving family through one texted link, keep one message
thread per family, and send aftercare check-ins afterwards. It is deliberately
**not** a case-management system; [`replit.md`](./replit.md) explains why.

**Start here. If you read one other file, read [`STATUS.md`](./STATUS.md)** —
what is broken right now, which branches matter, and what to do next.

## The one rule about branches

| Branch | What it is |
| --- | --- |
| `claude/funeral-home-portal-uj9bik` | **The main branch.** Everything live is here. Branch from it, open pull requests into it. |
| `claude/app-capability-check-mvfn8x` | **Old integration branch. Do not branch from it.** It holds the component 3–6 work (storefront, statement, forms, engagement) that never came back to main. See `STATUS.md`. |

`TEAM-SPLIT.md` and `briefs/` still name the old branch. They were written for
the six-agent build in mid-September; the rules in them (codegen, house style,
the craft standard) still hold, the branch names do not.

## Where things live

```
artifacts/
  api-server/        Express API. Staff and family auth both mounted in src/routes/index.ts
  director-console/  What a funeral home works from          (served at /)
  family-portal/     What the family opens from their link   (served at /family)
  admin-console/     Our own platform console                (served at /admin)
  mockup-sandbox/    Design scratch space, not shipped
lib/
  api-spec/          openapi.yaml, the contract. Source of truth.
  api-zod/           GENERATED from the spec. Never edit by hand.
  api-client-react/  GENERATED from the spec. Never edit by hand.
  db/                Drizzle schema, one file per area
  mailer/            SMTP, shared by the API and the scripts
scripts/             Backups, restore, demo seeds, one-off senders
deploy/              Caddy / nginx config for the Docker deployment
.github/workflows/   CI, plus three daily scheduled jobs (see STATUS.md)
templates/           The two spreadsheets a home fills in at setup
```

## Running it

Needs Node 24, pnpm and Postgres. Full detail is in `replit.md` → *Running it*.

```sh
pnpm install
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/funeral_home
export ENCRYPTION_KEY=$(openssl rand -base64 32)
pnpm --filter @workspace/db run push     # create the tables
pnpm run typecheck
pnpm run test                            # needs the database above
```

Changed `lib/api-spec/openapi.yaml`? Run
`pnpm --filter @workspace/api-spec run codegen` and commit the generated files
in the same commit, or CI goes red for everyone.

## The other documents, and when you need them

| File | Read it when |
| --- | --- |
| [`STATUS.md`](./STATUS.md) | Always first. Current problems and branch clean-up. |
| [`replit.md`](./replit.md) | You need to know what the product does, the security model, or how to run it. |
| [`LAUNCH.md`](./LAUNCH.md) | You want to know what is ready for a real funeral home and what is not. |
| [`DEPLOY.md`](./DEPLOY.md) | You are putting it on a server. |
| [`COLORADO.md`](./COLORADO.md) | You are touching anything the law cares about: who may authorise, the 72-hour certificate clock, pricing. |
| [`PRICING.md`](./PRICING.md) | You are touching billing or what we charge. |
| [`RETENTION.md`](./RETENTION.md) | You are touching deletion, backups or encryption. |
| [`LEGAL/`](./LEGAL/README.md) | Terms, privacy policy, DPA — drafts waiting on a lawyer. |
| [`TEAM-SPLIT.md`](./TEAM-SPLIT.md) | You want the house style and design standard. Ignore its branch names. |
| [`briefs/`](./briefs/README.md) | Historical: the per-component task briefs from the parallel build. |
