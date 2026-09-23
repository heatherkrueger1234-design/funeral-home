# Component briefs

> **Archived.** These were written for the agents that built each component and
> the work has landed. Read them for the intention behind existing code, not to
> find out what to build. The branch names and sequencing below are wrong:
> branch from and merge into **`claude/funeral-home-portal-uj9bik`**, and see
> [`../../../STATUS.md`](../../../STATUS.md). The live rules are in
> [`../../../CONTRIBUTING.md`](../../../CONTRIBUTING.md) and
> [`../../../CRAFT.md`](../../../CRAFT.md).

One file per agent. Read, in this order:

1. [`../parallel-build-plan.md`](../parallel-build-plan.md) — ownership, the codegen rule, and
   the craft standard every component is held to.
2. [`../../../COLORADO.md`](../../../COLORADO.md) — your section. It decides how several of
   these components are shaped.
3. Your brief in this folder.
4. [`../../../replit.md`](../../../replit.md) — what the product is and what it refuses to be.

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
