/**
 * Claude in the edit (docs/PLAN.md section 8): three `claude -p` steps of the
 * `edit-scenes` skill, on the subscription, zod-checked, usage logged
 * (src/call.ts), and run through the storyboard step's own checks:
 *
 *   regenerate  one scene + a note → 2–3 options, saved for a pick
 *               (projects/<id>/edits/options/<id>.json); picking one commits it
 *   beat        a beat in plain words ("cut to a dog barking at him, he jumps")
 *               → its shots plus any new narration line, committed (only the
 *               new line is voiced)
 *   fixscenes   several flagged scenes, each with a note, in one call, committed
 *
 * Every draft shot goes through the same code as the storyboard step
 * (src/storyboard.ts): library ids mapped to the closest item and flagged
 * (normaliseShot), head-fake shots keep a reveal device (ensurePayoffs), and
 * the variety guard: a repeated picture within 30 s is flagged, a repeated
 * moving camera is swapped by code, a combo from the last three videos gets
 * another camera. Only the new or changed scenes are touched by the guard.
 */
import { projectPaths, readJson, writeJson } from "@studio/project";
import { SceneOptions, type DraftScene, type EditOpIn, type Scene, type Version } from "@studio/schema";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sfxVocabulary } from "./assets";
import { callStep } from "./call";
import { applyEdit, EditError, loadDraft, type EditOptions, type EditResult } from "./edit";
import { applyOps, wordsOf, type Draft } from "./edit-ops";
import { avoidRecent, compactShot, ensurePayoffs, fixCameras, libraryForClaude, loadStory, normaliseShot, pictureRepeats, recentCombos, type Ctx, type Shot, type Slot } from "./storyboard";
import { ensureVersions } from "./versions";

const optionsDir = (id: string) => join(projectPaths(id).dir, "edits", "options");

type Base = { head: Version; draft: ReturnType<typeof loadDraft>; times: Map<string, { start: number; end: number; words: number }>; video: unknown; headfakes: Set<string> };

function base(id: string): Base {
  const head = ensureVersions(id);
  const draft = loadDraft(id, head);
  const story = loadStory(id);
  const headfakes = new Set(story.loops.flatMap((l) => l.lines).filter((l) => l.beats.includes("headfake")).map((l) => l.id));
  return { head, draft, times: story.times, video: story.video, headfakes };
}

function ctxFor(d: Draft, extraWords: Record<string, number> = {}): Ctx {
  return {
    cast: new Set(Object.keys(d.scenes.cast)),
    sfx: sfxVocabulary(),
    lineWords: new Map([...d.script.lines.map((l) => [l.id, wordsOf(l.text).length] as const), ...Object.entries(extraWords)]),
    protagonist: Object.keys(d.scenes.cast)[0]!,
  };
}

/** The neighbourhood Claude needs for continuity: shots around, and the lines they cover with their timing and beats. */
function neighbourhood(b: Base, from: number, to: number) {
  const scenes = b.draft.scenes.scenes;
  const lo = Math.max(0, from - 2);
  const hi = Math.min(scenes.length - 1, to + 2);
  const lineIds = scenes.slice(lo, hi + 1).flatMap((s) => s.lineIds);
  const beats = new Map(loadStoryLines(b));
  return {
    around: { before: scenes.slice(lo, from).map((s) => compactShot(s as Shot)), after: scenes.slice(to + 1, hi + 1).map((s) => compactShot(s as Shot)) },
    lines: lineIds.map((id) => {
      const l = b.draft.script.lines.find((x) => x.id === id)!;
      const t = b.times.get(id);
      return { id, text: l.text, energy: l.energy, seconds: t ? Math.round((t.end - t.start) * 10) / 10 : null, beats: beats.get(id) ?? [] };
    }),
  };
}

function loadStoryLines(b: Base): [string, string[]][] {
  return (b.draft.narration?.loops.flatMap((l) => l.lines) ?? []).map((l) => [l.id, l.beats]);
}

const common = (b: Base) => ({ video: b.video, cast: b.draft.scenes.cast, library: libraryForClaude(), sfx: sfxVocabulary() });

