/**
 * Custom shots (docs/PLAN.md section 6, Phase 5): up to three per video, a
 * one-off Remotion component Claude writes for a moment the library cannot
 * show well, with a safe fallback to the library scene.
 *
 *   suggest   which scenes deserve one (code: head fakes, the ending twist)
 *   add       Claude writes the shot (skill custom-shot) → checks → the manifest
 *   regenerate  the same, with a note, for a shot that exists; a failed try never replaces a good shot
 *   accept / reject  your verdict; reject is "revert to the library scene"
 *   compare   try models on the same moments without touching the manifest
 *
 * Every shot is checked before it is drawn in a video, in this order, and the
 * first failure puts the library scene back (status `failed`, the reason in
 * the manifest and in custom/log.jsonl):
 *
 *   1. import rule  remotion, react and the library only (packages/project/src/shot-lint.ts)
 *   2. typecheck    tsc on the shot file
 *   3. alone        scripts/check-shot.ts draws it in a browser of its own in 16:9 and 9:16,
 *                   under a time limit (STUDIO_SHOT_TIMEOUT_S, 120): a crash, a hang or blank
 *                   frames fail it
 *
 * The manifest, sources and stills are in projects/<id>/custom/ (format:
 * CustomShotsFile in @studio/schema); the scene JSON is never touched.
 */
import {
  REPO_DIR,
  appendLog,
  customPaths,
  liveShots,
  nextShotId,
  projectPaths,
  readShots,
  readSource,
  renderCodeHash,
  saveSource,
  storyboardPaths,
  writeJson,
  writeShots,
  lintShot,
  packageBin,
  scratchEnv,
} from "@studio/project";
import {
  CustomShotOutput,
  LIVE_STATUSES,
  MAX_CUSTOM_SHOTS,
  validateProject,
  type CustomShot,
  type FailureKind,
  type Project,
  type ShotCheck,
} from "@studio/schema";
import { shotPropsFor } from "@studio/remotion/src/custom/host";
import { buildTimeline } from "@studio/remotion/src/scene/timeline";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { callStep } from "./call";
import { modelFor } from "./claude";
import { ChildError, runChild } from "./media";
import { libraryForClaude, loadStory, readStoryboard, type SLine } from "./storyboard";
import { readUsage } from "./usage";

export class ShotError extends Error {
  override name = "ShotError";
}

export const SHOT_TIMEOUT_MS = () => Number(process.env.STUDIO_SHOT_TIMEOUT_S ?? 120) * 1000;
const now = () => new Date().toISOString();

// ---------------------------------------------------------------- the project as the shots see it

export function readProject(id: string): Project {
  const p = projectPaths(id);
  const sb = storyboardPaths(id);
  const read = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined);
  const v = validateProject({ scenes: read(sb.scenes), script: read(p.scriptJson), voice: read(p.voiceJson) });
  if (!v.ok) throw new ShotError(`${id} is not ready for custom shots: ${v.errors.slice(0, 3).join("; ")}`);
  if (!v.data.voice) throw new ShotError(`${id} has not been voiced: a shot reacts to word timing`);
  return v.data;
}

const indexOfScene = (project: Project, sceneId: string): number => {
  const i = project.scenes.scenes.findIndex((s) => s.id === sceneId);
  if (i < 0) throw new ShotError(`${project.scenes.title}: there is no scene ${sceneId}`);
  return i;
};

// ---------------------------------------------------------------- which moments

export type Candidate = { scene: string; why: string; score: number; seconds: number; revealAt: string | null };

const MIN_SHOT_FRAMES = 45;

