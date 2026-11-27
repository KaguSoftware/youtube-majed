/**
 * Reels without the UI (Phase 4, Part C).
 *
 *   pnpm reel <id> cut            Claude picks the strongest loop of a long video and a 60–90 s cut; creates <id>-reel
 *   pnpm reel <id> export         the 9:16 file (1080×1920, CRF 21, captions burned in) and its .srt, in renders/reel/
 *   pnpm reel <id> status         the Reel export and the cuts made from this video
 *
 * `export` works on a native Reel (brief format "reel") and on a Reel cut alike. Only the scenes that changed since
 * the last export are drawn again.
 */
import { BusyError, withLock } from "./lock";
import { cutReel, reelLinks } from "./reel-cut";
import { exportReel, reelStatus } from "./reel-export";
import { byStep, readUsage, totals } from "./usage";

const [id, command] = process.argv.slice(2);
const fail = (m: string): never => {
  console.error(`✗ ${m}`);
  process.exit(1);
};
if (!id || !command || !["cut", "export", "status"].includes(command)) fail("usage: pnpm reel <id> cut | export | status");

let lastLine = "";
const bar = (p: { label: string; done: number; total: number; detail?: string }) => {
  const line = `${p.label}${p.detail ? ` · ${p.detail}` : ""}`;
  if (process.stderr.isTTY) process.stderr.write(`\r  ${line} (${Math.round((p.done / p.total) * 100)}%)   `);
  else if (p.label !== lastLine) process.stderr.write(`  ${p.label}\n`); // piped: one line per phase
  lastLine = p.label;
};
const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;

try {
  if (command === "status") {
    const s = await reelStatus(id!);
    const links = reelLinks(id!);
    console.log(s.record ? `${id}: Reel exported ${s.record.createdAt}${s.stale ? " (out of date)" : ""}: ${s.record.file}, ${mb(s.record.media.sizeBytes)}, ${s.record.media.durationS.toFixed(1)} s` : `${id}: no Reel export yet`);
    if (links.cutFrom) console.log(`  a Reel cut of ${links.cutFrom.parent} (version ${links.cutFrom.parentVersion}), loop ${links.cutFrom.cut.loopId}`);
    for (const r of links.reels) console.log(`  Reel cut: ${r.id} (${r.seconds?.toFixed(1) ?? "?"} s, from ${r.loopId})`);
  } else if (command === "cut") {
    const r = await withLock(`reel cut of ${id}`, () => cutReel(id!, { report: bar }));
    process.stderr.write("\n");
    console.log(`✓ ${r.child}: ${r.keptLines} lines of ${r.cut.loopId}, ${r.seconds.measured.toFixed(1)} s (Claude estimated ${r.seconds.estimated.toFixed(1)} s); ${r.takesCloned} takes reused${r.voiced.length ? `, voiced ${r.voiced.join(", ")}` : ", nothing voiced"}`);
    console.log(`  why: ${r.cut.why}`);
    if (r.cut.hook) console.log(`  hook (${r.newLines.hook}): ${r.cut.hook.text}`);
    if (r.cut.ending) console.log(`  ending (${r.newLines.ending}): ${r.cut.ending.text}`);
    const u = totals(readUsage(id!).filter((x) => x.step === "reelcut"));
    console.log(`  Claude: ${JSON.stringify(byStep(readUsage(id!)).reelcut ?? u)}`);
    console.log(`  next: pnpm reel ${r.child} export`);
  } else {
    const r = await withLock(`reel export of ${id}`, () => exportReel(id!, { signal: new AbortController().signal, report: bar }));
    process.stderr.write("\n");
    console.log(`✓ ${r.file}\n  ${mb(r.media.sizeBytes)} · ${r.media.durationS.toFixed(1)} s · ${r.media.video.width}×${r.media.video.height} · CRF ${r.encode.crf}${r.encode.reencoded ? ` (re-encoded once: first pass ${r.encode.firstPassMB} MB was over ${r.encode.capMB} MB)` : ` (first pass ${r.encode.firstPassMB} MB, cap ${r.encode.capMB} MB)`}\n  ${r.sidecars.srt} (${r.sidecars.captions} cues)\n  total ${(r.timings.totalMs / 1000).toFixed(1)} s${r.segments ? ` · drew ${r.segments.drawn} of ${r.segments.total} segments` : ""}`);
  }
} catch (e) {
  process.stderr.write("\n");
  if (e instanceof BusyError) fail(e.message);
  fail((e as Error).message);
}
process.exit(0);
