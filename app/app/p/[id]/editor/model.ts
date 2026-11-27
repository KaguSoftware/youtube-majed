/**
 * The editor's pure logic: no React, no fetching. A scene being edited is a
 * draft copy of the committed one; `sceneSetOp` turns the difference into the
 * engine's `scene.set` operation, so what is previewed is exactly what is
 * committed.
 */
import type { EditOpIn, Project, RenderRecord, Scene } from "@studio/schema";
import type { Timeline, TimelineLine, TimelineScene } from "@/lib/editor";

export type Selection =
  | { kind: "scene"; id: string }
  | { kind: "line"; id: string; word?: number }
  | { kind: "sfx"; scene: string; tag: string; at: string }
  | null;

export const loopOf = (lineId: string) => lineId.split(".")[0]!;
export const wordRef = (line: string, word: number) => `${line}:${word}`;
export const parseWordRef = (ref: string) => {
  const [line, w] = ref.split(":");
  return { line: line!, word: Number(w) };
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The `scene.set` that turns `from` into `to` (library ids only), or null when nothing differs. */
export function sceneSetOp(from: Scene, to: Scene): EditOpIn | null {
  const op: Record<string, unknown> = { op: "scene.set", scene: from.id };
  for (const k of ["bg", "grade", "camera", "transitionIn", "caption"] as const) if (from[k] !== to[k]) op[k] = to[k];
  for (const k of ["weather", "framing"] as const) if (from[k] !== to[k]) op[k] = to[k] ?? null;
  const chars = to.chars.flatMap((c) => {
    const was = from.chars.find((x) => x.id === c.id);
    if (!was) return [];
    const patch: Record<string, unknown> = { id: c.id };
    for (const k of ["action", "expr", "pos"] as const) if (was[k] !== c[k]) patch[k] = c[k];
    for (const k of ["to", "facing", "look"] as const) if (was[k] !== c[k]) patch[k] = c[k] ?? null;
    return Object.keys(patch).length > 1 ? [patch] : [];
  });
  if (chars.length) op.chars = chars;
  if (!same(from.props, to.props)) op.props = to.props;
  if (!same(from.overlays, to.overlays)) op.overlays = to.overlays;
  return Object.keys(op).length > 2 ? (op as EditOpIn) : null;
}

/** The project with one scene swapped for a draft: what the Player shows while you choose. */
export function withScene(p: Project, scene: Scene): Project {
  return { ...p, scenes: { ...p.scenes, scenes: p.scenes.scenes.map((s) => (s.id === scene.id ? scene : s)) } };
}

/** Where to show a scene when it is selected: a few frames in, past its transition, so the shot itself is on screen. */
export const sceneFrame = (s: { start: number; frames: number }) => s.start + Math.min(15, Math.floor(s.frames / 4));

export function sceneIndexAt(scenes: readonly TimelineScene[], frame: number): number {
  let lo = 0;
  let hi = scenes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (scenes[mid]!.start <= frame) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The line being spoken at a frame, or the last one before it (between lines). */
export function lineAt(lines: readonly TimelineLine[], seconds: number): TimelineLine | undefined {
  let found: TimelineLine | undefined;
  for (const l of lines) {
    if (l.offset <= seconds) found = l;
    else break;
  }
  return found;
}

/** The word being spoken at a time (or the nearest one before it, in that line). */
export function wordAt(line: TimelineLine, seconds: number): number {
  let i = 0;
  line.words.forEach((w, j) => {
    if (w.start <= seconds) i = j;
  });
  return i;
}

/** Seconds of a word reference, from the timeline. */
export function wordTime(t: Timeline, ref: string): number | undefined {
  const { line, word } = parseWordRef(ref);
  return t.lines.find((l) => l.id === line)?.words[word]?.start;
}

/** The scenes of one loop, in order; scene.move only works within a loop. */
export function loopScenes(t: Timeline, sceneId: string): TimelineScene[] {
  const s = t.scenes.find((x) => x.id === sceneId);
  if (!s) return [];
  const loop = loopOf(s.lineIds[0]!);
  return t.scenes.filter((x) => loopOf(x.lineIds[0]!) === loop);
}

// ---------------------------------------------------------------- the estimate for "Update video"

/** Measured on elevator-13 (remotion/README.md): used until this project has a render of its own to learn from. */
const DEFAULTS = { preview: { fps: 110, overheadS: 12 }, final: { fps: 70, overheadS: 20 } };

export type Dirty = { scenes: number; frames: number };

export function dirtyOf(t: Timeline, profile: "preview" | "final"): Dirty {
  const d = t.scenes.filter((s) => !s.drawn[profile]);
  return { scenes: d.length, frames: d.reduce((n, s) => n + s.frames, 0) };
}

/** Seconds a render will take: the frames to draw at the speed of this project's last render, plus what the last render spent outside drawing (mix, bundle, joining, sound). */
export function estimateS(dirty: Dirty, profile: "preview" | "final", last: RenderRecord | null): number {
  const d = DEFAULTS[profile];
  const fps = last && last.timings.framesPerSecond > 5 ? last.timings.framesPerSecond : d.fps;
  // bundling and joining are recorded; the mix check, the probe and (for the export) the thumbnails add a few seconds. A one-off re-mix is not counted.
  const overheadS = last ? (last.timings.bundleMs + last.timings.encodeMs) / 1000 + (profile === "final" ? 6 : 4) : d.overheadS;
  return dirty.frames / fps + overheadS;
}