/** Scenes a custom shot is worth writing for, best first, spread through the video: the ending twist, then head fakes. */
export function suggest(id: string, n: number = MAX_CUSTOM_SHOTS): Candidate[] {
  const project = readProject(id);
  const story = loadStory(id);
  const timeline = buildTimeline(project);
  const reveals = readStoryboard(id)?.reveals ?? [];
  const lineInfo = new Map<string, { line: SLine; last: boolean }>();
  story.loops.forEach((loop, i) => loop.lines.forEach((line) => lineInfo.set(line.id, { line, last: i === story.loops.length - 1 })));
  const taken = new Set(liveShots(id).map((s) => s.sceneId));
  const scored: Candidate[] = [];
  project.scenes.scenes.forEach((scene, i) => {
    const t = timeline.scenes[i]!;
    if (t.frames < MIN_SHOT_FRAMES || taken.has(scene.id)) return;
    let score = 0;
    const why: string[] = [];
    let revealAt: string | null = null;
    for (const lid of scene.lineIds) {
      const info = lineInfo.get(lid);
      if (!info) continue;
      const head = info.line.beats.includes("headfake") || info.line.payoffs.length > 0;
      if (head && info.last) {
        score += 10;
        why.push(`the ending twist (${lid})`);
      } else if (head) {
        score += 4;
        why.push(`a head fake (${lid}${info.line.payoffs.length ? `, pays off ${info.line.payoffs.join(", ")}` : ""})`);
      }
      if (info.line.energy >= 5) score += 2;
      score += info.line.payoffs.length;
      revealAt ??= reveals.find((r) => r.lineId === lid)?.at ?? null;
    }
    if (score > 0) scored.push({ scene: scene.id, why: why.join("; "), score, seconds: t.frames / timeline.fps, revealAt });
  });
  scored.sort((a, b) => b.score - a.score);
  const picked: Candidate[] = [];
  const startOf = (c: Candidate) => timeline.scenes[indexOfScene(project, c.scene)]!.start / timeline.fps;
  for (const c of scored) {
    if (picked.length >= n) break;
    if (picked.every((p) => Math.abs(startOf(p) - startOf(c)) >= 25)) picked.push(c); // a shot per ~25 s at most, so they do not crowd
  }
  return picked;
}

// ---------------------------------------------------------------- the Claude step

type Prior = { source: string; problems: string[]; note?: string };

/** What the step is given for one scene. Frames are relative to the scene's first frame. */
export function buildInput(id: string, sceneId: string, o: { note?: string; revealAt?: string | null; moment?: string; prior?: Prior } = {}) {
  const project = readProject(id);
  const i = indexOfScene(project, sceneId);
  const story = loadStory(id);
  const timeline = buildTimeline(project);
  const props = shotPropsFor(project, timeline, i);
  const lineMeta = new Map(story.loops.flatMap((l) => l.lines).map((l) => [l.id, l]));
  const brief = (idx: number) => {
    const s = project.scenes.scenes[idx];
    return s ? { id: s.id, bg: s.bg, grade: s.grade, camera: s.camera, chars: s.chars.map((c) => `${c.id}: ${c.action}/${c.expr} at ${c.pos}`), lines: s.lineIds.map((lid) => lineMeta.get(lid)?.text ?? "") } : null;
  };
  return {
    video: { title: story.video.title, narrative: story.video.narrative, format: story.video.format },
    moment: { why: o.moment ?? "chosen by the editor", revealAt: o.revealAt ?? null },
    scene: props.scene,
    frames: props.frames,
    fps: props.fps,
    lines: props.lines.map((l) => {
      const meta = lineMeta.get(l.id);
      return {
        id: l.id,
        text: l.text,
        energy: meta?.energy ?? 3,
        delivery: meta?.delivery ?? "",
        beats: meta?.beats ?? [],
        plants: meta?.plants ?? [],
        payoffs: meta?.payoffs ?? [],
        start: l.start,
        end: l.end,
        words: props.words.filter((w) => w.lineId === l.id).map((w) => ({ at: `${w.lineId}:${w.index}`, text: w.text, start: w.start, end: w.end })),
      };
    }),
    cast: props.cast,
    before: brief(i - 1),
    after: brief(i + 1),
    library: libraryForClaude(["backgrounds", "grades", "actions", "expressions", "props", "cameras"]),
    note: o.note ?? "",
    ...(o.prior ? { previous: o.prior } : {}),
  };
}

