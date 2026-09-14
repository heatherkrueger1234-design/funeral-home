/**
 * Write the barrel for each generated schema directory.
 *
 * Orval's own `indexFiles` option would do this, but it also writes an index
 * at the package root — which is a hand-written file in both packages, listing
 * the tags and, for the react client, exporting the fetch mutator and the
 * multipart helpers the spec cannot describe. So `indexFiles` is off and this
 * runs instead, immediately after codegen.
 *
 * It only ever writes inside a generated directory, which orval cleans and
 * rewrites wholesale, so nothing here is hand-editable and nothing here
 * survives a run that does not include this step.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..", "..");

const DIRS = [
  "lib/api-zod/src/generated/types",
  "lib/api-client-react/src/generated/model",
];

for (const dir of DIRS) {
  const abs = join(root, dir);

  const modules = readdirSync(abs)
    .filter((f) => f.endsWith(".ts") && f !== "index.ts")
    .map((f) => f.slice(0, -3))
    .sort();

  writeFileSync(
    join(abs, "index.ts"),
    "// Generated after orval by scripts/write-schema-barrels.mjs.\n" +
      "// Do not edit manually.\n\n" +
      modules.map((m) => `export * from "./${m}";\n`).join(""),
  );

  console.log(`  ${dir}/index.ts — ${modules.length} modules`);
}
