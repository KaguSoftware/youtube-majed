/**
 * The edit engine (docs/PLAN.md section 8, Phase 4): an EditRequest is
 * applied to a draft copy of the current version (src/edit-ops.ts), checked,
 * and committed as a new version (src/versions.ts). Only what the edit
 * touched is redone:
 *
 *   1. voice   lines whose text, energy or seed changed, and new lines, get a
 *              take from the audio service (POST /line, cached by key). Every
 *              other line keeps its take.
 *   2. track   when a take, the order of lines or a voice effect changed, the
 *              takes are assembled and mastered again (audio/studio_audio/track.py,
 *              a child process, no model): about 25 s for a 6-minute video.
 *              Effects are applied and cached there. Every line starts on a
 *              frame, so later scenes move by whole frames.
 *   3. mix     re-planned from the draft (worker/src/mix.ts) and mixed only
 *              if the plan is new (cached by plan hash).
 *   4. commit  a new version; its files become the working files.
 *
 * Pictures are not drawn here: the render step (src/render.ts, segments)
 * draws only the segments whose content changed.
 */
import { projectPaths, readJson } from "@studio/project";
import {
  EditRequest,
  FxFile,
  LineId,
  NarrationFile,
  SceneFile,
  ScriptFile,
  StoryboardFile,
  VoiceFile,
  formatIssues,
  validateProject,
  type EditOp,
  type Version,
} from "@studio/schema";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readAssets } from "./assets";
import { applyOps, EditError, type Draft, type Overrides } from "./edit-ops";
import { runChild, ChildError } from "./media";
import { mixPlan, planMix } from "./mix";
import type { JobProgress } from "./queue";
import { audioUrl } from "./voice-run";
import { commit, ensureVersions, objectText, storeNarration, versionFile, versionPaths } from "./versions";
import { REPO_DIR } from "@studio/project";

export { EditError };

const Overrides = z.record(LineId, z.strictObject({ seed: z.int().optional(), energy: z.int().min(1).max(5).optional() }));
const BLANK_FX = { version: 1 as const, lines: {} };

/** A version's files as a draft to edit. */
export function loadDraft(id: string, v: Version): Draft & { voice: VoiceFile } {
  const get = <S extends z.ZodType>(file: Parameters<typeof versionFile>[2], schema: S, label: string): z.output<S> | undefined => {
    const raw = versionFile(id, v, file);
    if (raw === undefined) return undefined;
    const r = schema.safeParse(raw);
    if (!r.success) throw new EditError(`version ${v.n}: ${formatIssues(label, raw, r.error.issues).slice(0, 5).join("; ")}`);
    return r.data;
  };
  const script = get("script.json", ScriptFile, "script.json");
  const scenes = get("storyboard/scenes.json", SceneFile, "scenes.json");
  const voice = get("audio/voice.json", VoiceFile, "voice.json");
  const report = get("storyboard/storyboard.json", StoryboardFile, "storyboard.json");
  if (!script || !scenes || !voice) throw new EditError(`version ${v.n} has no script, scenes or voice`);
  if (!report) throw new EditError(`version ${v.n} has no storyboard report (storyboard/storyboard.json)`);
  return {
    script,
    narration: get("story/narration.json", NarrationFile, "narration.json"),
    scenes,
    report,
    overrides: get("audio/overrides.json", Overrides, "overrides.json") ?? {},
    fx: get("audio/fx.json", FxFile, "fx.json") ?? BLANK_FX,
    voice,
  };
}

/** The take key from a voice.json line ("lines/L3.4.<key>.wav"). */
export const takeKey = (file: string) => /\.([0-9a-f]{12})\.wav$/.exec(file)?.[1] ?? "";

// ---------------------------------------------------------------- voicing

const Take = z.object({ id: z.string(), key: z.string(), state: z.enum(["cached", "generated"]), duration: z.number(), quality: z.object({ status: z.enum(["ok", "warn", "fail"]), issues: z.array(z.string()) }) });

