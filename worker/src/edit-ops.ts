/**
 * The edit operations (EditOp, packages/schema/src/edit.ts) applied to a draft
 * copy of a version. Pure: no audio, no rendering, no files. The engine
 * (src/edit.ts) voices, assembles, mixes and commits what comes out.
 *
 * Invariants checked after every edit (`checkDraft`):
 * - every script line is in exactly one scene, scenes follow script order and
 *   each scene's lines are consecutive (scenes start on their first line's
 *   first word: remotion/src/scene/timeline.ts);
 * - scene ids are never renumbered (an id seeds the scene's idle motion, so a
 *   renumbered scene would draw differently and need a new render);
 * - the narration and script.json agree (script.json is derived from it);
 * - no line's text changed, and no line went, unless an operation named it.
 */
import {
  NarrationFile,
  SceneFile,
  narrationToScript,
  type EditOp,
  type FxFile,
  type NarrationFile as Narration,
  type Scene,
  type ScriptFile,
  type StoryboardFile,
  closest,
  formatIssues,
} from "@studio/schema";
import { comboOf } from "./storyboard";

export class EditError extends Error {
  override name = "EditError";
}

export type Overrides = Record<string, { seed?: number; energy?: number }>;

export type Draft = {
  script: ScriptFile;
  /** the story engine's narration; absent for a bare script (the lighthouse sample) */
  narration?: Narration;
  scenes: SceneFile;
  report: StoryboardFile;
  overrides: Overrides;
  fx: FxFile;
};

export type OpContext = {
  /** sfx tags in the asset library; [] skips the check */
  sfxTags: readonly string[];
  /** lines an operation named explicitly (the only ones whose text may change or that may go) */
  explicit: Set<string>;
  /** notes for the person (a tag mapped to the closest one, an overlay dropped…) */
  notes: string[];
};

export const clone = <T>(v: T): T => structuredClone(v);
export const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);
const loopOf = (lineId: string) => lineId.split(".")[0]!;
const lineOf = (ref: string) => ref.split(":")[0]!;
const wordOf = (ref: string) => Number(ref.split(":")[1]);

// ---------------------------------------------------------------- lines (narration + script together)

function lineIndex(d: Draft): Map<string, number> {
  return new Map(d.script.lines.map((l, i) => [l.id, i]));
}

function requireLine(d: Draft, id: string) {
  const line = d.script.lines.find((l) => l.id === id);
  if (!line) throw new EditError(`there is no line ${id}`);
  return line;
}

/** Changes the narration (when there is one) and re-derives script.json from it, as locking does. */
function editLines(d: Draft, fn: (lines: { id: string; text: string; energy: number; delivery: string }[], loops?: Narration["loops"]) => void): void {
  if (d.narration) {
    fn(d.narration.loops.flatMap((l) => l.lines), d.narration.loops);
    d.narration.updatedAt = new Date().toISOString();
    d.script = narrationToScript(d.narration);
  } else fn(d.script.lines);
}

function nextLineId(d: Draft, loop: string): string {
  const used = d.script.lines.filter((l) => loopOf(l.id) === loop).map((l) => Number(l.id.split(".")[1]));
  return `${loop}.${Math.max(0, ...used) + 1}`;
}

function nextSceneId(d: Draft): string {
  return `S${Math.max(0, ...d.scenes.scenes.map((s) => Number(s.id.slice(1)))) + 1}`;
}

/** Inserts a line at script position `at` (0 = first), inside `loop`. */
function insertLine(d: Draft, at: number, loop: string, line: { text: string; energy: number; delivery: string }): string {
  const id = nextLineId(d, loop);
  const before = d.script.lines[at - 1];
  editLines(d, (_lines, loops) => {
    if (loops) {
      const target = loops.find((l) => l.id === loop);
      if (!target) throw new EditError(`there is no loop ${loop}`);
      const k = before && loopOf(before.id) === loop ? target.lines.findIndex((l) => l.id === before.id) + 1 : 0;
      target.lines.splice(k, 0, { id, text: line.text, energy: line.energy, delivery: line.delivery, beats: [], plants: [], payoffs: [], locked: false, sources: [] });
    } else d.script.lines.splice(at, 0, { id, ...line });
  });
  return id;
}

