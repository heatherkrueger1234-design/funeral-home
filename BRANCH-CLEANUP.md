# Branch Cleanup — funeral-home

Dated 2026-09-28. Verified against `git branch -r` after `git fetch origin`.

## Current remote branches (5 total)

| Branch | Last commit | Status |
|--------|-------------|--------|
| `claude/funeral-home-portal-uj9bik` | 2026-09-27 | **Main. Keep.** All launch work lands here. |
| `claude/app-capability-check-mvfn8x` | 2026-09-21 | **Migration source. Keep until all four stranded components are brought across.** Catalogue/storefront + statement migrated 2026-09-28 (`claude/launch-sprint-catalogue`). Forms/72-hour clock and engagement scoring still to come. |
| `claude/component-5-forms` | 2026-09-14 | **Forms source. Keep until the forms/72-hour-clock migration lands.** |
| `claude/component-5-forms-an85uj` | 2026-09-14 | **Forms source (with deployment work merged). Keep until the forms/72-hour-clock migration lands.** The two forms branches diverged; the migration should compare both before choosing. |

## Dead / superseded branches

**None.** Every non-main branch is still a live migration source. There is
nothing safe to delete today.

## Deletion commands (DO NOT RUN YET)

When the catalogue, forms, and engagement migrations have all landed on main
and their PRs are merged, the three source branches become superseded. Then,
and only then:

```bash
cd ~/workspace/funeral-home-repos/funeral-home
git push origin --delete claude/app-capability-check-mvfn8x
git push origin --delete claude/component-5-forms
git push origin --delete claude/component-5-forms-an85uj
```

Do not delete `claude/funeral-home-portal-uj9bik` (main). Do not run these
until the parent agent confirms all migrations are merged — the commands are
recorded here so the cleanup is a deliberate step, not an accident.
