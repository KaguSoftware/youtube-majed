/**
 * Validates sample scene files without rendering.
 *   pnpm validate                 # every sample
 *   pnpm validate lighthouse      # one sample, or a folder path
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { REMOTION_DIR, loadProject, sampleDir } from "./load";

const args = process.argv.slice(2);
const targets = args.length ? args : readdirSync(join(REMOTION_DIR, "samples"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

let failed = 0;
for (const target of targets) {
  const r = loadProject(sampleDir(target));
  if (r.ok) {
    const seconds = r.data.voice ? r.data.voice.track.duration : Object.values(r.data.timing!.seconds).reduce((a, b) => a + b, 0);
    const words = r.data.script.lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
    const source = r.data.voice ? "voiced, word-timed" : "unvoiced, timing.json";
    console.log(`✓ ${target}: ${r.data.scenes.scenes.length} scenes, ${seconds.toFixed(1)} s, ${words} words (${Math.round((words / seconds) * 60)} wpm), ${source}`);
    const flagged = r.data.voice?.lines.filter((l) => l.quality.status !== "ok") ?? [];
    for (const l of flagged) console.log(`  ${l.quality.status === "fail" ? "✗" : "!"} ${l.id}: ${l.quality.issues[0] ?? l.quality.status}`);
  } else {
    failed++;
    console.error(`✗ ${target}: ${r.errors.length} problem${r.errors.length === 1 ? "" : "s"}`);
    for (const e of r.errors) console.error(`  - ${e}`);
  }
}
process.exit(failed ? 1 : 0);