function removeLine(d: Draft, id: string): void {
  editLines(d, (_lines, loops) => {
    if (loops) {
      const loop = loops.find((l) => l.lines.some((x) => x.id === id))!;
      if (loop.lines.length === 1) throw new EditError(`${id} is the only line of loop ${loop.id}; a loop needs at least one line`);
      loop.lines = loop.lines.filter((x) => x.id !== id);
    } else d.script.lines = d.script.lines.filter((l) => l.id !== id);
  });
  for (const s of d.scenes.scenes) {
    s.lineIds = s.lineIds.filter((x) => x !== id);
    s.sfx = s.sfx.filter((x) => lineOf(x.at) !== id);
    s.overlays = s.overlays.filter((o) => !o.at || lineOf(o.at) !== id);
  }
  d.scenes.scenes = d.scenes.scenes.filter((s) => s.lineIds.length);
  d.report.reveals = d.report.reveals.filter((r) => r.lineId !== id);
  delete d.fx.lines[id];
  delete d.overrides[id];
}

/**
 * Where an old word index lands in a rewritten line: words both texts share
 * keep their place (longest common subsequence); a word that went maps to
 * the nearest surviving one before it.
 */
export function remapWords(oldText: string, newText: string): (index: number) => number {
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  const a = wordsOf(oldText).map(norm);
  const b = wordsOf(newText).map(norm);
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const map = new Map<number, number>();
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) map.set(i++, j++);
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return (index) => {
    for (let i = index; i >= 0; i--) if (map.has(i)) return Math.min(map.get(i)! + (index - i), b.length - 1);
    return Math.min(index, b.length - 1);
  };
}

function remapLineRefs(d: Draft, lineId: string, map: (i: number) => number): void {
  const fix = (ref: string) => (lineOf(ref) === lineId ? `${lineId}:${map(wordOf(ref))}` : ref);
  for (const s of d.scenes.scenes) {
    s.sfx = s.sfx.map((x) => ({ ...x, at: fix(x.at) }));
    s.overlays = s.overlays.map((o) => (o.at ? { ...o, at: fix(o.at) } : o));
  }
  d.report.reveals = d.report.reveals.map((r) => (r.lineId === lineId ? { ...r, at: fix(r.at) } : r));
  const fx = d.fx.lines[lineId];
  if (fx) d.fx.lines[lineId] = fx.map((e) => (e.word === undefined ? e : { ...e, word: map(e.word) }));
}

// ---------------------------------------------------------------- scenes

function requireScene(d: Draft, id: string): Scene {
  const s = d.scenes.scenes.find((x) => x.id === id);
  if (!s) throw new EditError(`there is no scene ${id}`);
  return s;
}

const sceneOfLine = (d: Draft, lineId: string) => d.scenes.scenes.find((s) => s.lineIds.includes(lineId));

/** Scenes back in script order (by their first line). */
function sortScenes(d: Draft): void {
  const idx = lineIndex(d);
  d.scenes.scenes.sort((a, b) => idx.get(a.lineIds[0]!)! - idx.get(b.lineIds[0]!)!);
  for (const s of d.scenes.scenes) s.lineIds.sort((x, y) => idx.get(x)! - idx.get(y)!);
}

/** Moves lines (and the sound effects on them) from one scene to another. */
function moveLines(from: Scene, to: Scene, lines: string[]): void {
  from.lineIds = from.lineIds.filter((l) => !lines.includes(l));
  to.lineIds.push(...lines);
  to.sfx.push(...from.sfx.filter((x) => lines.includes(lineOf(x.at))));
  from.sfx = from.sfx.filter((x) => !lines.includes(lineOf(x.at)));
  from.overlays = from.overlays.filter((o) => !o.at || !lines.includes(lineOf(o.at)));
}

/**
 * Gives a run of consecutive lines to new scenes: the lines leave the scenes
 * that held them (a scene left empty goes; a scene cut in two keeps its id
 * for the first part and the second gets a new one), and their sound effects
 * follow them unless a new scene brings its own for that line.
 */
