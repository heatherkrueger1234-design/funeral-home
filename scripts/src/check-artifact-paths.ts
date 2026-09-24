/**
 * Every Replit front end must be built for the path it is served at.
 *
 * Vite bakes the base path into the bundle, so `paths` (where the platform
 * routes the service) and `BASE_PATH` (what the bundle expects) have to be the
 * same string. When they disagree, index.html asks for `/assets/index-….js` at
 * an address nothing is listening on and the app is a blank page — no build
 * error, no failing test, nothing until somebody loads the deployment.
 *
 * This exists as a check rather than a comment because a comment already lost.
 * `1cc8d06` merged a branch serving the director console at `/console` with one
 * serving it at the root, took `paths` from the first and `BASE_PATH` from the
 * second, and shipped the mismatch past three files that warned about exactly
 * this. Git called it a clean merge.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const artifactsDir = new URL("../../artifacts/", import.meta.url).pathname;

/** The one service with no bundle, so nothing to keep in step. */
const NO_BUNDLE = new Set(["api-server"]);

/*
 * Deliberately a regex over the raw TOML rather than a parsed document: the
 * point is to read what is written in the file, including the duplicated
 * BASE_PATH that a build env and a runtime env must both carry. A parser would
 * hand back one of them and hide a disagreement between the two.
 */
function lastMatch(text: string, pattern: RegExp): string | undefined {
  const found = [...text.matchAll(pattern)].at(-1);
  return found?.[1];
}

const problems: string[] = [];

for (const app of readdirSync(artifactsDir).sort()) {
  const tomlPath = join(artifactsDir, app, ".replit-artifact", "artifact.toml");

  let toml: string;
  try {
    toml = readFileSync(tomlPath, "utf8");
  } catch {
    continue; // Not a deployed artifact. e2e-tests and website have no manifest.
  }

  const routed = lastMatch(toml, /paths\s*=\s*\[\s*"([^"]*)"/g);
  if (!routed) {
    problems.push(`${app}: no "paths" in its artifact.toml`);
    continue;
  }
  if (NO_BUNDLE.has(app)) continue;

  const basePaths = [...toml.matchAll(/BASE_PATH\s*=\s*"([^"]*)"/g)].map(
    (m) => m[1],
  );

  if (basePaths.length === 0) {
    problems.push(
      `${app}: routed at "${routed}" but sets no BASE_PATH, so its bundle is ` +
        `built for "/" and will look for its assets there`,
    );
    continue;
  }

  /*
   * Both the build env and the runtime env set it, and the build is the one
   * that decides. Checked as a set so the two agreeing is part of the test:
   * a runtime BASE_PATH that looks right beside a build one that is wrong is
   * the most convincing way to have this bug.
   */
  const distinct = [...new Set(basePaths)];
  if (distinct.length > 1) {
    problems.push(
      `${app}: disagrees with itself — BASE_PATH is ${distinct
        .map((p) => `"${p}"`)
        .join(" and ")}. The build env wins and the other one only looks right`,
    );
    continue;
  }

  if (distinct[0] !== routed) {
    problems.push(
      `${app}: routed at "${routed}" but built for "${distinct[0]}". Every ` +
        `script and stylesheet will resolve somewhere nothing is listening`,
    );
  }
}

if (problems.length > 0) {
  console.error(
    "Replit artifact paths are inconsistent:\n\n" +
      problems.map((p) => `  - ${p}`).join("\n") +
      "\n\n`paths` and `BASE_PATH` must be the same string. See the Replit " +
      "section of replit.md.\n",
  );
  process.exit(1);
}

console.log(
  "Replit artifact paths: every front end is built for the path it is served at.",
);
