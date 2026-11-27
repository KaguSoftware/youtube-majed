/**
 * pnpm variety <id> [--against N] [--json]     the variety report of one project
 * pnpm variety all [--against N] [--out file]  every storyboarded project against the videos before it
 *
 * Code only: reads what the projects' files say they used (worker/src/variety.ts).
 */
import { VARIETY_AGAINST, VARIETY_BANDS, VARIETY_DIMENSIONS, type VarietyReport } from "@studio/schema";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { allTable, varietyAll, varietyReport } from "./variety";

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const target = args.find((a, i) => !a.startsWith("--") && !["--against", "--out"].includes(args[i - 1] ?? ""));
const against = flag("against") ? Number(flag("against")) : undefined;
if (!target || (against !== undefined && !(against >= VARIETY_AGAINST.min && against <= VARIETY_AGAINST.max))) {
  console.error(`usage: pnpm variety <id> [--against ${VARIETY_AGAINST.min}-${VARIETY_AGAINST.max}] [--json]\n       pnpm variety all [--against N] [--out file.json]`);
  process.exit(1);
}

function show(r: VarietyReport) {
  console.log(`${r.project}: ${r.score === null ? "first video, nothing to compare with" : `${r.score.toFixed(1)} · ${r.verdict.replace("_", " ")}`}  (against ${r.against.join(", ") || "nothing"}; distinct ≥ ${VARIETY_BANDS.distinct}, similar ≥ ${VARIETY_BANDS.similar})`);
  for (const d of r.dimensions) console.log(`  ${VARIETY_DIMENSIONS[d.dimension].label.padEnd(28)} ${d.distinct === null ? "    —" : d.distinct.toFixed(0).padStart(5)}  ${d.top.join(", ")}`);
  for (const x of r.repeats) console.log(`  ↺ ${VARIETY_DIMENSIONS[x.dimension].label.toLowerCase()}: ${x.message}`);
}

if (target === "all") {
  const all = varietyAll({ against });
  const out = flag("out");
  if (out) {
    const file = resolve(process.env.INIT_CWD ?? process.cwd(), out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(all, null, 2) + "\n");
    writeFileSync(file.replace(/\.json$/, "") + ".txt", allTable(all));
    console.log(`✓ ${file}\n  ${file.replace(/\.json$/, "")}.txt`);
  }
  console.log(allTable(all));
} else {
  const r = varietyReport(target, { against });
  if (!r) {
    console.error(`✗ ${target} has no storyboard (projects/${target}/storyboard/scenes.json)`);
    process.exit(1);
  }
  if (args.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else show(r);
}