export function coverLines(d: Draft, lines: string[], scenes: Omit<Scene, "id">[], ctx: OpContext): string[] {
  const idx = lineIndex(d);
  const pos = lines.map((l) => {
    const i = idx.get(l);
    if (i === undefined) throw new EditError(`there is no line ${l}`);
    return i;
  });
  if (pos.some((p, k) => k && p !== pos[k - 1]! + 1)) throw new EditError(`lines ${lines.join(", ")} are not consecutive in the script`);
  const covered = scenes.flatMap((s) => s.lineIds);
  if (covered.join() !== lines.join()) throw new EditError(`the new scenes must cover ${lines.join(", ")} once each, in order (they cover ${covered.join(", ")})`);
  const carried = new Map<string, Scene["sfx"]>();
  for (const s of [...d.scenes.scenes]) {
    const mine = s.lineIds.filter((l) => lines.includes(l));
    if (!mine.length) continue;
    for (const l of mine) carried.set(l, s.sfx.filter((x) => lineOf(x.at) === l));
    const dropped = s.overlays.filter((o) => o.at && mine.includes(lineOf(o.at)));
    if (dropped.length) ctx.notes.push(`${s.id}: ${dropped.length} overlay(s) on the restaged lines were dropped`);
    const rest = s.lineIds.filter((l) => !lines.includes(l));
    const head = rest.filter((l) => idx.get(l)! < pos[0]!);
    const tail = rest.filter((l) => idx.get(l)! > pos.at(-1)!);
    const keepSfx = (ls: string[]) => s.sfx.filter((x) => ls.includes(lineOf(x.at)));
    const keepOverlays = (ls: string[]) => s.overlays.filter((o) => !o.at || ls.includes(lineOf(o.at)));
    if (!head.length && !tail.length) d.scenes.scenes = d.scenes.scenes.filter((x) => x !== s);
    else if (head.length && tail.length) {
      Object.assign(s, { lineIds: head, sfx: keepSfx(head), overlays: keepOverlays(head) });
      const second = { ...clone(s), id: nextSceneId(d), lineIds: tail, sfx: keepSfx(tail), overlays: s.overlays.filter((o) => o.at && tail.includes(lineOf(o.at))) };
      d.scenes.scenes.push(second);
      ctx.notes.push(`${s.id} was cut in two around the new scene; its second part is ${second.id}`);
    } else {
      const ls = head.length ? head : tail;
      Object.assign(s, { lineIds: ls, sfx: keepSfx(ls), overlays: keepOverlays(ls) });
    }
  }
  const ids: string[] = [];
  for (const sc of scenes) {
    const id = nextSceneId(d);
    const own = new Set(sc.sfx.map((x) => lineOf(x.at)));
    const sfx = [...sc.sfx, ...sc.lineIds.filter((l) => !own.has(l)).flatMap((l) => carried.get(l) ?? [])];
    d.scenes.scenes.push({ ...clone(sc), id, sfx });
    ids.push(id);
  }
  sortScenes(d);
  return ids;
}

function neighbour(d: Draft, s: Scene, dir: -1 | 1): Scene | undefined {
  return d.scenes.scenes[d.scenes.scenes.indexOf(s) + dir];
}

// ---------------------------------------------------------------- sfx

function mapTag(tag: string, ctx: OpContext): string {
  if (!ctx.sfxTags.length || ctx.sfxTags.includes(tag)) return tag;
  const near = closest(tag, ctx.sfxTags as string[]);
  if (!near) throw new EditError(`there is no sound "${tag}" in the library (sounds: ${ctx.sfxTags.join(", ")})`);
  ctx.notes.push(`sound "${tag}" is not in the library; used "${near}"`);
  return near;
}

function checkWord(d: Draft, ref: string): void {
  const line = requireLine(d, lineOf(ref));
  const n = wordsOf(line.text).length;
  if (wordOf(ref) >= n) throw new EditError(`${ref}: line ${line.id} has ${n} words (0–${n - 1})`);
}

// ---------------------------------------------------------------- the operations

