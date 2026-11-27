/**
 * Sound design (docs/PLAN.md section 7): turns a storyboarded, voiced project
 * into a mix plan, then has audio/ render it.
 *
 * Claude wrote only tags (scene `sfx`, a music mood per loop, a reveal word per
 * head fake). Code decides the rest:
 *
 * - sfx tags → a file from the asset index, its first sound on the word;
 * - every head fake → a riser that ends on the reveal word, then a hit on the
 *   word ("hit") or the music and ambience dropping out ("silence");
 * - transitions → a whoosh peaking on a wipe's cut, an impact on a smash cut;
 * - locations → an ambience loop per run of scenes with the same kind of place;
 * - music → a bed per loop by mood, ducked ~11 dB under the voice;
 * - the sum → −14 LUFS, true peak under −1.5 dBTP (in audio/studio_audio/mix.py).
 *
 * The plan is cached by hash: an unchanged plan is never mixed twice, and
 * nothing here ever re-voices (it reads voice.json and narration.wav only).
 */
import { REPO_DIR, projectPaths, readJson, readVoice, storyboardPaths, writeJson } from "@studio/project";
import { BACKGROUNDS, MixPlan, MixResult, SceneFile, StoryboardFile, TRANSITIONS, closest, type MixCue, type MixGate, type SceneFile as Scenes, type StoryboardFile as Report, type VoiceFile } from "@studio/schema";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { readAssets, type Asset, type AssetKind } from "./assets";

export const MIXER_VERSION = 1;

export class MixError extends Error {
  override name = "MixError";
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const h = (s: string) => parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16);
const round = (x: number) => Math.round(x * 1000) / 1000;

/** Levels each kind is set to (LUFS: integrated for beds, loudest 400 ms window for one-shots). */
export const LEVELS = {
  music: -21,
  ambience: -31,
  roomTone: -44,
  sfx: -21,
  footsteps: -25,
  riser: -19,
  hit: -15,
  impact: -21,
  whoosh: -22,
} as const;

/** Music ducks ~11 dB under the voice; ambience a little. */
export const DUCK = {
  music: { depthDb: 11, attackMs: 70, releaseMs: 550, lookaheadMs: 80 },
  ambience: { depthDb: 4, attackMs: 120, releaseMs: 800, lookaheadMs: 80 },
};

/** Moods to fall back to when the library has no bed for the one asked for. */
const MOOD_FALLBACK: Record<string, string[]> = {
  dread: ["tense", "mystery"],
  action: ["tense"],
  tense: ["mystery"],
  mystery: ["tense", "calm"],
  warm: ["calm", "hopeful"],
  hopeful: ["calm", "warm"],
  triumphant: ["hopeful", "calm"],
  playful: ["calm", "warm"],
  sad: ["calm"],
  calm: ["warm"],
};

/**
 * Which ambience a background gets, from its id and description (so new
 * backgrounds find one without a table edit). First match wins; the tags are
 * looked up in the index.
 */
const PLACE_SOUNDS: [RegExp, string[]][] = [
  [/lighthouse_ext|sea|ocean|beach|coast|harbou?r|pier|shore|ship|island/i, ["sea", "coast"]],
  [/storm|rain/i, ["storm", "rain"]],
  [/desert|rooftop|mountain|cliff|tower|graveyard|cemetery/i, ["wind"]],
  [/forest|woods|park|garden|field|countryside|meadow/i, ["forest", "park", "birds"]],
  [/cafe|café|kitchen|restaurant|bar|diner|canteen/i, ["cafe", "cafeteria"]],
  [/classroom|school/i, ["classroom"]],
  [/hospital|office|mall|station|airport|lobby/i, ["indoor_crowd", "office"]],
  [/road|highway|traffic/i, ["road", "traffic"]],
  [/street|town|city|market|alley/i, ["street", "city", "town"]],
  [/fire|campfire|fireplace/i, ["fire"]],
];