/** A draft scene through the storyboard step's checks. undefined + problems when code cannot make it valid. */
function normalise(d: DraftScene, lineIds: string[], ctx: Ctx, headfakes: Set<string>): { shot?: Shot; flags: string[]; problems: string[] } {
  const slot = normaliseShot(d, lineIds, ctx);
  if (slot.shot) {
    const one = [slot];
    ensurePayoffs(one, headfakes);
    if (one.length === 1) Object.assign(slot, one[0]);
  }
  return { shot: slot.shot, flags: slot.flags.map((f) => f.message), problems: slot.problems };
}

/**
 * The variety guard on an edited storyboard, for the scenes in `touched` only:
 * camera repeats swapped, recent-video combos given another camera, repeated
 * pictures flagged. Returns the cameras to use and the flags, per scene id.
 */
function guard(id: string, d: Draft, touched: string[], startOf: (lineId: string) => number, headfakes: Set<string>): Map<string, { camera: string; flags: string[] }> {
  const slots: Slot[] = d.scenes.scenes.map((s) => ({ lineIds: s.lineIds, shot: structuredClone(s) as Shot, problems: [], flags: [], why: "" }));
  const at = (s: Slot) => startOf(s.lineIds[0]!);
  const before = slots.map((s) => s.shot!.camera);
  fixCameras(slots, headfakes, at);
  avoidRecent(slots, recentCombos(id).combos, headfakes, at);
  const repeats = pictureRepeats(slots, at);
  const out = new Map<string, { camera: string; flags: string[] }>();
  d.scenes.scenes.forEach((s, i) => {
    if (!touched.includes(s.id)) return;
    const flags = slots[i]!.flags.map((f) => f.message);
    const j = repeats.get(i);
    if (j !== undefined) flags.push(`same background and actions as ${d.scenes.scenes[j]!.id} within 30 s`);
    out.set(s.id, { camera: slots[i]!.shot!.camera !== before[i] ? slots[i]!.shot!.camera : s.camera, flags });
  });
  return out;
}

const stamp = () => new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const body = (shot: Shot) => {
  const { lineIds: _l, ...rest } = shot;
  return rest as Omit<Scene, "id" | "lineIds">;
};

// ---------------------------------------------------------------- regenerate

export async function regenerateScene(id: string, sceneId: string, note: string, o: { count?: number; signal?: AbortSignal } = {}): Promise<SceneOptions> {
  const b = base(id);
  const scenes = b.draft.scenes.scenes;
  const i = scenes.findIndex((s) => s.id === sceneId);
  if (i < 0) throw new EditError(`there is no scene ${sceneId}`);
  const scene = scenes[i]!;
  const count = Math.max(2, Math.min(3, o.count ?? 3));
  const input = { ...common(b), ...neighbourhood(b, i, i), scene, note: note || "make this shot read better", count };
  const out = await callStep({ project: id, step: "regenerate", input, signal: o.signal, check: (r) => r.options.flatMap((x, k) => (x.lineIds.join() === scene.lineIds.join() ? [] : [`option ${k + 1} covers ${x.lineIds.join(", ")}, not the scene's lines ${scene.lineIds.join(", ")}`])) });
  const ctx = ctxFor(b.draft);
  const startOf = (l: string) => b.times.get(l)?.start ?? 0;
  const options: SceneOptions["options"] = [];
  for (const draft of out.options) {
    const n = normalise(draft, scene.lineIds, ctx, b.headfakes);
    if (!n.shot || n.problems.length) continue;
    const op: EditOpIn = { op: "scene.replace", scene: sceneId, with: body(n.shot) };
    let after: Draft;
    try {
      after = applyOps(b.draft, [op as never], { sfxTags: Object.keys(ctx.sfx) }).draft;
    } catch {
      continue; // not valid as a scene (code could not repair it): not offered
    }
    const g = guard(id, after, [sceneId], startOf, b.headfakes).get(sceneId)!;
    (op as { with: { camera: string } }).with.camera = g.camera;
    options.push({ op: op as never, why: draft.why, flags: [...n.flags, ...g.flags] });
  }
  if (!options.length) throw new EditError(`none of Claude's ${out.options.length} options for ${sceneId} could be made valid; try another note`);
  const saved = SceneOptions.parse({ version: 1, id: `${sceneId}-${stamp()}`, project: id, sceneId, note, baseVersion: b.head.n, createdAt: new Date().toISOString(), options });
  mkdirSync(optionsDir(id), { recursive: true });
  writeJson(join(optionsDir(id), `${saved.id}.json`), saved);
  return saved;
}

