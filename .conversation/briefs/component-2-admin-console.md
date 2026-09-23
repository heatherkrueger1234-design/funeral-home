# Component 2 — The platform admin console

**Branch:** `claude/component-2-admin` → PR into `claude/app-capability-check-mvfn8x`
**Depends on:** Component 1
**Colorado:** read Section 2 of `COLORADO.md` before you start

## The problem

There is no platform tier in this product at all. `USER_ROLES` is
`["owner", "director", "staff"]` and all three sit *inside* one funeral home;
the tenant id is read off the signed-in user's own row and nothing in the API
can query across homes. Heather — who owns the business — currently has no way
to see her own customers.

## What you own

- `artifacts/admin-console/**` — a new Vite app, third alongside the family
  portal and director console
- `artifacts/api-server/src/routes/admin.ts`
- `lib/api-spec/paths/admin.yaml`

Component 1 gives you the `platform_admins` table, its session and the
`requirePlatformAdmin` gate. Use them. Do not build your own.

## Build

**Homes.** List, open, create, suspend. Creating a home from a **blank
template** — a starter standard schedule, default office hours, an empty
catalogue — so a new customer is not staring at nothing on day one. This is the
"blank templates to put homes in" from the original notes.

**Colorado licensure tracking, per home.** DORA registration number, registered
services, appointed designee, renewal date, and practitioner licence expiries.
Surface the **1 January 2027** licensure deadline and the **30-day amended
registration** rule as calm reminders. Section 2 of `COLORADO.md` explains why
this is the most useful thing in the console this year: it is also the best
sales demo available in Colorado in 2026.

**Engagement numbers.** Cases opened, family links sent versus opened, photo
counts, aftercare enrolled / consented / declined / unsubscribed, storefront
activity once Component 3 exists. Component 6 owns how these are computed —
take its numbers, do not write your own counting.

## Constraints

- Cross-tenant reads are the entire point of this component and are also the
  single most dangerous thing in the codebase. Every one of them goes through
  a named helper in `admin.ts` that is obviously platform-scoped. Never relax
  `requireAuth` or the tenant helpers to achieve it.
- **Read-only by default.** A platform admin may see everything and change
  almost nothing. Creating and suspending homes, yes. Editing a family's
  photographs or a case's obituary, no — there is no business reason and every
  compliance reason against it.
- Every cross-tenant read is audit-logged: who looked, at what, when.
- This console is internal, so it may look denser than the family portal — but
  it is still held to the craft standard. Same fonts, same tokens, same calm.

## Done when

A new home can be created from the console, its licensure status is visible,
engagement numbers render, an integration test proves a platform admin cannot
reach family data through the staff API, and another proves a director cannot
reach a single admin route.
