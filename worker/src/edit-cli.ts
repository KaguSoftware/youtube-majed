/**
 * The edit engine without the UI (Phase 4). Every operation of the edit
 * format (packages/schema/src/edit.ts), a commit per command.
 *
 *   pnpm edit <id> set S12 bg=office camera=zoom_face action=ines:panic expr=ines:shock weather=none
 *   pnpm edit <id> line L3.4 [text="…"] [energy=4] [delivery="…"] [seed=7]
 *   pnpm edit <id> cut-line L3.4
 *   pnpm edit <id> insert --after L3.4 [line="…" energy=3 delivery="…"] [scene=like:S12 action=ines:jump …] [lines=L3.5,L3.6]
 *   pnpm edit <id> sfx add <tag> L3.4:2 | sfx move <tag> L3.4:2 L3.5:0 | sfx delete <tag> L3.4:2
 *   pnpm edit <id> fx L3.4 <preset|none> [--word 2]          presets: chipmunk giant phone_call echo_thought robot underwater
 *   pnpm edit <id> trim S12 [start=1] [end=-1]
 *   pnpm edit <id> move S12 --after S10|--first
 *   pnpm edit <id> delete S12 merge|cut
 *   pnpm edit <id> apply edit.json                           an EditRequest {label?, ops: [...]}
 *   pnpm edit <id> check <any of the above>                  what it would do; nothing is changed
 *   pnpm edit <id> align                                     put every line start on a frame (once, for projects voiced before Phase 4)
 *   Claude: regenerate S12 "<note>" [--count 3] · pick <optionsId> <n> · beat "<words>" --after L3.4 [--check] · fix S3 "<note>" S9 "<note>"
 *
 *   pnpm edit <id> render preview|final|both                 draw the current version (only segments not in the cache)
 *
 *   Every command takes --label "…" and --render preview|final|both (draw the updated video after the commit).
 */
import { projectPaths } from "@studio/project";
import { EditRequest, FX_PRESETS, type EditOpIn } from "@studio/schema";
import { readFileSync } from "node:fs";
import { applyEdit, alignToFrames, checkEdit, EditError, type EditResult } from "./edit";
import { beatEdit, fixScenesEdit, pickOption, regenerateScene } from "./edit-claude";
import { BusyError, withLock } from "./lock";
import { exportVideo, renderPreview } from "./render";
import { readScenes } from "./storyboard";
import { VersionError } from "./versions";

const argv = process.argv.slice(2);
const [id, command, ...rest] = argv;
const has = (f: string) => rest.includes(`--${f}`);
const flag = (f: string) => (rest.includes(`--${f}`) ? rest[rest.indexOf(`--${f}`) + 1] : undefined);
const FLAGS = new Set(["--label", "--render", "--after", "--before", "--word", "--count"]);
const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && FLAGS.has(rest[i - 1]!)));
const pairs = (list: string[]) => Object.fromEntries(list.filter((a) => a.includes("=")).map((a) => [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]));

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}
const num = (v: string | undefined, what: string) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) fail(`${what} must be a whole number, not "${v}"`);
  return n;
};

/** `key=value` pairs → a scene.set patch. Characters: action=<castId>:<action>, expr=…, pos=…, to=… ("none" removes). */
function scenePatch(p: Record<string, string>) {
  const out: Record<string, unknown> = {};
  const chars = new Map<string, Record<string, unknown>>();
  for (const [k, v] of Object.entries(p)) {
    if (["action", "expr", "pos", "to", "facing", "look"].includes(k)) {
      const [who, what] = v.split(":");
      if (!who || !what) fail(`${k}=<castId>:<${k}>, e.g. ${k}=ines:${k === "action" ? "panic" : "shock"}`);
      chars.set(who!, { ...(chars.get(who!) ?? { id: who }), [k]: what === "none" ? null : what });
    } else if (["bg", "grade", "camera", "transitionIn", "transition", "caption"].includes(k)) out[k === "transition" ? "transitionIn" : k] = v;
    else if (k === "weather" || k === "framing") out[k] = v === "none" ? null : v;
    else if (k === "props" || k === "overlays") out[k] = JSON.parse(v);
    else if (!["text", "energy", "delivery", "seed", "line", "scene", "lines", "start", "end"].includes(k)) fail(`unknown field "${k}"`);
  }
  if (chars.size) out.chars = [...chars.values()];
  return out;
}