export const readOptions = (id: string, optionsId: string) => readJson(join(optionsDir(id), `${optionsId}.json`), SceneOptions);

export async function pickOption(id: string, optionsId: string, n: number, o: EditOptions & { label?: string } = {}): Promise<EditResult> {
  const saved = readOptions(id, optionsId);
  if (!saved) throw new EditError(`there are no scene options "${optionsId}" for ${id}`);
  const pick = saved.options[n - 1];
  if (!pick) throw new EditError(`options ${optionsId} has ${saved.options.length} options; pick 1–${saved.options.length}`);
  return applyEdit(id, { label: o.label ?? `${saved.sceneId}: option ${n} of "${saved.note}"`.slice(0, 80), ops: [pick.op] }, o);
}

// ---------------------------------------------------------------- beat

export async function beatEdit(id: string, beat: string, o: EditOptions & { after?: string; before?: string; dryRun?: boolean; label?: string } = {}): Promise<EditResult | { ops: EditOpIn[] }> {
  if (!beat.trim()) throw new EditError("describe the beat");
  const b = base(id);
  const lines = b.draft.script.lines;
  const anchorRef = o.after ?? o.before;
  if (!anchorRef) throw new EditError("say where the beat goes: --after L3.4 (or a scene, --after S12)");
  const sceneAnchor = b.draft.scenes.scenes.find((s) => s.id === anchorRef);
  const afterLine = sceneAnchor ? (o.after ? sceneAnchor.lineIds.at(-1)! : lines[lines.findIndex((l) => l.id === sceneAnchor.lineIds[0]) - 1]?.id) : o.after ? anchorRef : lines[lines.findIndex((l) => l.id === anchorRef) - 1]?.id;
  const k = lines.findIndex((l) => l.id === afterLine);
  if (!afterLine || k < 0) throw new EditError(`cannot place a beat at ${anchorRef}`);
  const loop = afterLine.split(".")[0]!;
  const newLineId = `${loop}.${Math.max(0, ...lines.filter((l) => l.id.startsWith(`${loop}.`)).map((l) => Number(l.id.split(".")[1]))) + 1}`;
  const canCover = lines.slice(k + 1, k + 2).map((l) => l.id);
  const si = b.draft.scenes.scenes.findIndex((s) => s.lineIds.includes(afterLine));
  const input = { ...common(b), ...neighbourhood(b, si, Math.min(si + 1, b.draft.scenes.scenes.length - 1)), beat, after: afterLine, newLineId, canCover };
  const allowed = new Set([newLineId, ...canCover]);
  const out = await callStep({
    project: id,
    step: "beat",
    input,
    signal: o.signal,
    check: (r) => {
      const errors: string[] = [];
      const covered = r.scenes.flatMap((s) => s.lineIds);
      if (covered.some((l) => !allowed.has(l))) errors.push(`shots may cover only ${[...allowed].join(", ")}; they cover ${covered.join(", ")}`);
      if (new Set(covered).size !== covered.length) errors.push("a line is covered twice");
      if (r.line.add && covered[0] !== newLineId) errors.push(`with a new line, the first shot covers ${newLineId}`);
      if (!r.line.add && covered.includes(newLineId)) errors.push(`no new line was added, so no shot may cover ${newLineId}`);
      if (r.line.add && !r.line.text.trim()) errors.push("line.add is true but line.text is empty");
      return errors;
    },
  });
  const ctx = ctxFor(b.draft, out.line.add ? { [newLineId]: wordsOf(out.line.text).length } : {});
  const ops: EditOpIn[] = [];
  if (out.line.add) ops.push({ op: "insert", after: afterLine, line: { text: out.line.text.trim(), energy: out.line.energy, delivery: out.line.delivery } });
  const flags: string[] = [];
  for (const d of out.scenes) {
    const n = normalise(d, d.lineIds, ctx, b.headfakes);
    if (!n.shot || n.problems.length) throw new EditError(`Claude's shot for ${d.lineIds.join(", ")} could not be made valid: ${n.problems.join("; ")}`);
    flags.push(...n.flags);
    ops.push({ op: "insert", scene: { ...body(n.shot), lineIds: d.lineIds } as never });
  }
  // the guard sees the storyboard with the beat in it
  const { draft: after } = applyOps(b.draft, ops as never, { sfxTags: Object.keys(ctx.sfx) });
  const known = new Set(b.draft.scenes.scenes.map((s) => s.id));
  const fresh = after.scenes.scenes.filter((s) => !known.has(s.id)).map((s) => s.id);
  const endOfAnchor = b.times.get(afterLine)?.end ?? 0;
  const g = guard(id, after, fresh, (l) => b.times.get(l)?.start ?? endOfAnchor, b.headfakes);
  const sceneOps = ops.filter((x) => x.op === "insert" && "scene" in x && x.scene) as { scene: { camera: string } }[];
  fresh.forEach((sid, i) => {
    const r = g.get(sid);
    if (r && sceneOps[i]) sceneOps[i]!.scene.camera = r.camera;
    flags.push(...(r?.flags ?? []));
  });
  if (o.dryRun) return { ops };
  const result = await applyEdit(id, { label: o.label ?? `beat: ${beat}`.slice(0, 80), ops: ops as never }, o);
  result.notes.push(...flags.map((f) => `guard: ${f}`), `Claude: ${out.why}`);
  return result;
}