export function placeTags(bg: string): string[] {
  const text = `${bg} ${(BACKGROUNDS as Record<string, { description: string; interior?: boolean }>)[bg]?.description ?? ""}`;
  const own = PLACE_SOUNDS.find(([re]) => re.test(bg));
  if (own) return own[1];
  const interior = (BACKGROUNDS as Record<string, { interior?: boolean }>)[bg]?.interior;
  if (interior) {
    const byDesc = PLACE_SOUNDS.find(([re, tags]) => re.test(text) && !tags.includes("sea") && !tags.includes("wind"));
    return byDesc ? byDesc[1] : ["room_tone"];
  }
  return PLACE_SOUNDS.find(([re]) => re.test(text))?.[1] ?? ["wind"];
}

const isWhoosh = (t: string) => /whoosh|wipe|swish|swipe|pan/i.test(`${t} ${(TRANSITIONS as Record<string, { description: string }>)[t]?.description ?? ""}`);
const isSmash = (t: string) => /smash/i.test(t);

// ---------------------------------------------------------------- times

type Times = { word: (lineId: string, index: number) => number; lineStart: (id: string) => number; lineEnd: (id: string) => number };

function times(voice: VoiceFile): Times {
  const lines = new Map(voice.lines.map((l) => [l.id, l]));
  const get = (id: string) => {
    const l = lines.get(id);
    if (!l) throw new MixError(`line ${id} is not in voice.json; voice the project again (\`pnpm voice <id>\`)`);
    return l;
  };
  return {
    word: (id, i) => {
      const w = get(id).words;
      return w[Math.min(i, w.length - 1)]!.start;
    },
    lineStart: (id) => get(id).words[0]!.start,
    lineEnd: (id) => get(id).words.at(-1)!.end,
  };
}

/** Scene starts in seconds, by the same rule as remotion/src/scene/timeline.ts (6 frames before the first word). */
export function sceneStarts(scenes: Scenes, t: Times): number[] {
  const starts: number[] = [];
  scenes.scenes.forEach((s, i) => {
    if (i === 0) return starts.push(0);
    const first = t.lineStart(s.lineIds[0]!);
    const prevEnd = t.lineEnd(scenes.scenes[i - 1]!.lineIds.at(-1)!);
    starts.push(Math.min(first, Math.max(starts[i - 1]! + 0.5, first - 6 / 30, prevEnd)));
  });
  return starts;
}

// ---------------------------------------------------------------- picking files

class Picker {
  private used = new Map<string, number>();
  constructor(
    private assets: Asset[],
    private seed: string,
  ) {}

  /** The asset for a request: fewest uses so far in this mix, then a stable per-project order. Real music beats placeholders. */
  pick(kind: AssetKind | AssetKind[], match: (a: Asset) => boolean, key: string): Asset | undefined {
    const kinds = Array.isArray(kind) ? kind : [kind];
    const pool = this.assets.filter((a) => kinds.includes(a.kind) && match(a));
    if (!pool.length) return undefined;
    const score = (a: Asset) => (a.tags.includes("placeholder") ? 1e6 : 0) + (this.used.get(a.id) ?? 0) * 1000 + (h(`${this.seed}:${key}:${a.id}`) % 1000);
    const best = pool.reduce((x, y) => (score(y) < score(x) ? y : x));
    this.used.set(best.id, (this.used.get(best.id) ?? 0) + 1);
    return best;
  }

  tags(kind: AssetKind): string[] {
    return [...new Set(this.assets.filter((a) => a.kind === kind).flatMap((a) => a.tags))];
  }
}

const gainFor = (a: Asset, target: number) => {
  const measured = a.kind === "music" || a.kind === "ambience" ? (a.lufs ?? a.loudest - 8) : a.loudest;
  return Math.max(-60, Math.min(24, round(target - measured)));
};

function cue(a: Asset, o: Omit<MixCue, "asset" | "file" | "sha256" | "licence" | "kind" | "loop" | "gainDb"> & { target: number; loop?: boolean }): MixCue {
  const { target, loop, ...rest } = o;
  return {
    ...rest,
    kind: a.kind,
    asset: a.id,
    file: a.path,
    sha256: a.sha256,
    licence: a.licence,
    start: round(rest.start),
    offset: round(rest.offset),
    length: round(rest.length),
    loop: loop && a.loop_start !== null && a.loop_end !== null ? { start: a.loop_start, end: a.loop_end } : null,
    gainDb: gainFor(a, target),
  };
}

// ---------------------------------------------------------------- the plan