/** Which lines need a new take: new lines, and lines whose text, effective energy or asked-for seed differ from their take. */
export function linesToVoice(d: Draft, voice: VoiceFile): string[] {
  const voiced = new Map(voice.lines.map((l) => [l.id, l]));
  return d.script.lines
    .filter((l) => {
      const v = voiced.get(l.id);
      const ov = d.overrides[l.id];
      return !v || v.text !== l.text || v.energy !== (ov?.energy ?? l.energy) || (ov?.seed !== undefined && ov.seed !== v.seed);
    })
    .map((l) => l.id);
}

async function voiceLines(id: string, d: Draft, ids: string[], o: { signal?: AbortSignal; report: (p: JobProgress) => void }): Promise<Map<string, { key: string; generated: boolean; status: string }>> {
  const out = new Map<string, { key: string; generated: boolean; status: string }>();
  if (!ids.length) return out;
  const base = audioUrl();
  const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => undefined);
  if (!health?.ok) throw new EditError(`this edit voices ${ids.join(", ")}, and the audio service is not running at ${base}. Start it:\n    cd audio && uv run python -m studio_audio.server`);
  for (const [i, lineId] of ids.entries()) {
    o.report({ label: "Voicing the changed lines", done: i, total: ids.length, detail: lineId });
    const line = d.script.lines.find((l) => l.id === lineId)!;
    const ov = d.overrides[lineId];
    const res = await fetch(`${base}/line`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outDir: projectPaths(id).audioDir, id: lineId, text: line.text, energy: ov?.energy ?? line.energy, ...(ov?.seed === undefined ? {} : { seed: ov.seed }) }),
      signal: AbortSignal.any([AbortSignal.timeout(10 * 60_000), ...(o.signal ? [o.signal] : [])]),
    });
    if (!res.ok) throw new EditError(`the audio service could not voice ${lineId}: ${(await res.text()).slice(0, 400)}`);
    const take = Take.parse(await res.json());
    out.set(lineId, { key: take.key, generated: take.state === "generated", status: take.quality.status });
  }
  return out;
}

// ---------------------------------------------------------------- the track

export type Order = { id: string; key: string; fx?: { preset: string; word?: number }[] }[];

const sameOrder = (a: Order, b: Order) => JSON.stringify(a) === JSON.stringify(b);

export function orderOf(voice: VoiceFile): Order {
  return voice.lines.map((l) => ({ id: l.id, key: takeKey(l.file), ...(l.fx ? { fx: l.fx.effects } : {}) }));
}