/** Every problem code can see before anything is drawn: the import rule, and word references that do not exist. */
function problemsOf(out: CustomShotOutput, wordRefs: ReadonlySet<string>): string[] {
  const lint = lintShot(out.source);
  const bad = out.timing.filter((t) => !wordRefs.has(t.at)).map((t) => `timing "${t.at}" is not a word of this scene (words: ${[...wordRefs].slice(0, 40).join(", ")})`);
  return [...lint.errors.map((e) => `import rule: ${e}`), ...bad];
}

/** One `customshot` call, on the model asked for (or the step's default: STUDIO_CLAUDE_MODEL_CUSTOMSHOT, else sonnet). */
async function write(id: string, input: ReturnType<typeof buildInput>, o: { model?: string; signal?: AbortSignal }): Promise<CustomShotOutput> {
  const refs = new Set(input.lines.flatMap((l) => l.words.map((w) => w.at)));
  const was = process.env.STUDIO_CLAUDE_MODEL_CUSTOMSHOT;
  if (o.model) process.env.STUDIO_CLAUDE_MODEL_CUSTOMSHOT = o.model;
  try {
    return await callStep({ project: id, step: "customshot", input, signal: o.signal, softCheck: (out) => problemsOf(out, refs) });
  } finally {
    if (o.model) {
      if (was === undefined) delete process.env.STUDIO_CLAUDE_MODEL_CUSTOMSHOT;
      else process.env.STUDIO_CLAUDE_MODEL_CUSTOMSHOT = was;
    }
  }
}

// ---------------------------------------------------------------- the checks


function failedCheck(kind: FailureKind, message: string, ms: number): ShotCheck {
  return { at: now(), codeHash: renderCodeHash(), inputs: "", ok: false, failure: { kind, message }, imports: [], stills: { landscape: [], portrait: [] }, renderMs: ms, warnings: [] };
}

/**
 * Runs scripts/check-shot.ts on a source file for a scene, in a child process with the time limit: a shot that
 * hangs is killed with its whole process group, Chrome included, and fails as `timeout`.
 */
export async function runShotCheck(id: string, o: { scene: string; sourceFile: string; stillsSub: string; cues?: string[]; stillsRoot?: string; signal?: AbortSignal }): Promise<ShotCheck> {
  const limit = SHOT_TIMEOUT_MS();
  const timer = AbortSignal.timeout(limit);
  const signal = o.signal ? AbortSignal.any([o.signal, timer]) : timer;
  const started = Date.now();
  const args = [join(REPO_DIR, "remotion", "scripts", "check-shot.ts"), id, "--scene", o.scene, "--source", o.sourceFile, "--stills-sub", o.stillsSub, "--stills-root", o.stillsRoot ?? customPaths(id).stillsDir];
  if (o.cues?.length) args.push("--cues", o.cues.join(","));
  let result: ShotCheck | undefined;
  // the checker's bundle and browser profile go in a folder of its own, removed afterwards even if the shot had to be killed
  const scratch = mkdtempSync(join(tmpdir(), "studio-shot-"));
  try {
    const [node, tsxEntry] = packageBin(join(REPO_DIR, "remotion"), "tsx");
    await runChild(node, [...tsxEntry, ...args], {
      cwd: join(REPO_DIR, "remotion"),
      env: scratchEnv(scratch),
      signal,
      onLine: (line) => {
        if (!line.startsWith("{")) return;
        try {
          const parsed = JSON.parse(line) as { event?: string; check?: ShotCheck };
          if (parsed.event === "result" && parsed.check) result = parsed.check;
        } catch {
          /* progress noise */
        }
      },
    });
  } catch (e) {
    if (timer.aborted) return failedCheck("timeout", `the shot did not finish drawing within ${limit / 1000} s and was stopped`, Date.now() - started);
    if (o.signal?.aborted) throw e;
    if (!result) return failedCheck("crash", `the checker died: ${e instanceof ChildError ? `${e.message} ${e.tail.slice(-300)}` : (e as Error).message}`, Date.now() - started);
  }
  finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return result ?? failedCheck("crash", "the checker printed no result", Date.now() - started);
}