export type MixInputs = { project: string; scenes: Scenes; report: Report; voice: VoiceFile; narration: string; assets: Asset[] };

export function planMix(inp: MixInputs): MixPlan {
  const { project, scenes, report, voice, assets } = inp;
  const t = times(voice);
  const starts = sceneStarts(scenes, t);
  const end = voice.track.duration;
  const sceneEnd = (i: number) => starts[i + 1] ?? end;
  const pick = new Picker(assets, project);
  const cues: MixCue[] = [];
  const gates: MixGate[] = [];
  const warnings: string[] = [];
  let n = 0;
  const id = (k: string) => `${k}${++n}`;
  const loopOf = (lineId: string) => lineId.split(".")[0]!;
  const moodOf = new Map(report.music.map((m) => [m.loopId, m.mood]));

  // --- music: one bed per run of loops with the same mood
  const loops = [...new Set(scenes.scenes.flatMap((s) => s.lineIds.map(loopOf)))];
  const firstLine = (loop: string) => voice.lines.find((l) => loopOf(l.id) === loop)!.id;
  type Span = { mood: string; start: number; end: number; loops: string[] };
  const spans: Span[] = [];
  loops.forEach((loop, i) => {
    const mood = moodOf.get(loop) ?? "none";
    const start = i === 0 ? 0 : t.lineStart(firstLine(loop)) - 0.6;
    const stop = i + 1 < loops.length ? t.lineStart(firstLine(loops[i + 1]!)) - 0.6 : end;
    const last = spans.at(-1);
    if (last && last.mood === mood) {
      last.end = stop;
      last.loops.push(loop);
    } else spans.push({ mood, start, end: stop, loops: [loop] });
  });
  spans.forEach((span, i) => {
    if (span.mood === "none") return;
    const wanted = [span.mood, ...(MOOD_FALLBACK[span.mood] ?? [])];
    let bed: Asset | undefined;
    for (const mood of wanted) {
      bed = pick.pick("music", (a) => a.moods.includes(mood), `music:${i}`);
      if (bed) {
        if (mood !== span.mood) warnings.push(`no music for mood "${span.mood}" (${span.loops.join(", ")}); used a "${mood}" bed`);
        break;
      }
    }
    if (!bed) return warnings.push(`no music for mood "${span.mood}" (${span.loops.join(", ")}): assets/music is empty`);
    if (bed.tags.includes("placeholder")) warnings.push(`${span.loops.join(", ")}: placeholder music (${bed.id}) until real beds are added`);
    const xf = 1.5;
    const s = Math.max(0, span.start - (i ? xf / 2 : 0));
    const e = Math.min(end, span.end + (i + 1 < spans.length ? xf / 2 : 0));
    cues.push(cue(bed, { id: id("music"), start: s, offset: 0, length: e - s, fadeIn: i ? xf : 2.0, fadeOut: i + 1 < spans.length ? xf : 2.5, target: LEVELS.music, loop: true, reason: `music "${span.mood}" for ${span.loops.join(", ")}` }));
  });

  // --- ambience: one loop per run of scenes whose place sounds the same
  type Run = { tags: string[]; from: number; to: number };
  const runs: Run[] = [];
  scenes.scenes.forEach((s, i) => {
    const storm = s.sfx?.some((x) => /thunder|storm|rain/.test(x.tag)) ?? false;
    const tags = storm && !(BACKGROUNDS as Record<string, { interior?: boolean }>)[s.bg]?.interior ? ["storm", "rain"] : placeTags(s.bg);
    const last = runs.at(-1);
    if (last && last.tags.join() === tags.join()) last.to = i;
    else runs.push({ tags, from: i, to: i });
  });
  runs.forEach((run, k) => {
    const a = pick.pick("ambience", (x) => run.tags.some((tag) => x.tags.includes(tag)), `amb:${run.tags.join()}`) ?? pick.pick("ambience", (x) => x.tags.includes("room_tone"), "amb:room");
    if (!a) return warnings.push(`no ambience for ${scenes.scenes[run.from]!.bg} (${run.tags.join(", ")})`);
    const s = starts[run.from]!;
    const e = Math.min(end, sceneEnd(run.to) + (k + 1 < runs.length ? 0.6 : 0));
    const room = a.tags.includes("room_tone");
    const span = (a.loop_end ?? a.duration) - (a.loop_start ?? 0);
    const offset = span > e - s + 4 ? (h(`${project}:${k}`) % Math.floor((span - (e - s)) * 10)) / 10 : 0;
    cues.push(cue(a, { id: id("amb"), start: s, offset, length: e - s, fadeIn: k ? 0.6 : 1.5, fadeOut: k + 1 < runs.length ? 0.6 : 2.0, target: room ? LEVELS.roomTone : LEVELS.ambience, loop: true, reason: `ambience for ${scenes.scenes[run.from]!.id}–${scenes.scenes[run.to]!.id} (${scenes.scenes[run.from]!.bg})` }));
  });

  // --- sfx tags from the storyboard
  const sfxTags = pick.tags("sfx");
  for (const s of scenes.scenes) {
    for (const x of s.sfx ?? []) {
      const tag = sfxTags.includes(x.tag) ? x.tag : closest(x.tag, sfxTags);
      if (!tag) {
        warnings.push(`${s.id}: no sound for tag "${x.tag}"`);
        continue;
      }
      if (tag !== x.tag) warnings.push(`${s.id}: sound tag "${x.tag}" → "${tag}"`);
      const a = pick.pick("sfx", (y) => y.tags.includes(tag), `sfx:${tag}`)!;
      const [lineId, word] = x.at.split(":") as [string, string];
      const at = t.word(lineId, Number(word));
      const length = Math.min(a.duration - a.onset, 7);
      cues.push(cue(a, { id: id("sfx"), start: at, offset: a.onset, length, fadeIn: 0.005, fadeOut: length < a.duration - a.onset ? 0.4 : 0.05, target: /footsteps/.test(tag) ? LEVELS.footsteps : LEVELS.sfx, reason: `sfx "${x.tag}" on ${x.at}` }));
    }
  }

  // --- head fakes: riser into the reveal word, then a hit or silence
  const revealTimes: number[] = [];
  const revealLines = new Set(report.reveals.map((r) => r.lineId));
  for (const r of report.reveals) {
    const [lineId, word] = r.at.split(":") as [string, string];
    const at = t.word(lineId, Number(word));
    revealTimes.push(at);
    const mood = moodOf.get(loopOf(lineId)) ?? "mystery";
    const dark = mood === "dread" || mood === "tense";
    const sceneIdx = scenes.scenes.findIndex((s) => s.lineIds.includes(lineId));
    const room = Math.max(1.5, at - (starts[Math.max(0, sceneIdx - 1)] ?? 0));
    const riser =
      pick.pick("riser", (a) => a.duration <= Math.min(4.2, room + 0.5) && (dark ? a.moods.includes("dread") || a.duration >= 3 : !a.moods.includes("dread")), `riser:${r.at}`) ??
      pick.pick("riser", (a) => a.duration <= Math.min(4.2, room + 0.5), `riser:${r.at}`) ??
      pick.pick("riser", () => true, `riser:${r.at}`);
    if (riser) {
      const start = at - riser.duration;
      cues.push(cue(riser, { id: id("riser"), start: Math.max(0, start), offset: Math.max(0, -start), length: riser.duration - Math.max(0, -start), fadeIn: 0.3, fadeOut: 0.01, target: LEVELS.riser, reason: `riser into the reveal on ${r.at} (${r.kind})` }));
    } else warnings.push(`no riser in the index for the reveal on ${r.at}`);
    const lineEnd = t.lineEnd(lineId);
    if (r.kind === "hit") {
      const hit = pick.pick("hit", (a) => (dark ? a.moods.includes("dread") : !a.tags.includes("braam")), `hit:${r.at}`) ?? pick.pick("hit", () => true, `hit:${r.at}`);
      if (hit) cues.push(cue(hit, { id: id("hit"), start: at, offset: hit.onset, length: Math.min(hit.duration - hit.onset, 3), fadeIn: 0.002, fadeOut: 0.3, target: LEVELS.hit, reason: `hit on the reveal word ${r.at}` }));
      else warnings.push(`no hit in the index for the reveal on ${r.at}`);
      gates.push({ start: round(at - 0.3), end: round(lineEnd + 0.3), fade: 0.05, release: 1.2, reason: `drop out before the hit on ${r.at}` });
    } else {
      gates.push({ start: round(at - 0.25), end: round(lineEnd + 0.8), fade: 0.05, release: 1.5, reason: `silence on the reveal ${r.at}` });
    }
  }

  // --- transitions
  scenes.scenes.forEach((s, i) => {
    if (i === 0) return;
    const at = starts[i]!;
    if (isWhoosh(s.transitionIn)) {
      const a = pick.pick("whoosh", () => true, `whoosh:${i}`);
      if (a) cues.push(cue(a, { id: id("whoosh"), start: at - a.peak_at, offset: 0, length: a.duration, fadeIn: 0.005, fadeOut: 0.05, target: LEVELS.whoosh, reason: `whoosh on the ${s.transitionIn} into ${s.id}` }));
    } else if (isSmash(s.transitionIn) && !s.lineIds.some((l) => revealLines.has(l)) && !revealTimes.some((r) => Math.abs(r - at) < 0.8)) {
      const a = pick.pick("hit", (x) => x.tags.includes("impact"), `smash:${i}`) ?? pick.pick("hit", () => true, `smash:${i}`);
      if (a) cues.push(cue(a, { id: id("impact"), start: at, offset: a.onset, length: Math.min(1.2, a.duration - a.onset), fadeIn: 0.002, fadeOut: 0.3, target: LEVELS.impact, reason: `impact on the smash cut into ${s.id}` }));
    }
  });

  return MixPlan.parse({
    version: 1,
    mixer: MIXER_VERSION,
    project,
    sampleRate: 48000,
    duration: end,
    voice: { file: inp.narration, sha256: sha256(inp.narration) },
    targetLufs: -14,
    truePeakDbtp: -1.5,
    duck: DUCK,
    cues: cues.sort((a, b) => a.start - b.start),
    gates,
    warnings,
  });
}