export function applyOp(d: Draft, op: EditOp, ctx: OpContext): void {
  switch (op.op) {
    case "scene.set": {
      const s = requireScene(d, op.scene);
      for (const key of ["bg", "grade", "camera", "transitionIn", "caption"] as const) if (op[key] !== undefined) (s as Record<string, unknown>)[key] = op[key];
      for (const key of ["weather", "framing"] as const) {
        if (op[key] === null) delete s[key];
        else if (op[key] !== undefined) (s as Record<string, unknown>)[key] = op[key];
      }
      for (const patch of op.chars ?? []) {
        const c = s.chars.find((x) => x.id === patch.id);
        if (!c) throw new EditError(`${s.id} has no character "${patch.id}" (it has: ${s.chars.map((x) => x.id).join(", ") || "nobody"})`);
        for (const key of ["action", "expr", "pos"] as const) if (patch[key] !== undefined) (c as Record<string, unknown>)[key] = patch[key];
        for (const key of ["to", "facing", "look"] as const) {
          if (patch[key] === null) delete c[key];
          else if (patch[key] !== undefined) (c as Record<string, unknown>)[key] = patch[key];
        }
      }
      if (op.props) s.props = clone(op.props);
      if (op.overlays) s.overlays = clone(op.overlays);
      return;
    }
    case "scene.replace": {
      const s = requireScene(d, op.scene);
      const keep = { id: s.id, lineIds: s.lineIds };
      for (const k of Object.keys(s)) delete (s as Record<string, unknown>)[k];
      Object.assign(s, keep, clone(op.with));
      s.sfx = s.sfx.filter((x) => s.lineIds.includes(lineOf(x.at)));
      return;
    }
    case "line.set": {
      const line = requireLine(d, op.line);
      ctx.explicit.add(op.line);
      const oldText = line.text;
      editLines(d, (lines) => {
        const l = lines.find((x) => x.id === op.line)!;
        if (op.text !== undefined) l.text = op.text;
        if (op.energy !== undefined) l.energy = op.energy;
        if (op.delivery !== undefined) l.delivery = op.delivery;
      });
      if (op.energy !== undefined && d.overrides[op.line]?.energy !== undefined) delete d.overrides[op.line]!.energy; // the line's own energy wins over an old retake's
      if (op.seed !== undefined) d.overrides[op.line] = { ...d.overrides[op.line], seed: op.seed };
      if (d.overrides[op.line] && !Object.keys(d.overrides[op.line]!).length) delete d.overrides[op.line];
      if (op.text !== undefined && op.text !== oldText) remapLineRefs(d, op.line, remapWords(oldText, op.text));
      return;
    }
    case "line.delete": {
      requireLine(d, op.line);
      ctx.explicit.add(op.line);
      removeLine(d, op.line);
      return;
    }
    case "insert": {
      const idx = lineIndex(d);
      let lineId: string | undefined;
      if (op.line) {
        const anchor = (op.after ?? op.before)!;
        const isScene = anchor.startsWith("S");
        const ref = isScene ? requireScene(d, anchor) : undefined;
        const anchorLine = isScene ? (op.after ? ref!.lineIds.at(-1)! : ref!.lineIds[0]!) : (requireLine(d, anchor), anchor);
        const at = idx.get(anchorLine)! + (op.after ? 1 : 0);
        lineId = insertLine(d, at, loopOf(anchorLine), { text: op.line.text, energy: op.line.energy, delivery: op.line.delivery });
        ctx.explicit.add(lineId);
        // the new line joins its anchor's scene; a new scene then takes it out (coverLines)
        const host = ref ?? sceneOfLine(d, anchorLine)!;
        host.lineIds.push(lineId);
        sortScenes(d);
      }
      if (op.scene) {
        const { lineIds, ...body } = op.scene;
        const lines = lineIds ?? [lineId!];
        coverLines(d, lines, [{ ...clone(body), lineIds: lines } as Omit<Scene, "id">], ctx);
      }
      return;
    }
    case "sfx.add": {
      checkWord(d, op.at);
      const tag = mapTag(op.tag, ctx);
      const s = sceneOfLine(d, lineOf(op.at))!;
      s.sfx.push({ tag, at: op.at });
      return;
    }
    case "sfx.move":
    case "sfx.delete": {
      const at = op.op === "sfx.move" ? op.from : op.at;
      const s = d.scenes.scenes.find((x) => x.sfx.some((c) => c.tag === op.tag && c.at === at));
      if (!s) throw new EditError(`there is no sound "${op.tag}" at ${at}`);
      const k = s.sfx.findIndex((c) => c.tag === op.tag && c.at === at);
      s.sfx.splice(k, 1);
      if (op.op === "sfx.move") {
        checkWord(d, op.to);
        sceneOfLine(d, lineOf(op.to))!.sfx.push({ tag: op.tag, at: op.to });
      }
      return;
    }
    case "fx": {
      const line = requireLine(d, op.line);
      if (op.word !== undefined && op.word >= wordsOf(line.text).length) throw new EditError(`${op.line} has ${wordsOf(line.text).length} words (0–${wordsOf(line.text).length - 1})`);
      const list = (d.fx.lines[op.line] ?? []).filter((e) => (op.preset === "none" && op.word === undefined ? false : e.word !== op.word));
      if (op.preset !== "none") list.push({ preset: op.preset, ...(op.word === undefined ? {} : { word: op.word }) });
      if (list.length) d.fx.lines[op.line] = list;
      else delete d.fx.lines[op.line];
      return;
    }
    case "scene.trim": {
      const s = requireScene(d, op.scene);
      const prev = neighbour(d, s, -1);
      const next = neighbour(d, s, 1);
      const start = op.start ?? 0;
      const end = op.end ?? 0;
      const need = (n: Scene | undefined, side: string) => {
        if (!n) throw new EditError(`${s.id} has no scene ${side} it to trade lines with`);
        return n;
      };
      if (start > 0) moveLines(s, need(prev, "before"), s.lineIds.slice(0, start));
      if (start < 0) moveLines(need(prev, "before"), s, prev!.lineIds.slice(start));
      if (end > 0) moveLines(s, need(next, "after"), s.lineIds.slice(-end));
      if (end < 0) moveLines(need(next, "after"), s, next!.lineIds.slice(0, -end));
      for (const x of [prev, s, next]) if (x && !x.lineIds.length) throw new EditError(`trimming ${s.id} would leave ${x.id} with no line; delete a scene instead`);
      sortScenes(d);
      return;
    }
    case "scene.move": {
      const s = requireScene(d, op.scene);
      const loop = loopOf(s.lineIds[0]!);
      if (s.lineIds.some((l) => loopOf(l) !== loop)) throw new EditError(`${s.id} spans two loops; it cannot move`);
      const target = op.after ? requireScene(d, op.after) : undefined;
      if (target && (target === s)) throw new EditError("a scene cannot move after itself");
      if (target && loopOf(target.lineIds.at(-1)!) !== loop) throw new EditError(`${s.id} is in loop ${loop} and ${target.id} ends in loop ${loopOf(target.lineIds.at(-1)!)}: scenes move only within their loop (line ids carry the loop)`);
      const moving = s.lineIds;
      editLines(d, (_lines, loops) => {
        const reorder = (list: { id: string }[]) => {
          const taken = list.filter((l) => moving.includes(l.id));
          const rest = list.filter((l) => !moving.includes(l.id));
          const k = target ? rest.findIndex((l) => l.id === target.lineIds.at(-1)) + 1 : rest.findIndex((l) => loopOf(l.id) === loop);
          rest.splice(k, 0, ...taken);
          return rest;
        };
        if (loops) {
          const l = loops.find((x) => x.id === loop)!;
          l.lines = reorder(l.lines) as typeof l.lines;
        } else d.script.lines = reorder(d.script.lines) as typeof d.script.lines;
      });
      sortScenes(d);
      return;
    }
    case "scene.delete": {
      const s = requireScene(d, op.scene);
      if (op.lines === "cut") {
        for (const l of [...s.lineIds]) {
          ctx.explicit.add(l);
          removeLine(d, l);
        }
        return;
      }
      const into = neighbour(d, s, -1) ?? neighbour(d, s, 1);
      if (!into) throw new EditError(`${s.id} is the only scene`);
      moveLines(s, into, [...s.lineIds]);
      d.scenes.scenes = d.scenes.scenes.filter((x) => x !== s);
      sortScenes(d);
      return;
    }
  }
}