// ---------------------------------------------------------------- the manifest

const event = (shot: CustomShot, e: CustomShot["history"][number]["event"], detail: string) => shot.history.push({ at: now(), event: e, detail });

function liveCount(id: string, except?: string): number {
  return readShots(id).shots.filter((s) => LIVE_STATUSES.includes(s.status) && s.id !== except).length;
}

function assertRoom(id: string, sceneId: string, except?: string): void {
  if (liveCount(id, except) >= MAX_CUSTOM_SHOTS) throw new ShotError(`${id} already has ${MAX_CUSTOM_SHOTS} custom shots, the limit; revert one to the library scene first`);
  const onScene = readShots(id).shots.find((s) => s.sceneId === sceneId && LIVE_STATUSES.includes(s.status) && s.id !== except);
  if (onScene) throw new ShotError(`scene ${sceneId} already has custom shot ${onScene.id}; regenerate it instead`);
}

export type ShotResult = { shot: CustomShot; calls: number; repaired: boolean; kept?: boolean; problems?: string[] };

type Source = { title: string; idea: string; timing: CustomShotOutput["timing"]; source: string };

/** Saves a source and checks it; the stills land in custom/stills/<shotId>/<hash>/. */
async function checkSource(id: string, shotId: string, sceneId: string, src: Source, signal?: AbortSignal): Promise<{ hash: string; check: ShotCheck }> {
  const hash = saveSource(id, src.source);
  const check = await runShotCheck(id, { scene: sceneId, sourceFile: join(customPaths(id).srcDir, `${hash}.tsx`), stillsSub: `${shotId}/${hash}`, cues: src.timing.map((t) => t.at), signal });
  return { hash, check };
}

const REPAIRABLE: FailureKind[] = ["import_rule", "typecheck", "crash", "blank"];

/**
 * Writes (or takes from a file) a custom shot for a scene, checks it, and records it. A shot that fails a check is
 * kept in the manifest as `failed` with its reason, and the library scene is drawn: the video still renders. A
 * crash, a typecheck or an import problem gets one repair call (the problems go back to Claude) unless `repair` is false.
 */
