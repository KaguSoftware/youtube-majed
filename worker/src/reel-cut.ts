/**
 * The Reel cut (docs/PLAN.md sections 8 and 9): a 60–90 s vertical cut of a long video, as a child project.
 *
 *   1. Claude (`claude -p`, skill `reel-cut`, on the subscription, zod-checked, usage logged under the long video)
 *      picks the strongest loop from the critic's scores and the loop map, and the existing lines to keep. It may add
 *      one hook line and one ending line, and nothing else.
 *   2. The child `<id>-reel` is made from the long video's current version, not rebuilt: the kept lines keep their
 *      ids, their takes (cloned by hash, never voiced again), their scenes and their cast. The narration track is
 *      assembled from those takes (a child process, no model), the sound mixed again, and the result committed as
 *      version 1 of the child's own history.
 *   3. The hook and ending go in as an ordinary edit (src/edit.ts `insert`): only those two lines are voiced, each
 *      under a copy of a shot of the long video that Claude chose.
 *
 * The child is a project like any other: its own scenes, versions and edit pass, so the editor, the preview and
 * the export work on it unchanged. `reel.json` records where it came from.
 */
import { projectPaths, readJson, storyPaths, writeJson } from "@studio/project";
import {
  Brief,
  NarrationFile,
  REEL_NEW_LINE_WORDS,
  REEL_SECONDS,
  ReelCutFile,
  ReelCutOutput,
  ScriptFile,
  VoiceFile,
  narrationToScript,
  validateProject,
  type EditOpIn,
  type NewReelLine,
  type Scene,
} from "@studio/schema";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readAssets } from "./assets";
import { callStep } from "./call";
import { applyEdit, assembleTrack, loadDraft, orderOf, takeKey } from "./edit";
import { clone, refreshReport, wordsOf, type Draft } from "./edit-ops";
import { mixPlan, planMix } from "./mix";
import type { JobProgress } from "./queue";
import { readHistory } from "./review";
import { listProjects, readBrief, readPick } from "./story";
import { compactShot, loadStory, type Shot } from "./storyboard";
import { cloneFile, commit, ensureVersions } from "./versions";

export class ReelError extends Error {
  override name = "ReelError";
}

export const reelFile = (id: string) => join(projectPaths(id).dir, "reel.json");
export const readReelCut = (id: string) => readJson(reelFile(id), ReelCutFile);

// ---------------------------------------------------------------- what Claude sees

/** What a line takes to speak, pause after it included: the distance to the next line's start on the track. */
function spans(voice: VoiceFile): Map<string, number> {
  return new Map(voice.lines.map((l, i) => [l.id, Math.round(((voice.lines[i + 1]?.offset ?? voice.track.duration) - l.offset) * 100) / 100]));
}

/** Seconds a new line takes: its words at the brief's rate (pauses included), plus the pause after it. */
export const newLineSeconds = (text: string, wpm: number) => Math.round(((wordsOf(text).length / wpm) * 60 + 0.35) * 100) / 100;

export function reelInput(parent: string, draft: Draft & { voice: VoiceFile }) {
  const brief = readBrief(parent);
  const story = loadStory(parent);
  const span = spans(draft.voice);
  const scores = new Map((readHistory(parent).rounds.at(-1)?.scores ?? []).map((s) => [s.loopId, s]));
  const loopSeconds = (ids: string[]) => Math.round(ids.reduce((t, l) => t + (span.get(l) ?? 0), 0));
  return {
    video: { title: readPick(parent)?.option.title ?? parent, premise: brief.sentence, narrative: brief.narrative, factual: brief.factual, wpm: brief.wpm, totalSeconds: Math.round(draft.voice.track.duration) },
    seconds: REEL_SECONDS,
    newLineWords: REEL_NEW_LINE_WORDS,
    loops: story.loops.map((l) => ({
      id: l.id,
      title: l.title,
      question: l.question,
      ...("stakes" in l && l.stakes ? { stakes: l.stakes } : {}),
      ...("headFake" in l && l.headFake ? { headFake: l.headFake } : {}),
      seconds: loopSeconds(l.lines.map((x) => x.id)),
      lines: l.lines.length,
      critic: scores.get(l.id) ?? null,
    })),
    lines: story.loops.flatMap((l) => l.lines.map((x) => ({ id: x.id, text: x.text, energy: x.energy, beats: x.beats, plants: x.plants, payoffs: x.payoffs, seconds: span.get(x.id) ?? 0 }))),
    scenes: draft.scenes.scenes.map((s) => ({ id: s.id, lineIds: s.lineIds, shot: compactShot(s as Shot) })),
  };
}

