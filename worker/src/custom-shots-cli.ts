/**
 * Custom shots without the UI (Phase 5, Part B). docs/PLAN.md section 6.
 *
 *   pnpm shots <id> list                                   the shots, their status and why
 *   pnpm shots <id> suggest                                the moments worth a shot (the ending twist, head fakes)
 *   pnpm shots <id> add <scene> ["note"] [--model sonnet|opus] [--no-repair]
 *                                                          Claude writes a shot for a scene; code checks it
 *   pnpm shots <id> add <scene> --source file.tsx [--title "…"]   a hand-written shot, through the same checks
 *   pnpm shots <id> auto [--model …]                       a shot for each of the best moments with none yet
 *   pnpm shots <id> regenerate <C1> "<note>"               a new version with a note; a failed try keeps the shot you have
 *   pnpm shots <id> accept|reject|recheck <C1>             your verdict (reject = back to the library scene); the checks again
 *   pnpm shots <id> log                                    why a shot fell back, and every verdict
 *   pnpm shots <id> compare S93,S47 --models sonnet,opus   the same moments on two models, checked, nothing saved to the manifest
 *
 * Then `pnpm edit <id> render preview` (or `pnpm render:segments <id>`) draws only the segments the shots changed.
 */
import { readLog } from "@studio/project";
import { LIVE_STATUSES, MAX_CUSTOM_SHOTS } from "@studio/schema";
import { acceptShot, addShot, autoShots, compareModels, listShots, recheckShot, regenerateShot, rejectShot, suggest, type ShotResult } from "./custom-shots";
import { BusyError, withLock } from "./lock";
import { byStep, readUsage } from "./usage";

const args = process.argv.slice(2);
const flag = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const VALUE = ["model", "models", "source", "title"].map((f) => `--${f}`);
const pos = args.filter((a, i) => !a.startsWith("--") && !VALUE.includes(args[i - 1] ?? ""));
const [id, command, ...rest] = pos;
const fail = (m: string): never => {
  console.error(`✗ ${m}`);
  process.exit(1);
};
if (!id || !command) fail("usage: pnpm shots <id> list | suggest | add <scene> [note] | auto | regenerate <C1> <note> | accept|reject|recheck <C1> | log | compare <scenes> --models a,b");

const show = (r: ShotResult) => {
  const s = r.shot;
  console.log(`${s.status === "failed" ? "✗" : "✓"} ${s.id} on ${s.sceneId} · ${s.title} · ${s.status}${r.repaired ? " (repaired once)" : ""} · ${r.calls} Claude call${r.calls === 1 ? "" : "s"}`);
  if (s.reason) console.log(`  falls back to the library scene: ${s.reason.split("\n")[0]}`);
  if (s.check?.ok) console.log(`  drawn alone in 16:9 and 9:16: ${s.check.stills.landscape.length + s.check.stills.portrait.length} stills in custom/stills/${s.id}/${s.source}/, ${(s.check.renderMs / 1000).toFixed(1)} s`);
  for (const w of s.check?.warnings ?? []) console.log(`  note: ${w}`);
};

try {
  if (command === "list") {
    const shots = listShots(id!);
    if (!shots.length) console.log(`${id}: no custom shots`);
    for (const s of shots) {
      console.log(`${s.id}  ${s.sceneId.padEnd(5)} ${s.status.padEnd(9)} ${s.title}  [${s.model}, ${s.source}]${s.reason ? `\n      ${s.reason.split("\n")[0]}` : ""}`);
    }
    console.log(`${shots.filter((s) => LIVE_STATUSES.includes(s.status)).length} of ${MAX_CUSTOM_SHOTS} live`);
  } else if (command === "suggest") {
    for (const c of suggest(id!)) console.log(`${c.scene.padEnd(5)} score ${String(c.score).padStart(2)}  ${c.seconds.toFixed(1)} s  ${c.why}${c.revealAt ? `  (reveal on ${c.revealAt})` : ""}`);
  } else if (command === "add") {
    const scene = rest[0] ?? fail("which scene? pnpm shots <id> add <scene> [note]");
    const run = () => addShot(id!, { scene, note: rest[1], sourceFile: flag("source"), title: flag("title"), model: flag("model"), repair: !args.includes("--no-repair") });
    // a source from a file makes no Claude call, so it does not wait for the Claude lock
    const r = flag("source") ? await run() : await withLock(`custom shot for ${id}/${scene}`, run);
    show(r);
  } else if (command === "auto") {
    const rs = await withLock(`custom shots for ${id}`, () => autoShots(id!, { model: flag("model"), onShot: (r) => show(r) }));
    if (!rs.length) console.log("nothing to do: no free slot or no suggested moment");
  } else if (command === "regenerate") {
    const [shot, note] = rest;
    if (!shot || !note) fail('pnpm shots <id> regenerate <C1> "<note>"');
    const r = await withLock(`regenerate ${shot} of ${id}`, () => regenerateShot(id!, shot!, note!, { model: flag("model") }));
    if (r.kept) console.log(`✗ the new version failed (${r.problems?.[0]?.split("\n")[0]}); ${r.shot.id} keeps its last good source`);
    else show(r);
  } else if (command === "accept") {
    const s = acceptShot(id!, rest[0] ?? fail("which shot?"));
    console.log(`✓ ${s.id} accepted`);
  } else if (command === "reject") {
    const s = rejectShot(id!, rest[0] ?? fail("which shot?"), rest[1]);
    console.log(`✓ ${s.id} reverted: the library scene ${s.sceneId} is drawn`);
  } else if (command === "recheck") {
    const s = await recheckShot(id!, rest[0] ?? fail("which shot?"));
    console.log(`${s.status === "failed" ? "✗" : "✓"} ${s.id} ${s.status}${s.reason ? `: ${s.reason.split("\n")[0]}` : ""}`);
  } else if (command === "log") {
    for (const l of readLog(id!)) console.log(`${l.at}  ${l.shot} ${l.scene.padEnd(5)} ${l.event.padEnd(11)} ${l.kind ?? ""}  ${l.message.split("\n")[0]}`);
  } else if (command === "compare") {
    const scenes = (rest[0] ?? fail("which scenes? pnpm shots <id> compare S93,S47 --models sonnet,opus")).split(",");
    const models = (flag("models") ?? "sonnet,opus").split(",");
    const rows = await withLock(`compare custom shot models on ${id}`, () => compareModels(id!, { scenes, models }));
    for (const r of rows) console.log(`${r.model.padEnd(7)} ${r.scene.padEnd(5)} ${r.ok ? "✓" : "✗"} ${r.title} · ${r.attempts} call(s) · ${(r.durationMs / 1000).toFixed(0)} s · ${r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens} in / ${r.outputTokens} out · $${r.costUsd.toFixed(3)} · ${r.lines} lines${r.failure ? ` · ${r.failure.kind}: ${r.failure.message.split("\n")[0]}` : ""}`);
  } else fail(`unknown command "${command}"`);
  if (["add", "auto", "regenerate", "compare"].includes(command!)) console.log(`  Claude so far: ${JSON.stringify(byStep(readUsage(id!)).customshot ?? {})}`);
} catch (e) {
  if (e instanceof BusyError) fail(e.message);
  fail((e as Error).message);
}
process.exit(0);