export async function assembleTrack(id: string, voice: VoiceFile, order: Order, signal?: AbortSignal): Promise<{ voice: VoiceFile; narration: string; fxMade: string[] }> {
  const vp = versionPaths(id);
  const work = join(vp.work, `${Date.now()}-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const req = join(work, "track.json");
  const narration = join(work, "narration.wav");
  const voiceOut = join(work, "voice.json");
  writeFileSync(req, JSON.stringify({ outDir: projectPaths(id).audioDir, lines: order, engine: voice.engine, reference: voice.reference, aligner: voice.aligner, narration, voice: voiceOut }));
  let stdout = "";
  try {
    ({ stdout } = await runChild("uv", ["run", "--no-sync", "python", "-m", "studio_audio.track", req], { cwd: join(REPO_DIR, "audio"), signal }));
  } catch (e) {
    rmSync(work, { recursive: true, force: true });
    if (e instanceof ChildError && e.message !== "cancelled") throw new EditError(`the narration track could not be assembled:\n${e.tail}`);
    throw e;
  }
  const done = z.object({ fxMade: z.array(z.string()) }).parse(JSON.parse(stdout.trim().split("\n").at(-1)!));
  const parsed = readJson(voiceOut, VoiceFile)!;
  const hash = storeNarration(id, narration);
  rmSync(work, { recursive: true, force: true });
  return { voice: parsed, narration: join(vp.narrationStore, `${hash}.wav`), fxMade: done.fxMade };
}

// ---------------------------------------------------------------- the edit

export type EditResult = {
  version: Version;
  notes: string[];
  voiced: string[];
  generated: number;
  assembled: boolean;
  mixCached: boolean;
  timings: { voiceMs: number; trackMs: number; mixMs: number; totalMs: number };
};

export type EditOptions = { signal?: AbortSignal; report?: (p: JobProgress) => void; kind?: Version["kind"] };

/** Applies an edit and commits it as a new version. Throws EditError (and changes nothing) when the edit is not possible. */
export async function applyEdit(id: string, request: unknown, o: EditOptions = {}): Promise<EditResult> {
  const t0 = Date.now();
  const report = o.report ?? (() => {});
  const r = EditRequest.safeParse(request);
  if (!r.success) throw new EditError(`the edit is not valid: ${r.error.issues.map((i) => `${i.path.join(".") || "edit"}: ${i.message}`).join("; ")}`);
  const req = r.data;
  report({ label: "Checking the edit", done: 0, total: 1 });
  const head = ensureVersions(id);
  const base = loadDraft(id, head);
  const assets = readAssets();
  const { draft, ctx } = applyOps(base, req.ops, { sfxTags: [...new Set(assets.filter((a) => a.kind === "sfx").flatMap((a) => a.tags))] });

  // 1. voice
  const tv = Date.now();
  const need = linesToVoice(draft, base.voice);
  const takes = await voiceLines(id, draft, need, { signal: o.signal, report });
  const voiceMs = Date.now() - tv;

  // 2. the track, only when what it is made of changed
  const tt = Date.now();
  const keys = new Map(base.voice.lines.map((l) => [l.id, takeKey(l.file)]));
  const order: Order = draft.script.lines.map((l) => {
    const fx = draft.fx.lines[l.id];
    return { id: l.id, key: takes.get(l.id)?.key ?? keys.get(l.id)!, ...(fx ? { fx } : {}) };
  });
  let voice = base.voice;
  let narration = head.media.narration ? join(versionPaths(id).narrationStore, `${head.media.narration}.wav`) : projectPaths(id).narration;
  let fxMade: string[] = [];
  const assembled = !sameOrder(order, orderOf(base.voice));
  if (assembled) {
    report({ label: "Assembling the narration track", done: 0, total: 1, detail: need.length ? `with ${need.length} new take${need.length > 1 ? "s" : ""}` : "same takes, new order or effects" });
    ({ voice, narration, fxMade } = await assembleTrack(id, base.voice, order, o.signal));
  }
  const trackMs = Date.now() - tt;

  // the whole project, as Remotion will read it
  const check = validateProject({ scenes: draft.scenes, script: draft.script, voice });
  if (!check.ok) throw new EditError(`the edited project does not validate:\n  - ${check.errors.join("\n  - ")}`);

  // 3. mix (cached by plan)
  const tm = Date.now();
  report({ label: "Mixing the sound", done: 0, total: 1 });
  const plan = planMix({ project: id, scenes: draft.scenes, report: draft.report, voice, narration, assets });
  const mix = await mixPlan(id, plan, { signal: o.signal });
  const mixMs = Date.now() - tm;

  // 4. commit
  const narrationHash = /([0-9a-f]{64})\.wav$/.exec(narration)?.[1] ?? head.media.narration;
  const version = commit(id, {
    kind: o.kind ?? "edit",
    label: req.label ?? describe(req.ops),
    ops: req.ops,
    files: {
      "script.json": draft.script,
      ...(draft.narration ? { "story/narration.json": draft.narration } : {}),
      "storyboard/scenes.json": draft.scenes,
      "storyboard/storyboard.json": draft.report,
      "audio/voice.json": voice,
      ...(Object.keys(draft.overrides).length ? { "audio/overrides.json": draft.overrides } : {}),
      ...(Object.keys(draft.fx.lines).length ? { "audio/fx.json": draft.fx } : {}),
      "audio/mixplan.json": plan,
      "audio/mix.json": readFileSync(mix.json, "utf8"), // byte for byte the cache's copy, which is what the mix step writes
    },
    media: { narration: narrationHash, mix: mix.key },
    work: { linesVoiced: need.length, takesGenerated: [...takes.values()].filter((t) => t.generated).length, effectsMade: fxMade.length, voiceMs, trackMs, mixMs, mixCached: mix.cached ? 1 : 0 },
  });
  report({ label: "Committed", done: 1, total: 1, detail: `version ${version.n}` });
  return { version, notes: ctx.notes, voiced: need, generated: [...takes.values()].filter((t) => t.generated).length, assembled, mixCached: mix.cached, timings: { voiceMs, trackMs, mixMs, totalMs: Date.now() - t0 } };
}

/** What an edit would do, without voicing, mixing or committing anything. */
export function checkEdit(id: string, request: unknown): { ok: true; voice: string[]; assemble: boolean; notes: string[]; scenes: number; lines: number } {
  const r = EditRequest.safeParse(request);
  if (!r.success) throw new EditError(`the edit is not valid: ${r.error.issues.map((i) => `${i.path.join(".") || "edit"}: ${i.message}`).join("; ")}`);
  const head = ensureVersions(id);
  const base = loadDraft(id, head);
  const assets = readAssets();
  const { draft, ctx } = applyOps(base, r.data.ops, { sfxTags: [...new Set(assets.filter((a) => a.kind === "sfx").flatMap((a) => a.tags))] });
  const voice = linesToVoice(draft, base.voice);
  const keys = new Map(base.voice.lines.map((l) => [l.id, takeKey(l.file)]));
  const order: Order = draft.script.lines.map((l) => ({ id: l.id, key: voice.includes(l.id) ? "new" : keys.get(l.id)!, ...(draft.fx.lines[l.id] ? { fx: draft.fx.lines[l.id] } : {}) }));
  return { ok: true, voice, assemble: !sameOrder(order, orderOf(base.voice)), notes: ctx.notes, scenes: draft.scenes.scenes.length, lines: draft.script.lines.length };
}

/** A short label from the operations, when the edit has none. */
export function describe(ops: readonly EditOp[]): string {
  const one = (op: EditOp): string => {
    switch (op.op) {
      case "scene.set": return `${op.scene}: ${Object.keys(op).filter((k) => !["op", "scene"].includes(k)).join(", ")}`;
      case "scene.replace": return `${op.scene} replaced`;
      case "line.set": return `${op.line}: ${["text", "energy", "delivery", "seed"].filter((k) => k in op).join(", ")}`;
      case "line.delete": return `${op.line} cut`;
      case "insert": return `insert ${op.line ? "a line" : ""}${op.line && op.scene ? " and " : ""}${op.scene ? "a scene" : ""} ${op.after ? `after ${op.after}` : op.before ? `before ${op.before}` : ""}`.trim();
      case "sfx.add": return `sound ${op.tag} on ${op.at}`;
      case "sfx.move": return `sound ${op.tag} ${op.from} → ${op.to}`;
      case "sfx.delete": return `sound ${op.tag} off ${op.at}`;
      case "fx": return `${op.preset === "none" ? "no effect" : op.preset} on ${op.line}${op.word === undefined ? "" : ` word ${op.word}`}`;
      case "scene.trim": return `${op.scene} trimmed`;
      case "scene.move": return `${op.scene} moved after ${op.after ?? "the loop start"}`;
      case "scene.delete": return `${op.scene} deleted (${op.lines === "cut" ? "with its lines" : "lines kept"})`;
    }
  };
  const text = ops.map(one).join("; ");
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** Re-assembles the track with every line on a frame (projects voiced before Phase 4), as its own version. */
export async function alignToFrames(id: string, o: EditOptions & { force?: boolean } = {}): Promise<Version> {
  const head = ensureVersions(id);
  const base = loadDraft(id, head);
  if (base.voice.pauses.frameRate && !o.force) throw new EditError(`${id}'s lines already start on frames (--force assembles the track again anyway)`);
  const { voice, narration } = await assembleTrack(id, base.voice, orderOf(base.voice), o.signal);
  const plan = planMix({ project: id, scenes: base.scenes, report: base.report, voice, narration, assets: readAssets() });
  const mix = await mixPlan(id, plan, { signal: o.signal });
  const files = Object.fromEntries(Object.entries(head.files).map(([f, h]) => [f, objectText(id, h!)]));
  return commit(id, {
    kind: "edit",
    label: "every line starts on a video frame",
    files: { ...files, "audio/voice.json": voice, "audio/mixplan.json": plan, "audio/mix.json": readFileSync(mix.json, "utf8") },
    media: { narration: /([0-9a-f]{64})\.wav$/.exec(narration)![1]!, mix: mix.key },
  });
}

