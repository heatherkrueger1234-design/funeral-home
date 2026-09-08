# Holding Today for funeral homes

A funeral home buys this to stop cat-herding grieving families through
paperwork and photo collection by text message at midnight.

It is deliberately **not** a case-management system. Homes already own one.
There is no price list, no invoice, no contract and no venue booking here, and
those omissions are product decisions rather than gaps: the FTC Funeral Rule
governs how prices must be disclosed, and churches and cemeteries keep their
own calendars. What this owns is the collaboration with the family, which is
the part nobody has built.

## What it does

**1. The asset drop.** One mobile link, texted to the next of kin. Photographs
(capped at 50, with a portrait crop stored as instructions so the original
bytes survive), the obituary as named fields rather than a blank box, and the
hymns, readings and pallbearers as short lists. This replaces a director's
inbox holding forty attachments from six addresses.

**2. One contained thread.** Everyone on the family's side sees the same
conversation, so the "who told you that?" arguments settle themselves and the
director answers once. Office hours are *shown, never enforced* — a 2am message
is delivered at 2am and the family is told, before they send, when it will be
read, with the 24-hour number next to it. The thread locks a fortnight after
the service, for both sides.

**3. A timeline.** Four or five dated things, in plain words. Events (the
funeral) are distinguished from tasks (deliver the clothing) and cannot be
ticked off.

**4. Aftercare that costs no staff hours.** Closing a case enrols the family in
30/60/90-day and anniversary check-ins, signed in the home's name. Enrolments
start `pending` and send nothing until the family consents.

## Shape of the code

A pnpm workspace. `lib/api-spec/openapi.yaml` is the source of truth: orval
generates the zod validators the server uses and the react-query hooks the
frontends use, so a contract change cannot land on one side only. CI fails if
the checked-in generated code drifts from the spec.

```
lib/db              Drizzle schema. 14 tables, all reachable from funeral_homes.
lib/api-spec        openapi.yaml + orval config. The contract.
lib/api-zod         Generated: zod validators (server-side).
lib/api-client-react Generated: react-query hooks (+ hand-written multipart).
artifacts/api-server Express. Two auth surfaces; see below.
artifacts/family-portal   What the family opens. Mobile-first, brandable.
artifacts/director-console What the home works cases from.
scripts             Backups, and the aftercare sender.
```

### The security model, in three sentences

A `funeral_homes` row is the tenant and everything below carries
`funeralHomeId`. **Staff** carry a session cookie; `requireAuth` loads the home
from the signed-in user's own row, so a home id arriving in a path or body is
never what gets filtered on. **Families** have no account at all — they send
the token from their texted link as a bearer header, their routes mount under
`/family`, and none of those paths takes a case id, because the token names
exactly one case.

Both gates are mounted once, in `artifacts/api-server/src/routes/index.ts`.
Being reachable without authentication requires an edit to that file rather
than an omission somewhere else.

The link-as-credential trade is made deliberately: a registration form is where
a next of kin three days bereaved is lost, what sits behind the link is one
case's photographs and a hymn list, only the token's SHA-256 is stored, and one
click revokes it.

## Running it

Needs Postgres and an encryption key.

```sh
pnpm install
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/funeral_home
export ENCRYPTION_KEY=$(pnpm --filter @workspace/scripts run generate-encryption-key --silent)

pnpm --filter @workspace/db run push      # create the tables
pnpm run typecheck
pnpm run test                             # integration tests, real Postgres
pnpm run build
```

Environment the server reads:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Postgres. Required. |
| `ENCRYPTION_KEY` | 32 bytes, base64. Uploads are AES-256-GCM at rest; the server refuses to start without it. |
| `PORT` | Required. |
| `FAMILY_PORTAL_URL` | Origin used to build the texted link. Falls back to a relative path — an obviously incomplete link beats one that opens someone else's deployment. |
| `CONSOLE_URL` | Origin used in staff password-reset emails. |
| `SMTP_*` | Optional. Without it, mail is logged rather than sent, which keeps local development and the tests working. |

The aftercare sender is a cron job, not a server loop:

```sh
pnpm --filter @workspace/scripts run send-aftercare -- --dry-run
```

It claims each delivery with a conditional update before sending, so two
overlapping runs cannot both take the same row — the failure it trades for
(a crash losing one check-in) is much better than its opposite, which is
sending a widow the same message twice.

## Tests

`artifacts/api-server/test` runs against a real Postgres with no mocks, because
almost everything that could actually go wrong here is a query returning the
wrong rows — a missing tenant filter, a join that leaks another home's case —
and a mocked database cannot fail that way.

The two files worth reading first are `tenant-isolation.test.ts` (one home
cannot reach another's cases; a link reaches exactly one case; one family
member cannot delete another's photograph) and `case-lifecycle.test.ts`, which
walks a case from the call coming in to the family consenting to aftercare.

## Relationship to Memory-Haven

This repository began as a fork of Memory-Haven (`holdingtoday.com`) at
`6e79cb4`, for its workspace layout, auth, encrypted uploads and component set.
The two have diverged: Memory-Haven models one bereaved person keeping a
private archive, this models a funeral home working a case with a family.
Nothing here changes anything there.