// ---------------------------------------------------------------- running it

/**
 * The narration track as mix plans name it: its copy in the store by content
 * (audio/narration/<sha256>.wav, shared with the version history), so the
 * same track always gives the same plan, and the same plan is never mixed twice.
 */
export function storedNarration(project: string): string {
  const file = projectPaths(project).narration;
  const hash = sha256(file);
  const dest = join(projectPaths(project).audioDir, "narration", `${hash}.wav`);
  if (!existsSync(dest)) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, `${dest}.tmp`, constants.COPYFILE_FICLONE);
    renameSync(`${dest}.tmp`, dest);
  }
  return dest;
}

export type MixOptions = { scenes?: string; force?: boolean };
export type MixRun = { plan: MixPlan; result: MixResult; cached: boolean; planFile: string; mix: string };

export function readInputs(project: string, o: MixOptions = {}): MixInputs {
  const paths = storyboardPaths(project);
  const voice = readVoice(project);
  if (!voice) throw new MixError(`${project} has not been voiced: run \`pnpm voice ${project}\` first`);
  if (!voice.ok) throw new MixError(`voice.json is not valid:\n  - ${voice.errors.join("\n  - ")}`);
  const scenesFile = o.scenes ?? paths.scenes;
  const scenes = readJson(scenesFile, SceneFile);
  if (!scenes) throw new MixError(`no scenes at ${scenesFile}: run \`pnpm story storyboard ${project}\` first`);
  // A hand-written scene file (--scenes) has no storyboard report: no music moods, no reveals.
  const report = o.scenes ? BLANK_REPORT : readJson(paths.report, StoryboardFile);
  if (!report) throw new MixError(`no storyboard report at ${paths.report}: run \`pnpm story storyboard ${project}\` first`);
  const assets = readAssets();
  if (!assets.length) throw new MixError("the asset index is empty: run `pnpm assets seed` and `pnpm assets index`");
  return { project, scenes, report, voice: voice.data, narration: storedNarration(project), assets };
}

