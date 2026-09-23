# Component briefs

> **Out of date on one point (23 Sep 2026):** the branch names below are
> wrong. `claude/app-capability-check-mvfn8x` is no longer the integration
> branch. Branch from and merge into **`claude/funeral-home-portal-uj9bik`**.
> See [`../STATUS.md`](../STATUS.md). The rules and the craft standard still
> apply.

One file per agent. Read, in this order:

1. [`../TEAM-SPLIT.md`](../TEAM-SPLIT.md) — ownership, the codegen rule, and
   the craft standard every component is held to.
2. [`../COLORADO.md`](../COLORADO.md) — your section. It decides how several of
   these components are shaped.
3. Your brief in this folder.
4. [`../replit.md`](../replit.md) — what the product is and what it refuses to be.

## Branching

Integration branch: `claude/app-capability-check-mvfn8x`.

Work on your own branch, `claude/component-N-shortname`, and open a pull
request into the integration branch. Do not commit directly to it — six agents
sharing one branch is the merge problem this split exists to avoid.

## The two rules that will bite you

**Generated code.** `lib/api-spec/openapi.yaml` is the source of truth. Orval
generates `lib/api-zod` and `lib/api-client-react` from it with `clean: true`,
and CI fails on drift. Never hand-edit generated files. Change the spec, run
`pnpm --filter @workspace/api-spec run codegen`, and commit the result in the
same commit.

**Component 1 first.** Identity, roles, levels and passwords land before
anything else wires up to them. Until then, build your schema, your logic and
your UI, and leave `TODO(C1)` where a permission check goes. Do not invent a
second permission model.