// ---------------------------------------------------------------- fixscenes

export async function fixScenesEdit(id: string, items: { scene: string; note: string }[], o: EditOptions & { signal?: AbortSignal; label?: string } = {}): Promise<EditResult> {
  if (!items.length) throw new EditError("flag at least one scene");
  const b = base(id);
  const scenes = b.draft.scenes.scenes;
  const idx = items.map((x) => {
    const i = scenes.findIndex((s) => s.id === x.scene);
    if (i < 0) throw new EditError(`there is no scene ${x.scene}`);
    return i;
  });
  const input = { ...common(b), ...neighbourhood(b, Math.min(...idx), Math.max(...idx)), fix: items.map((x, k) => ({ sceneId: x.scene, scene: scenes[idx[k]!], note: x.note || "misgenerated" })) };
  const out = await callStep({
    project: id,
    step: "fixscenes",
    input,
    signal: o.signal,
    check: (r) =>
      items.flatMap((x) => {
        const got = r.scenes.find((s) => s.sceneId === x.scene);
        const want = scenes.find((s) => s.id === x.scene)!.lineIds;
        return !got ? [`no fix for ${x.scene}`] : got.scene.lineIds.join() !== want.join() ? [`${x.scene} must keep its lines ${want.join(", ")}`] : [];
      }),
  });
  const ctx = ctxFor(b.draft);
  const ops: EditOpIn[] = [];
  const flags: string[] = [];
  for (const x of items) {
    const got = out.scenes.find((s) => s.sceneId === x.scene)!;
    const n = normalise(got.scene, got.scene.lineIds, ctx, b.headfakes);
    if (!n.shot || n.problems.length) {
      flags.push(`${x.scene} kept as it was: Claude's fix could not be made valid (${n.problems.join("; ")})`);
      continue;
    }
    flags.push(...n.flags.map((f) => `${x.scene}: ${f}`));
    ops.push({ op: "scene.replace", scene: x.scene, with: body(n.shot) });
  }
  if (!ops.length) throw new EditError(`none of the fixes could be made valid:\n  - ${flags.join("\n  - ")}`);
  const { draft: after } = applyOps(b.draft, ops as never, { sfxTags: Object.keys(ctx.sfx) });
  const g = guard(id, after, ops.map((x) => (x as { scene: string }).scene), (l) => b.times.get(l)?.start ?? 0, b.headfakes);
  for (const op of ops as { scene: string; with: { camera: string } }[]) {
    const r = g.get(op.scene);
    if (r) {
      op.with.camera = r.camera;
      flags.push(...r.flags.map((f) => `${op.scene}: ${f}`));
    }
  }
  const result = await applyEdit(id, { label: o.label ?? `fixed ${items.map((x) => x.scene).join(", ")}`, ops: ops as never }, o);
  result.notes.push(...flags);
  return result;
}