const BLANK_REPORT: Report = { version: 1, createdAt: new Date(0).toISOString(), catalogue: "", source: "script", style: "", music: [], reveals: [], batches: [], flags: [], combos: [], stats: { scenes: 0, lines: 0, seconds: 0, timedBy: "voice", regenerated: 0, varietyHits: 0, varietyFixed: 0, mappedIds: 0 } };

type Prepared = { plan: MixPlan; cachedWav: string; cachedJson: string; resultFile: string; cached: boolean; paths: ReturnType<typeof storyboardPaths> };

function prepare(project: string, o: MixOptions): Prepared {
  const paths = storyboardPaths(project);
  const plan = planMix(readInputs(project, o));
  writeJson(paths.mixPlan, plan);
  const key = createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 20);
  const cachedWav = join(paths.mixCache, `${key}.wav`);
  const cachedJson = join(paths.mixCache, `${key}.json`);
  const resultFile = join(projectPaths(project).audioDir, "mix.json");
  const cached = existsSync(cachedWav) && existsSync(cachedJson) && !o.force;
  return { plan, cachedWav, cachedJson, resultFile, cached, paths };
}

const mixerArgs = (x: Prepared) => ["run", "--no-sync", "python", "-m", "studio_audio.mix", x.paths.mixPlan, x.cachedWav, x.cachedJson];