function opsFrom(cmd: string, args: string[]): EditOpIn[] {
  const p = pairs(args);
  const plain = args.filter((a) => !a.includes("="));
  switch (cmd) {
    case "set":
      return [{ op: "scene.set", scene: plain[0]!, ...scenePatch(p) } as EditOpIn];
    case "line":
      return [{ op: "line.set", line: plain[0]!, ...(p.text !== undefined ? { text: p.text } : {}), ...(p.energy ? { energy: num(p.energy, "energy") } : {}), ...(p.delivery !== undefined ? { delivery: p.delivery } : {}), ...(p.seed ? { seed: num(p.seed, "seed") } : {}) } as EditOpIn];
    case "cut-line":
      return [{ op: "line.delete", line: plain[0]! }];
    case "insert": {
      const anchor = flag("after") ? { after: flag("after") } : flag("before") ? { before: flag("before") } : {};
      let scene: Record<string, unknown> | undefined;
      if (p.scene) {
        if (!p.scene.startsWith("like:")) scene = JSON.parse(readFileSync(p.scene, "utf8"));
        else {
          const like = readScenes(id!)?.scenes.find((s) => s.id === p.scene!.slice(5));
          if (!like) fail(`there is no scene ${p.scene.slice(5)} to copy`);
          const { id: _i, lineIds: _l, sfx: _s, ...body } = like!;
          scene = { ...body, sfx: [] };
        }
        const patch = scenePatch(p);
        if (patch.chars) scene!.chars = (scene!.chars as { id: string }[]).map((c) => ({ ...c, ...Object.fromEntries(Object.entries((patch.chars as { id: string }[]).find((x) => x.id === c.id) ?? {}).filter(([, v]) => v !== null)) }));
        Object.assign(scene!, Object.fromEntries(Object.entries(patch).filter(([k, v]) => k !== "chars" && v !== null)));
        if (p.lines) scene!.lineIds = p.lines.split(",");
      }
      return [{ op: "insert", ...anchor, ...(p.line ? { line: { text: p.line, ...(p.energy ? { energy: num(p.energy, "energy") } : {}), ...(p.delivery ? { delivery: p.delivery } : {}) } } : {}), ...(scene ? { scene } : {}) } as EditOpIn];
    }
    case "sfx": {
      const [what, tag, a, b] = plain;
      if (what === "add") return [{ op: "sfx.add", tag: tag!, at: a! }];
      if (what === "move") return [{ op: "sfx.move", tag: tag!, from: a!, to: b! }];
      if (what === "delete") return [{ op: "sfx.delete", tag: tag!, at: a! }];
      return fail("sfx add|move|delete <tag> <word> [<to word>]");
    }
    case "fx": {
      const [line, preset] = plain;
      if (!line || !preset) fail(`fx <line> <preset|none> [--word N]. Presets: ${Object.keys(FX_PRESETS).join(", ")}`);
      return [{ op: "fx", line: line!, preset: preset as never, ...(flag("word") !== undefined ? { word: num(flag("word"), "word") } : {}) }];
    }
    case "trim":
      return [{ op: "scene.trim", scene: plain[0]!, ...(p.start ? { start: num(p.start, "start") } : {}), ...(p.end ? { end: num(p.end, "end") } : {}) }];
    case "move":
      return [{ op: "scene.move", scene: plain[0]!, after: has("first") ? null : flag("after")! }];
    case "delete":
      return [{ op: "scene.delete", scene: plain[0]!, lines: plain[1] as "merge" | "cut" }];
    case "apply": {
      const req = EditRequest.safeParse(JSON.parse(readFileSync(plain[0]!, "utf8")));
      if (!req.success) fail(`${plain[0]} is not an edit: ${req.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return req.data.ops;
    }
  }
  return fail(`unknown command "${cmd}". See the top of worker/src/edit-cli.ts`);
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function printResult(r: EditResult, t0: number) {
  const v = r.version;
  const c = v.changes;
  console.log(`✓ version ${v.n}: ${v.label}`);
  if (c) {
    const parts = [
      c.scenes.added.length && `scenes added ${c.scenes.added.join(", ")}`,
      c.scenes.removed.length && `scenes removed ${c.scenes.removed.join(", ")}`,
      Object.keys(c.scenes.changed).length && `scenes changed ${Object.entries(c.scenes.changed).map(([k, f]) => `${k} (${f.join(", ")})`).join(", ")}`,
      c.lines.added.length && `lines added ${c.lines.added.join(", ")}`,
      c.lines.removed.length && `lines cut ${c.lines.removed.join(", ")}`,
      Object.keys(c.lines.changed).length && `lines changed ${Object.keys(c.lines.changed).join(", ")}`,
      c.voiced.length && `takes changed ${c.voiced.join(", ")}`,
      (c.cues.added.length || c.cues.removed.length || c.cues.moved.length) && `cues +${c.cues.added.length} −${c.cues.removed.length} moved ${c.cues.moved.length}`,
      c.durationS.from !== c.durationS.to && `length ${c.durationS.from?.toFixed(2)} → ${c.durationS.to?.toFixed(2)} s`,
    ].filter(Boolean);
    for (const part of parts) console.log(`  ${part}`);
  }
  for (const n of r.notes) console.log(`  note: ${n}`);
  console.log(`  voiced ${r.voiced.length} line(s) (${r.generated} new take${r.generated === 1 ? "" : "s"}) ${secs(r.timings.voiceMs)} · track ${r.assembled ? secs(r.timings.trackMs) : "unchanged"} · mix ${r.mixCached ? "cached" : secs(r.timings.mixMs)} · edit ${secs(Date.now() - t0)}`);
}

async function renderAfter(t0: number, which = flag("render")) {
  if (!which) return;
  const ac = new AbortController();
  const report = () => {};
  if (which === "preview" || which === "both") {
    const r = await renderPreview(id!, { signal: ac.signal, report });
    console.log(`  preview: ${r.segments ? `drew ${r.segments.drawn} of ${r.segments.total} segments (${r.segments.framesDrawn} frames)` : "full render"} in ${secs(r.timings.totalMs)} → ${r.file} · ${secs(Date.now() - t0)} since the command`);
  }
  if (which === "final" || which === "both") {
    const r = await exportVideo(id!, { signal: ac.signal, report });
    console.log(`  final: ${r.segments ? `drew ${r.segments.drawn} of ${r.segments.total} segments (${r.segments.framesDrawn} frames)` : "full render"}, ${(r.media.sizeBytes / 1_048_576).toFixed(1)} MB, CRF ${r.encode.crf}${r.encode.reencoded ? " (re-encoded over the cap)" : ""}, ${r.media.video.width}×${r.media.video.height} ${r.media.video.profile}, fast start ${r.media.fastStart} in ${secs(r.timings.totalMs)} → ${r.file} · ${secs(Date.now() - t0)} since the command`);
  }
}

async function main() {
  if (!id || !command) fail("usage: pnpm edit <id> <command> … (see worker/src/edit-cli.ts)");
  projectPaths(id!);
  const t0 = Date.now();
  const label = flag("label");
  const report = (p: { label: string; detail?: string }) => process.stdout.isTTY && process.stdout.write(`\r  … ${p.label}${p.detail ? `: ${p.detail}` : ""}`.padEnd(70) + "\r");
  if (command === "check") {
    const [cmd, ...args] = positional;
    const r = checkEdit(id!, { ops: opsFrom(cmd!, args) });
    console.log(`✓ the edit is possible: ${r.voice.length ? `voices ${r.voice.join(", ")}` : "voices nothing"}, ${r.assemble ? "re-assembles the track" : "keeps the track"}, ${r.scenes} scenes, ${r.lines} lines${r.notes.length ? `\n  ${r.notes.join("\n  ")}` : ""}`);
    return;
  }
  await withLock(`edit ${id}: ${command}`, async () => {
    if (command === "render") {
      if (!["preview", "final", "both"].includes(positional[0] ?? "")) fail("render preview|final|both");
      await renderAfter(t0, positional[0]);
      return;
    } else if (command === "align") {
      const v = await alignToFrames(id!, { force: has("force") });
      console.log(`✓ version ${v.n}: ${v.label} (${v.changes?.durationS.from} → ${v.changes?.durationS.to} s) · ${secs(Date.now() - t0)}`);
    } else if (command === "regenerate") {
      const [scene, note] = positional;
      const o = await regenerateScene(id!, scene!, note ?? "", { count: num(flag("count"), "count") ?? 3 });
      console.log(`✓ ${o.options.length} options for ${o.sceneId} (pick one: pnpm edit ${id} pick ${o.id} <n>)`);
      o.options.forEach((x, i) => console.log(`  ${i + 1}. ${x.why}${x.flags.length ? `  [${x.flags.join("; ")}]` : ""}\n     ${JSON.stringify(x.op).slice(0, 220)}`));
      console.log(`  ${secs(Date.now() - t0)}`);
      return;
    } else if (command === "pick") {
      const [optionsId, n] = positional;
      printResult(await pickOption(id!, optionsId!, num(n, "option")!, { report, ...(label ? { label } : {}) }), t0);
    } else if (command === "beat") {
      const r = await beatEdit(id!, positional[0]!, { after: flag("after"), before: flag("before"), dryRun: has("check"), report, ...(label ? { label } : {}) });
      if ("ops" in r) {
        console.log(`✓ the beat as operations (not applied):\n${JSON.stringify(r.ops, null, 2)}`);
        return;
      }
      printResult(r, t0);
    } else if (command === "fix") {
      const items: { scene: string; note: string }[] = [];
      for (let i = 0; i < positional.length; i += 2) items.push({ scene: positional[i]!, note: positional[i + 1] ?? "" });
      printResult(await fixScenesEdit(id!, items, { report, ...(label ? { label } : {}) }), t0);
    } else {
      printResult(await applyEdit(id!, { ...(label ? { label } : {}), ops: opsFrom(command!, positional) }, { report }), t0);
    }
    await renderAfter(t0);
  });
}

main().catch((e) => {
  if (e instanceof EditError || e instanceof VersionError || e instanceof BusyError) fail(e.message);
  if ((e as Error).name === "ValidationError" || (e as Error).name === "RenderError" || (e as Error).name === "ClaudeGate") fail((e as Error).message);
  console.error(e);
  process.exit(1);
});
