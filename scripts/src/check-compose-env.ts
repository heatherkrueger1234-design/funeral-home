/**
 * Every setting the API reads must reach it in docker-compose.yml.
 *
 * Compose only hands a container the variables its `environment:` block
 * names; anything in `.env` that is not listed there never arrives, and the
 * API treats a missing setting as "off". For most settings that is loud
 * enough. For billing it was silent: the per-funeral price, its meter and
 * the annual prices were all missing, so a Docker deployment would have
 * billed every home its base subscription and counted no funeral at all,
 * looking from the inside exactly like a product nobody was using.
 *
 * So this reads both — every `process.env` the API and the libraries it
 * bundles touch, and the api service's block in the compose file — and
 * fails on any name in the first that is not in the second.
 *
 * A regex over the raw text rather than a YAML parser, for the same reason
 * as `check-artifact-paths.ts`: the point is what is written in the file.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;

/** Set in the Dockerfile's runtime stage, not in compose. */
const SET_BY_THE_IMAGE = new Set(["NODE_ENV"]);

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      found.push(...sources(path));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      found.push(path);
    }
  }
  return found;
}

const read = new Set<string>();
for (const dir of ["artifacts/api-server/src", "lib/db/src", "lib/mailer/src"]) {
  for (const file of sources(join(root, dir))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/process\.env(?:\[["']|\.)([A-Z][A-Z0-9_]*)/g)) {
      read.add(match[1]!);
    }
  }
}

const compose = readFileSync(join(root, "docker-compose.yml"), "utf8").split("\n");
const start = compose.findIndex((line) => /^ {2}api:\s*$/.test(line));
if (start === -1) {
  console.error("check-compose-env: no `api:` service in docker-compose.yml.");
  process.exit(1);
}
const passed = new Set<string>();
for (const line of compose.slice(start + 1)) {
  if (/^ {2}\S/.test(line)) break; // the next service
  const match = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line);
  if (match) passed.add(match[1]!);
}

const missing = [...read].filter((name) => !passed.has(name) && !SET_BY_THE_IMAGE.has(name)).sort();

if (missing.length > 0) {
  console.error(
    "check-compose-env: the API reads these, and docker-compose.yml never passes them to it:\n" +
      missing.map((name) => `  ${name}`).join("\n") +
      "\nAdd each to the api service's `environment:` block (empty default is fine).",
  );
  process.exit(1);
}

console.log(`check-compose-env: all ${read.size} settings the API reads reach it in docker-compose.yml.`);
