/**
 * Writes engine/schemas/<step>.json from the zod schemas. Never edit those
 * files by hand: change packages/schema/src/story.ts and run `pnpm schemas`.
 *
 *   pnpm schemas           # write
 *   pnpm schemas --check   # exit 1 if a file is missing or out of date
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StepName, stepJsonSchema } from "../src/index";

const dir = resolve(fileURLToPath(import.meta.url), "../../../../engine/schemas");
const check = process.argv.includes("--check");
const stale: string[] = [];
mkdirSync(dir, { recursive: true });
for (const step of StepName.options) {
  const file = join(dir, `${step}.json`);
  const text = JSON.stringify(stepJsonSchema(step), null, 2) + "\n";
  if (check) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) stale.push(file);
  } else {
    writeFileSync(file, text);
    console.log(`✓ ${file}`);
  }
}
if (stale.length) {
  console.error(`✗ out of date (run \`pnpm schemas\`):\n  ${stale.join("\n  ")}`);
  process.exit(1);
}
if (check) console.log("✓ engine/schemas is up to date");