export async function addShot(
  id: string,
  o: { scene: string; note?: string; sourceFile?: string; title?: string; model?: string; revealAt?: string | null; moment?: string; repair?: boolean; signal?: AbortSignal; shotId?: string },
): Promise<ShotResult> {
  const project = readProject(id);
  indexOfScene(project, o.scene);
  assertRoom(id, o.scene, o.shotId);
  const file = readShots(id);
  const shotId = o.shotId ?? nextShotId(file);
  let calls = 0;
  let model = o.model ?? modelFor("customshot");
  let origin: CustomShot["origin"] = "claude";

  let src: Source;
  if (o.sourceFile) {
    origin = "file";
    const source = readFileSync(o.sourceFile, "utf8");
    // a compared candidate keeps its title, idea and timing in a meta.json beside it (compareModels), and the model that wrote it
    const metaFile = join(dirname(o.sourceFile), "meta.json");
    const raw = existsSync(metaFile) ? (JSON.parse(readFileSync(metaFile, "utf8")) as { title?: unknown; idea?: unknown; timing?: unknown; model?: string }) : undefined;
    const meta = raw ? CustomShotOutput.omit({ source: true }).safeParse({ title: raw.title, idea: raw.idea, timing: raw.timing }) : undefined;
    model = o.model ?? raw?.model ?? "hand-written";
    src = meta?.success
      ? { ...meta.data, source }
      : { title: o.title ?? `Hand-written shot for ${o.scene}`, idea: o.note || "A shot written by hand.", timing: [], source };
  } else {
    const out = await write(id, buildInput(id, o.scene, { note: o.note, revealAt: o.revealAt, moment: o.moment }), { model: o.model, signal: o.signal });
    calls++;
    src = out;
  }

  let { hash, check } = await checkSource(id, shotId, o.scene, src, o.signal);
  let repaired = false;
  const firstFailure = check.failure;
  if (!check.ok && origin === "claude" && o.repair !== false && REPAIRABLE.includes(check.failure!.kind)) {
    // one repair call: the same moment, the failed source and what was wrong with it
    const out = await write(id, buildInput(id, o.scene, { note: o.note, revealAt: o.revealAt, moment: o.moment, prior: { source: src.source, problems: [`${check.failure!.kind}: ${check.failure!.message}`.slice(0, 1200)] } }), { model: o.model, signal: o.signal });
    calls++;
    src = out;
    ({ hash, check } = await checkSource(id, shotId, o.scene, src, o.signal));
    repaired = true;
  }

  const at = now();
  const shot: CustomShot = {
    id: shotId,
    sceneId: o.scene,
    status: check.ok ? "verified" : "failed",
    title: src.title,
    idea: src.idea,
    note: o.note ?? "",
    source: hash,
    model,
    origin,
    timing: src.timing,
    createdAt: at,
    updatedAt: at,
    check,
    reason: check.ok ? "" : `${check.failure!.kind}: ${check.failure!.message}`,
    history: [],
  };
  event(shot, "written", `${origin === "file" ? "from a file" : `by ${model}`}${o.note ? `; note: ${o.note}` : ""}`);
  if (repaired) event(shot, "failed", `first try: ${firstFailure!.kind}: ${firstFailure!.message}`.slice(0, 600));
  if (check.ok) {
    event(shot, "verified", `${check.stills.landscape.length + check.stills.portrait.length} stills in both frames, ${(check.renderMs / 1000).toFixed(1)} s`);
    appendLog(id, { shot: shotId, scene: o.scene, event: "verified", message: `${src.title}: passed the import rule, the typecheck and a render alone in 16:9 and 9:16` });
  } else {
    event(shot, "failed", shot.reason);
    appendLog(id, { shot: shotId, scene: o.scene, event: "fallback", kind: check.failure!.kind, message: `the library scene ${o.scene} is drawn instead: ${check.failure!.message}` });
  }
  const next = readShots(id);
  const existing = next.shots.findIndex((s) => s.id === shotId);
  if (existing >= 0) next.shots[existing] = shot;
  else next.shots.push(shot);
  writeShots(id, next);
  return { shot, calls, repaired };
}

/**
 * Regenerates a shot with a note ("slower, and the 13 should light up on thirteen"). The new source is checked like a
 * new shot. If it fails, the shot you have stays exactly as it was (status, source) and the failure is only logged.
 */
