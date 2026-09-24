# Superseded planning documents

Kept because they explain *why* parts of the codebase look the way they do,
not because anything here is still true. Nothing in this folder should be
treated as an instruction.

| File | What it was | What replaced it |
| --- | --- | --- |
| `parallel-build-plan.md` | The plan to build this as six components with six owners in parallel: an ownership table, a branch per component, and "component 1 lands first". | The build happened. The live engineering rules moved to [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) and the craft standard to [`../../CRAFT.md`](../../CRAFT.md), both unchanged in substance. |
| `briefs/` | One brief per component, written for the agent that owned it. | Nothing — the work landed. Read them to understand an intention behind existing code, not to find out what to build. |

Two things in `parallel-build-plan.md` were never true and are worth knowing
before you trust it: `lib/api-spec/openapi.yaml` was never split into one file
per domain, and the component branches it names are not where the code ended
up.
