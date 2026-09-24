/**
 * Which remote branches can be deleted without losing a line.
 *
 * Two tests, because one is not enough:
 *
 *  1. `rev-list --count base..branch` is 0 — every commit is already an
 *     ancestor of the base branch. This is the one everybody knows.
 *  2. The three-dot diff is empty — the branch introduces no change at all.
 *     This catches a **squash merge**, whose work is in the base branch but
 *     whose commits are not, so test 1 reports it as "3 ahead" forever and it
 *     looks alive. `git branch --merged` misses these too.
 *
 * Read-only. It prints; it never deletes. Deleting a remote branch is not
 * reversible from the GitHub UI, so the copyable command is the output and the
 * decision stays a person's.
 */
import { execFileSync } from "node:child_process";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/*
 * Not hardcoded to "main": this repository's default branch is a
 * `claude/...` name, and every recipe that assumes "main" compares against
 * nothing and cheerfully reports every branch as dead.
 */
function defaultBranch(): string {
  const override = process.argv[2];
  if (override) return override.startsWith("origin/") ? override : `origin/${override}`;
  try {
    // Set in most clones: "refs/remotes/origin/HEAD -> refs/remotes/origin/x".
    return git("symbolic-ref", "refs/remotes/origin/HEAD").replace("refs/remotes/", "");
  } catch {
    // Not set in a shallow or CI clone, so ask the remote rather than give up.
    // `ls-remote --symref` prints "ref: refs/heads/x\tHEAD" before the shas.
    const symref = git("ls-remote", "--symref", "origin", "HEAD");
    const match = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(symref);
    if (match) return `origin/${match[1]}`;
    throw new Error(
      "Could not work out the default branch. Pass it as an argument:\n" +
        "  pnpm --filter @workspace/scripts run dead-branches my-main-branch",
    );
  }
}

const base = defaultBranch();

// Stale refs are the other classic wrong answer: branches deleted on the
// remote weeks ago still listed locally, and recent ones missing entirely.
git("fetch", "--prune", "origin");

const branches = git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin")
  .split("\n")
  .filter((b) => b && b !== base && !b.endsWith("/HEAD"));

const dead: string[] = [];
const squashed: string[] = [];
const live: { name: string; ahead: number }[] = [];

for (const branch of branches) {
  const ahead = Number(git("rev-list", "--count", `${base}..${branch}`));
  if (ahead === 0) {
    dead.push(branch);
    continue;
  }
  // `--quiet` exits non-zero when there is a difference, which is the cheap
  // way to ask "does this branch change anything" without rendering a diff.
  let changesNothing: boolean;
  try {
    execFileSync("git", ["diff", "--quiet", `${base}...${branch}`], { stdio: "ignore" });
    changesNothing = true;
  } catch {
    changesNothing = false;
  }
  if (changesNothing) squashed.push(branch);
  else live.push({ name: branch, ahead });
}

const short = (b: string) => b.replace(/^origin\//, "");

console.log(`Compared against ${base}\n`);

if (dead.length > 0) {
  console.log(`Fully merged — ${dead.length} branch(es), nothing to lose:`);
  for (const b of dead) console.log(`  ${short(b)}`);
  console.log();
}

if (squashed.length > 0) {
  console.log(
    `Squash-merged — ${squashed.length} branch(es). These read as "ahead" but`,
  );
  console.log("change nothing, so they are just as safe to delete:");
  for (const b of squashed) console.log(`  ${short(b)}`);
  console.log();
}

if (live.length > 0) {
  console.log("Has work the default branch does not — read before deleting:");
  for (const { name, ahead } of live.sort((a, b) => a.ahead - b.ahead)) {
    console.log(`  ${String(ahead).padStart(3)} commit(s) ahead  ${short(name)}`);
  }
  console.log();
}

const deletable = [...dead, ...squashed].map(short);
if (deletable.length > 0) {
  console.log("To delete them, once you have read the list:\n");
  console.log(`  git push origin --delete ${deletable.join(" \\\n    ")}\n`);
} else {
  console.log("Nothing is safe to delete automatically.\n");
}