export async function regenerateShot(id: string, shotId: string, note: string, o: { model?: string; signal?: AbortSignal } = {}): Promise<ShotResult> {
  const file = readShots(id);
  const old = file.shots.find((s) => s.id === shotId);
  if (!old) throw new ShotError(`there is no custom shot ${shotId}`);
  const project = readProject(id);
  indexOfScene(project, old.sceneId);
  const prior: Prior = { source: readSource(id, old.source), problems: old.reason ? [old.reason] : [], note };
  const out = await write(id, buildInput(id, old.sceneId, { note, moment: `regenerating ${old.title}`, prior }), { model: o.model, signal: o.signal });
  const { hash, check } = await checkSource(id, shotId, old.sceneId, out, o.signal);
  const next = readShots(id);
  const shot = next.shots.find((s) => s.id === shotId)!;
  if (!check.ok) {
    event(shot, "failed", `regenerate with "${note}": ${check.failure!.kind}: ${check.failure!.message}`.slice(0, 600));
    shot.updatedAt = now();
    appendLog(id, { shot: shotId, scene: shot.sceneId, event: "fallback", kind: check.failure!.kind, message: `a regenerated version failed (${check.failure!.message.slice(0, 300)}); ${LIVE_STATUSES.includes(shot.status) ? "the shot you had is kept" : "the library scene stays"}` });
    writeShots(id, next);
    return { shot, calls: 1, repaired: false, kept: true, problems: [check.failure!.message] };
  }
  Object.assign(shot, { source: hash, title: out.title, idea: out.idea, timing: out.timing, note, model: o.model ?? shot.model, check, reason: "", status: "verified" as const, updatedAt: now() });
  event(shot, "regenerated", `note: ${note}`);
  appendLog(id, { shot: shotId, scene: shot.sceneId, event: "regenerated", message: `${out.title}: ${note}` });
  writeShots(id, next);
  return { shot, calls: 1, repaired: false };
}

function find(id: string, shotId: string): { file: ReturnType<typeof readShots>; shot: CustomShot } {
  const file = readShots(id);
  const shot = file.shots.find((s) => s.id === shotId);
  if (!shot) throw new ShotError(`there is no custom shot ${shotId} in ${id}`);
  return { file, shot };
}

/** Keep the shot: it is drawn, and it stops asking for your look. A reverted shot comes back if its last check still passes. */
export function acceptShot(id: string, shotId: string): CustomShot {
  const { file, shot } = find(id, shotId);
  if (shot.status === "failed" || !shot.check?.ok) throw new ShotError(`${shotId} failed its checks (${shot.reason || "never checked"}); regenerate it`);
  if (!LIVE_STATUSES.includes(shot.status)) assertRoom(id, shot.sceneId, shotId);
  const restored = shot.status === "rejected";
  shot.status = "accepted";
  shot.reason = "";
  shot.updatedAt = now();
  event(shot, restored ? "restored" : "accepted", restored ? "back from the library scene" : "kept");
  appendLog(id, { shot: shotId, scene: shot.sceneId, event: restored ? "restored" : "accepted", message: shot.title });
  writeShots(id, file);
  return shot;
}

/** Revert to the library scene. The shot and its source stay in the manifest (accept brings it back). */
export function rejectShot(id: string, shotId: string, reason = "reverted to the library scene"): CustomShot {
  const { file, shot } = find(id, shotId);
  shot.status = "rejected";
  shot.reason = reason;
  shot.updatedAt = now();
  event(shot, "rejected", reason);
  appendLog(id, { shot: shotId, scene: shot.sceneId, event: "rejected", message: `the library scene ${shot.sceneId} is drawn: ${reason}` });
  writeShots(id, file);
  return shot;
}

/** Runs the checks again on a shot (the library or its scene changed, or just to see). Records the result like a render would. */
export async function recheckShot(id: string, shotId: string, o: { signal?: AbortSignal } = {}): Promise<CustomShot> {
  const { shot } = find(id, shotId);
  const check = await runShotCheck(id, { scene: shot.sceneId, sourceFile: join(customPaths(id).srcDir, `${shot.source}.tsx`), stillsSub: `${shotId}/${shot.source}`, cues: shot.timing.map((t) => t.at), signal: o.signal });
  const next = readShots(id);
  const fresh = next.shots.find((s) => s.id === shotId)!;
  fresh.check = check;
  fresh.updatedAt = now();
  if (!check.ok) {
    fresh.reason = `${check.failure!.kind}: ${check.failure!.message}`;
    if (LIVE_STATUSES.includes(fresh.status)) fresh.status = "failed";
    event(fresh, "failed", fresh.reason);
    appendLog(id, { shot: shotId, scene: fresh.sceneId, event: "fallback", kind: check.failure!.kind, message: `the library scene ${fresh.sceneId} is drawn instead: ${check.failure!.message}` });
  } else {
    event(fresh, "rechecked", "passed");
    appendLog(id, { shot: shotId, scene: fresh.sceneId, event: "rechecked", message: "passed" });
  }
  writeShots(id, next);
  return fresh;
}