// ---------------------------------------------------------------- after the operations

/** Everything that must hold before a draft is voiced and committed. Throws EditError with every problem. */
export function checkDraft(base: Draft, d: Draft, ctx: OpContext): void {
  const problems: string[] = [];
  const parsed = SceneFile.safeParse(d.scenes);
  if (!parsed.success) problems.push(...formatIssues("scenes.json", d.scenes, parsed.error.issues));
  if (d.narration) {
    const n = NarrationFile.safeParse(d.narration);
    if (!n.success) problems.push(...formatIssues("narration.json", d.narration, n.error.issues));
  }
  const idx = lineIndex(d);
  const seen = new Map<string, string>();
  let last = -1;
  for (const s of d.scenes.scenes) {
    const pos = s.lineIds.map((l) => idx.get(l));
    if (pos.some((p) => p === undefined)) problems.push(`${s.id} covers a line that is not in the script (${s.lineIds.join(", ")})`);
    for (const l of s.lineIds) {
      if (seen.has(l)) problems.push(`${l} is in ${seen.get(l)} and ${s.id}`);
      seen.set(l, s.id);
    }
    const p = pos.filter((x): x is number => x !== undefined);
    if (p.some((x, k) => k && x !== p[k - 1]! + 1)) problems.push(`${s.id}'s lines are not consecutive (${s.lineIds.join(", ")})`);
    if (p.length && p[0]! < last) problems.push(`${s.id} is out of script order`);
    last = p.at(-1) ?? last;
  }
  for (const l of d.script.lines) if (!seen.has(l.id)) problems.push(`line ${l.id} is in no scene`);
  const ids = d.scenes.scenes.map((s) => s.id);
  if (new Set(ids).size !== ids.length) problems.push("two scenes share an id");
  // locked lines: only explicitly named lines may change text or go
  const now = new Map(d.script.lines.map((l) => [l.id, l.text]));
  for (const l of base.script.lines) {
    if (ctx.explicit.has(l.id)) continue;
    if (!now.has(l.id)) problems.push(`line ${l.id} would be removed, but no operation names it`);
    else if (now.get(l.id) !== l.text) problems.push(`line ${l.id}'s text would change, but no operation names it`);
  }
  for (const [lineId, effects] of Object.entries(d.fx.lines)) {
    if (!now.has(lineId)) problems.push(`a voice effect is set on ${lineId}, which is not in the script`);
    const n = wordsOf(now.get(lineId) ?? "").length;
    for (const e of effects) if (e.word !== undefined && e.word >= n) problems.push(`voice effect on ${lineId} word ${e.word}: the line has ${n} words`);
  }
  if (problems.length) throw new EditError(`the edit would break the project:\n  - ${problems.join("\n  - ")}`);
}

/** The storyboard report's own bookkeeping after scenes changed (combos for the cross-video variety guard, counts). */
export function refreshReport(d: Draft): void {
  d.report.combos = [...new Set(d.scenes.scenes.map((s) => comboOf(s as never)))];
  d.report.stats = { ...d.report.stats, scenes: d.scenes.scenes.length, lines: d.script.lines.length };
  const lines = new Set(d.script.lines.map((l) => l.id));
  d.report.reveals = d.report.reveals.filter((r) => lines.has(r.lineId));
}

export function applyOps(base: Draft, ops: readonly EditOp[], o: { sfxTags: readonly string[] }): { draft: Draft; ctx: OpContext } {
  const draft = clone(base);
  const ctx: OpContext = { sfxTags: o.sfxTags, explicit: new Set(), notes: [] };
  ops.forEach((op, i) => {
    try {
      applyOp(draft, op, ctx);
    } catch (e) {
      if (e instanceof EditError) throw new EditError(`operation ${i + 1} (${op.op}): ${e.message}`);
      throw e;
    }
  });
  checkDraft(base, draft, ctx);
  refreshReport(draft);
  return { draft, ctx };
}