function finish(x: Prepared): MixRun {
  copyFileSync(x.cachedWav, x.paths.mix);
  copyFileSync(x.cachedJson, x.resultFile);
  const result = MixResult.parse(JSON.parse(readFileSync(x.resultFile, "utf8")));
  return { plan: x.plan, result, cached: x.cached, planFile: x.paths.mixPlan, mix: x.paths.mix };
}

export function runMix(project: string, o: MixOptions = {}): MixRun {
  const x = prepare(project, o);
  if (!x.cached) {
    const r = spawnSync("uv", mixerArgs(x), { cwd: join(REPO_DIR, "audio"), encoding: "utf8" });
    if (r.error) throw new MixError(`cannot run uv (the audio venv): ${r.error.message}`);
    if (r.status !== 0) throw new MixError(`the mixer failed:\n${(r.stderr || r.stdout).trim().slice(-1500)}`);
  }
  return finish(x);
}

/** The cache key of a plan: the stem of audio/mix/<key>.wav. */
export const planKey = (plan: MixPlan) => createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 20);

/**
 * Mixes a plan that is not (yet) the project's own, for the edit engine: the
 * plan is kept next to its mix in the cache (audio/mix/<key>.plan.json) and
 * nothing in the working files changes. An unchanged plan is never mixed twice.
 */
export async function mixPlan(project: string, plan: MixPlan, o: { signal?: AbortSignal } = {}): Promise<{ key: string; wav: string; json: string; cached: boolean; result: MixResult }> {
  const paths = storyboardPaths(project);
  const key = planKey(plan);
  const x: Prepared = { plan, cachedWav: join(paths.mixCache, `${key}.wav`), cachedJson: join(paths.mixCache, `${key}.json`), resultFile: "", cached: false, paths: { ...paths, mixPlan: join(paths.mixCache, `${key}.plan.json`) } };
  x.cached = existsSync(x.cachedWav) && existsSync(x.cachedJson);
  if (!x.cached) {
    writeJson(x.paths.mixPlan, plan);
    await new Promise<void>((resolve, reject) => {
      const child = spawn("uv", mixerArgs(x), { cwd: join(REPO_DIR, "audio"), signal: o.signal });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("error", (e) => reject(o.signal?.aborted ? e : new MixError(`cannot run uv (the audio venv): ${e.message}`)));
      child.on("close", (code) => (code === 0 ? resolve() : reject(new MixError(`the mixer failed:\n${out.trim().slice(-1500)}`))));
    });
  }
  return { key, wav: x.cachedWav, json: x.cachedJson, cached: x.cached, result: MixResult.parse(JSON.parse(readFileSync(x.cachedJson, "utf8"))) };
}

/** The same mix without blocking the worker's HTTP server while Python renders it. */
export async function runMixAsync(project: string, o: MixOptions & { signal?: AbortSignal } = {}): Promise<MixRun> {
  const x = prepare(project, o);
  if (!x.cached) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("uv", mixerArgs(x), { cwd: join(REPO_DIR, "audio"), signal: o.signal });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("error", (e) => reject(o.signal?.aborted ? e : new MixError(`cannot run uv (the audio venv): ${e.message}`)));
      child.on("close", (code) => (code === 0 ? resolve() : reject(new MixError(`the mixer failed:\n${out.trim().slice(-1500)}`))));
    });
  }
  return finish(x);
}