/** The checks zod cannot express. Errors go back to Claude once. */
export function checkCut(out: ReelCutOutput, ctx: { draft: Draft & { voice: VoiceFile }; wpm: number }): string[] {
  const errors: string[] = [];
  const order = new Map(ctx.draft.script.lines.map((l, i) => [l.id, i]));
  const span = spans(ctx.draft.voice);
  const loops = new Set(ctx.draft.narration?.loops.map((l) => l.id));
  const scenes = new Set(ctx.draft.scenes.scenes.map((s) => s.id));
  if (!loops.has(out.loopId)) errors.push(`loopId "${out.loopId}" is not a loop of this video (${[...loops].join(", ")})`);
  const missing = out.lineIds.filter((l) => !order.has(l));
  if (missing.length) errors.push(`these lines do not exist: ${missing.join(", ")}`);
  const known = out.lineIds.map((l) => order.get(l)).filter((n): n is number => n !== undefined);
  if (known.some((n, i) => i && n <= known[i - 1]!)) errors.push("lineIds must be in script order, each once");
  if (!out.lineIds.some((l) => l.split(".")[0] === out.loopId)) errors.push(`no kept line belongs to ${out.loopId}`);
  for (const [name, line, max] of [["hook", out.hook, REEL_NEW_LINE_WORDS.hook], ["ending", out.ending, REEL_NEW_LINE_WORDS.ending]] as const) {
    if (!line) continue;
    const n = wordsOf(line.text).length;
    if (n > max) errors.push(`the ${name} has ${n} words; at most ${max}`);
    if (/[0-9%$&#/()]/.test(line.text)) errors.push(`the ${name} has digits or symbols; write numbers as they are spoken`);
    if (!scenes.has(line.showScene)) errors.push(`the ${name}'s showScene "${line.showScene}" is not a scene of this video`);
  }
  if (!missing.length) {
    const seconds = estimate(out, span, ctx.wpm);
    if (seconds < REEL_SECONDS.min || seconds > REEL_SECONDS.max) {
      errors.push(`the cut takes about ${seconds.toFixed(1)} s (kept lines ${out.lineIds.reduce((t, l) => t + (span.get(l) ?? 0), 0).toFixed(1)} s + new lines); it must be ${REEL_SECONDS.min}–${REEL_SECONDS.max} s, aim for ${REEL_SECONDS.target}`);
    }
  }
  return errors;
}

export function estimate(out: ReelCutOutput, span: Map<string, number>, wpm: number): number {
  return out.lineIds.reduce((t, l) => t + (span.get(l) ?? 0), 0) + (out.hook ? newLineSeconds(out.hook.text, wpm) : 0) + (out.ending ? newLineSeconds(out.ending.text, wpm) : 0);
}

// ---------------------------------------------------------------- the child project

/** `<id>-reel`, or the next free `<id>-reel-2`: an existing project is never overwritten. */
export function childId(parent: string): string {
  const taken = new Set(listProjects());
  let id = `${parent}-reel`;
  for (let n = 2; taken.has(id) || existsSync(projectPaths(id).dir); n++) id = `${parent}-reel-${n}`;
  return id;
}

/** The long video's files with only the kept lines, scenes and takes: the child's version 1. */
export function cutDraft(base: Draft & { voice: VoiceFile }, keep: Set<string>): Draft {
  const d = clone<Draft>({ script: base.script, narration: base.narration, scenes: base.scenes, report: base.report, overrides: base.overrides, fx: base.fx });
  if (!d.narration) throw new ReelError("the long video has no narration (story/narration.json); only a story-engine video can be cut");
  const line = (ref: string) => ref.split(":")[0]!;
  d.narration.loops = d.narration.loops.map((l) => ({ ...l, lines: l.lines.filter((x) => keep.has(x.id)) })).filter((l) => l.lines.length);
  d.narration.updatedAt = new Date().toISOString();
  d.script = narrationToScript(d.narration);
  for (const s of d.scenes.scenes) {
    s.lineIds = s.lineIds.filter((x) => keep.has(x));
    s.sfx = s.sfx.filter((x) => keep.has(line(x.at)));
    s.overlays = s.overlays.filter((o) => !o.at || keep.has(line(o.at)));
  }
  d.scenes.scenes = d.scenes.scenes.filter((s) => s.lineIds.length);
  // the first scene has nothing to transition from
  d.scenes.scenes[0]!.transitionIn = "cut";
  d.fx.lines = Object.fromEntries(Object.entries(d.fx.lines).filter(([l]) => keep.has(l)));
  d.overrides = Object.fromEntries(Object.entries(d.overrides).filter(([l]) => keep.has(l)));
  refreshReport(d);
  return d;
}

/** Clones the takes (and their effected variants) of the kept lines into the child's audio folder: nothing is voiced again. */
function cloneTakes(parent: string, child: string, voice: VoiceFile, keep: Set<string>): number {
  const from = join(projectPaths(parent).audioDir, "lines");
  const to = join(projectPaths(child).audioDir, "lines");
  mkdirSync(to, { recursive: true });
  const files = readdirSync(from);
  let n = 0;
  for (const l of voice.lines.filter((x) => keep.has(x.id))) {
    const prefix = `${l.id}.${takeKey(l.file)}.`;
    for (const f of files.filter((x) => x.startsWith(prefix))) {
      cloneFile(join(from, f), join(to, f));
      n++;
    }
  }
  return n;
}

const sceneBody = (draft: Draft, id: string, transitionIn: Scene["transitionIn"]) => {
  const s = draft.scenes.scenes.find((x) => x.id === id)!;
  const { id: _id, lineIds: _lineIds, ...rest } = s;
  return { ...clone(rest), sfx: [], overlays: [], transitionIn };
};

export type ReelCutResult = { child: string; cut: ReelCutOutput; seconds: { estimated: number; measured: number }; keptLines: number; takesCloned: number; newLines: { hook: string | null; ending: string | null }; voiced: string[]; file: ReelCutFile };
export type ReelRun = { signal?: AbortSignal; report?: (p: JobProgress) => void };

/** Picks the cut with Claude and builds the child project. */
export async function cutReel(parent: string, o: ReelRun = {}): Promise<ReelCutResult> {
  const report = o.report ?? (() => {});
  const brief = readBrief(parent);
  if (brief.format === "reel") throw new ReelError(`${parent} is already a Reel; a Reel cut is made from a long video`);
  if (readReelCut(parent)) throw new ReelError(`${parent} is itself a Reel cut`);
  const head = ensureVersions(parent);
  const draft = loadDraft(parent, head);
  if (!draft.narration?.lockedAt) throw new ReelError(`the script of ${parent} is not locked`);

  // 1. Claude
  report({ label: "Choosing the cut", done: 0, total: 4, detail: "the strongest loop, from the critic's scores and the loop map" });
  const cut = await callStep({
    project: parent,
    step: "reelcut",
    input: reelInput(parent, draft),
    signal: o.signal,
    check: (out) => checkCut(out, { draft, wpm: brief.wpm }),
  });
  const keep = new Set(cut.lineIds);
  const estimated = estimate(cut, spans(draft.voice), brief.wpm);

  // 2. the child project from the parent's version: kept lines, their takes, one new narration track, one new mix
  const child = childId(parent);
  report({ label: "Building the Reel project", done: 1, total: 4, detail: `${child}: ${cut.lineIds.length} lines from ${cut.loopId}` });
  const d = cutDraft(draft, keep);
  const takesCloned = cloneTakes(parent, child, draft.voice, keep);
  const voiceKept: VoiceFile = { ...draft.voice, lines: draft.voice.lines.filter((l) => keep.has(l.id)) };
  const { voice, narration } = await assembleTrack(child, voiceKept, orderOf(voiceKept), o.signal);
  const check = validateProject({ scenes: d.scenes, script: d.script, voice });
  if (!check.ok) throw new ReelError(`the cut does not validate:\n  - ${check.errors.join("\n  - ")}`);
  const plan = planMix({ project: child, scenes: d.scenes, report: d.report, voice, narration, assets: readAssets() });
  const mix = await mixPlan(child, plan, { signal: o.signal });

  const minutes = Math.min(3, Math.max(0.5, Math.round((voice.track.duration / 60) * 100) / 100));
  writeJson(storyPaths(child).brief, Brief.parse({ ...brief, id: child, format: "reel", minutes, notes: `Reel cut of ${parent}, built around ${cut.loopId}. ${cut.why}`.slice(0, 2000), createdAt: new Date().toISOString() }));
  const pick = readPick(parent);
  if (pick) writeJson(storyPaths(child).pick, { ...pick, option: { ...pick.option, title: cut.title } });
  const narrationHash = /([0-9a-f]{64})\.wav$/.exec(narration)![1]!;
  commit(child, {
    kind: "start",
    label: `cut from ${parent}, version ${head.n}`,
    files: {
      "script.json": d.script,
      "story/narration.json": NarrationFile.parse(d.narration),
      "storyboard/scenes.json": d.scenes,
      "storyboard/storyboard.json": d.report,
      "audio/voice.json": voice,
      ...(Object.keys(d.overrides).length ? { "audio/overrides.json": d.overrides } : {}),
      ...(Object.keys(d.fx.lines).length ? { "audio/fx.json": d.fx } : {}),
      "audio/mixplan.json": plan,
      "audio/mix.json": readFileSync(mix.json, "utf8"),
    },
    media: { narration: narrationHash, mix: mix.key },
    work: { keptLines: keep.size, takesCloned },
  });
  const file = (newLines: ReelCutFile["newLines"], measured: number | null): ReelCutFile => ReelCutFile.parse({ version: 1, parent, parentVersion: head.n, createdAt: new Date().toISOString(), cut, seconds: { estimated, measured }, newLines });
  writeJson(reelFile(child), file({ hook: null, ending: null }, voice.track.duration));

  // 3. the hook and the ending, as an ordinary edit: only these lines are voiced
  const ops: EditOpIn[] = [];
  const insert = (line: NewReelLine, where: { before: string } | { after: string }, transitionIn: Scene["transitionIn"]): EditOpIn => ({ op: "insert", ...where, line: { text: line.text, energy: line.energy, delivery: line.delivery }, scene: sceneBody(draft, line.showScene, transitionIn) });
  if (cut.hook) ops.push(insert(cut.hook, { before: cut.lineIds[0]! }, "cut"));
  if (cut.ending) ops.push(insert(cut.ending, { after: cut.lineIds.at(-1)! }, "cut"));
  let voiced: string[] = [];
  let final = voice;
  if (ops.length) {
    report({ label: "Voicing the hook and the ending", done: 2, total: 4, detail: [cut.hook && "hook", cut.ending && "ending"].filter(Boolean).join(" and ") });
    const r = await applyEdit(child, { label: "hook and ending lines", ops }, { signal: o.signal, report: (p) => report({ ...p, label: `Reel: ${p.label.toLowerCase()}` }) });
    voiced = r.voiced;
    const fresh = readJson(projectPaths(child).voiceJson, VoiceFile)!;
    final = fresh;
  }
  const lines = readJson(projectPaths(child).scriptJson, ScriptFile)!.lines;
  const newLines = { hook: cut.hook ? lines[0]!.id : null, ending: cut.ending ? lines.at(-1)!.id : null };
  const result = file(newLines, final.track.duration);
  writeJson(reelFile(child), result);
  report({ label: "Reel cut ready", done: 4, total: 4, detail: `${child}, ${final.track.duration.toFixed(1)} s` });
  return { child, cut, seconds: { estimated, measured: final.track.duration }, keptLines: keep.size, takesCloned, newLines, voiced, file: result };
}

/** Is this project a Reel cut, and which Reel cuts were made from it. */
export function reelLinks(id: string): { cutFrom: ReelCutFile | null; reels: { id: string; seconds: number | null; loopId: string; createdAt: string }[] } {
  const reels = listProjects().flatMap((p) => {
    try {
      const f = p === id ? undefined : readReelCut(p);
      return f && f.parent === id ? [{ id: p, seconds: f.seconds.measured, loopId: f.cut.loopId, createdAt: f.createdAt }] : [];
    } catch {
      return [];
    }
  });
  return { cutFrom: readReelCut(id) ?? null, reels: reels.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}