/** Writes shots for the best moments that have none yet, up to the limit. */
export async function autoShots(id: string, o: { count?: number; model?: string; repair?: boolean; signal?: AbortSignal; onShot?: (r: ShotResult, i: number, total: number) => void } = {}): Promise<ShotResult[]> {
  const room = MAX_CUSTOM_SHOTS - liveCount(id);
  const picks = suggest(id, Math.min(o.count ?? MAX_CUSTOM_SHOTS, room));
  const out: ShotResult[] = [];
  for (const [i, c] of picks.entries()) {
    const r = await addShot(id, { scene: c.scene, moment: c.why, revealAt: c.revealAt, model: o.model, repair: o.repair, signal: o.signal });
    out.push(r);
    o.onShot?.(r, i + 1, picks.length);
  }
  return out;
}

// ---------------------------------------------------------------- model comparison

export type CompareRow = {
  model: string;
  scene: string;
  title: string;
  ok: boolean;
  failure?: { kind: FailureKind; message: string };
  attempts: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  lines: number;
  source: string;
  stills: ShotCheck["stills"];
  warnings: string[];
};

/**
 * Writes the same moments on several models and checks each result, without touching the manifest. Stills and
 * sources land in projects/<id>/custom/compare/<model>/<scene>/, the numbers in compare.json. Every call is also
 * in usage.jsonl like any other.
 */
export async function compareModels(id: string, o: { scenes: string[]; models: string[]; signal?: AbortSignal }): Promise<CompareRow[]> {
  const root = join(customPaths(id).dir, "compare");
  const rows: CompareRow[] = [];
  for (const scene of o.scenes) {
    const cand = suggest(id, 20).find((c) => c.scene === scene);
    for (const model of o.models) {
      const before = readUsage(id).length;
      const started = Date.now();
      const input = buildInput(id, scene, { moment: cand?.why ?? "chosen by the editor", revealAt: cand?.revealAt });
      const out = await write(id, input, { model, signal: o.signal });
      const dir = join(root, model, scene);
      mkdirSync(dir, { recursive: true });
      const sourceFile = join(dir, "shot.tsx");
      writeFileSync(sourceFile, out.source);
      writeFileSync(join(dir, "meta.json"), JSON.stringify({ title: out.title, idea: out.idea, timing: out.timing, model, scene }, null, 2) + "\n");
      const check = await runShotCheck(id, { scene, sourceFile, stillsRoot: join(root, model), stillsSub: `${scene}/stills`, cues: out.timing.map((t) => t.at), signal: o.signal });
      const used = readUsage(id).slice(before).filter((u) => u.step === "customshot");
      rows.push({
        model,
        scene,
        title: out.title,
        ok: check.ok,
        ...(check.failure ? { failure: check.failure } : {}),
        attempts: used.length,
        durationMs: used.reduce((n, u) => n + u.durationMs, 0) || Date.now() - started,
        inputTokens: used.reduce((n, u) => n + u.inputTokens, 0),
        outputTokens: used.reduce((n, u) => n + u.outputTokens, 0),
        cacheReadTokens: used.reduce((n, u) => n + u.cacheReadTokens, 0),
        cacheWriteTokens: used.reduce((n, u) => n + u.cacheWriteTokens, 0),
        costUsd: used.reduce((n, u) => n + (u.costUsd ?? 0), 0),
        lines: out.source.split("\n").length,
        source: sourceFile,
        stills: check.stills,
        warnings: check.warnings,
      });
      writeJson(join(root, "compare.json"), rows);
    }
  }
  return rows;
}

export const listShots = (id: string) => readShots(id).shots;
