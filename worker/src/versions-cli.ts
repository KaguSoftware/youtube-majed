/**
 * Version history without the UI (Phase 4, src/versions.ts).
 *
 *   pnpm versions <id>                       list (HEAD marked)
 *   pnpm versions <id> show <n>              one version: label, operations, what changed, what it cost
 *   pnpm versions <id> diff <a> <b>          which scenes, lines, takes and sound cues differ
 *   pnpm versions <id> rollback <n> [--render preview|final|both]
 *   pnpm versions <id> init                  start the history from the working files (an edit does this itself)
 *
 * Rolling back is a new version with the old files: takes, narration, mix and
 * render segments all come out of their caches, nothing is voiced, mixed or
 * drawn again (only the cached segments are joined into the video file).
 */
import { BusyError, withLock } from "./lock";
import { exportVideo, renderPreview } from "./render";
import { VersionError, diffVersions, ensureVersions, listVersions, readHead, readVersion, rollback } from "./versions";
import type { Version, VersionDiff } from "@studio/schema";

const [id, command = "list", ...rest] = process.argv.slice(2);
const flag = (f: string) => (rest.includes(`--${f}`) ? rest[rest.indexOf(`--${f}`) + 1] : undefined);
const nums = rest.filter((a) => /^\d+$/.test(a)).map(Number);

function fail(m: string): never {
  console.error(`✗ ${m}`);
  process.exit(1);
}

function printDiff(c: VersionDiff) {
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "–");
  console.log(`  scenes  added ${list(c.scenes.added)} · removed ${list(c.scenes.removed)}${c.scenes.reordered ? " · reordered" : ""}`);
  for (const [k, f] of Object.entries(c.scenes.changed)) console.log(`          ${k}: ${f.join(", ")}`);
  console.log(`  lines   added ${list(c.lines.added)} · removed ${list(c.lines.removed)} · changed ${list(Object.entries(c.lines.changed).map(([k, f]) => `${k} (${f.join(", ")})`))}`);
  console.log(`  takes   ${list(c.voiced)}`);
  console.log(`  cues    +${c.cues.added.length} −${c.cues.removed.length} moved ${c.cues.moved.length}`);
  for (const x of c.cues.added.slice(0, 8)) console.log(`          + ${x}`);
  for (const x of c.cues.removed.slice(0, 8)) console.log(`          − ${x}`);
  if (c.durationS.from !== c.durationS.to) console.log(`  length  ${c.durationS.from} → ${c.durationS.to} s`);
}

const line = (v: Version, head?: number) => `${v.n === head ? "▶" : " "} ${String(v.n).padStart(3)}  ${v.createdAt.slice(0, 19).replace("T", " ")}  ${v.kind.padEnd(8)} ${v.label}`;

async function main() {
  if (!id) fail("usage: pnpm versions <id> [list|show <n>|diff <a> <b>|rollback <n>|init]");
  if (command === "list") {
    const all = listVersions(id!);
    if (!all.length) return console.log(`${id} has no versions yet (the first edit starts the history, or: pnpm versions ${id} init)`);
    const head = readHead(id!);
    for (const v of all) console.log(line(v, head));
  } else if (command === "show") {
    const v = readVersion(id!, nums[0] ?? readHead(id!) ?? fail("no versions"));
    console.log(line(v, readHead(id!)));
    if (v.ops.length) console.log(`  operations: ${JSON.stringify(v.ops)}`);
    console.log(`  narration ${v.media.narration?.slice(0, 12) ?? "–"} · mix ${v.media.mix ?? "–"}${Object.keys(v.work).length ? ` · ${Object.entries(v.work).map(([k, x]) => `${k} ${x}`).join(", ")}` : ""}`);
    if (v.changes) printDiff(v.changes);
  } else if (command === "diff") {
    const [a, b] = nums;
    if (!a || !b) fail("diff <a> <b>");
    printDiff(diffVersions(id!, readVersion(id!, a), readVersion(id!, b)));
  } else if (command === "init") {
    const v = ensureVersions(id!);
    console.log(line(v, v.n));
  } else if (command === "rollback") {
    const to = nums[0] ?? fail("rollback <n>");
    const t0 = Date.now();
    await withLock(`rollback ${id} to ${to}`, async () => {
      const v = rollback(id!, to);
      console.log(`✓ version ${v.n}: ${v.label} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      if (v.changes) printDiff(v.changes);
      const which = flag("render");
      const ac = new AbortController();
      if (which === "preview" || which === "both") {
        const r = await renderPreview(id!, { signal: ac.signal, report: () => {} });
        console.log(`  preview: drew ${r.segments?.drawn ?? "all"} of ${r.segments?.total ?? "–"} segments in ${(r.timings.totalMs / 1000).toFixed(1)} s · ${((Date.now() - t0) / 1000).toFixed(1)} s since the command`);
      }
      if (which === "final" || which === "both") {
        const r = await exportVideo(id!, { signal: ac.signal, report: () => {} });
        console.log(`  final: drew ${r.segments?.drawn ?? "all"} of ${r.segments?.total ?? "–"} segments, ${(r.media.sizeBytes / 1_048_576).toFixed(1)} MB in ${(r.timings.totalMs / 1000).toFixed(1)} s · ${((Date.now() - t0) / 1000).toFixed(1)} s since the command`);
      }
    });
  } else fail(`unknown command "${command}"`);
}

main().catch((e) => {
  if (e instanceof VersionError || e instanceof BusyError) fail(e.message);
  console.error(e);
  process.exit(1);
});
