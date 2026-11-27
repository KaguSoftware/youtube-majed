import { sceneStyle, type CastMember, type Project, type Scene, type SceneFile } from "@studio/schema";
import { createHash } from "node:crypto";
import { shotInputFor } from "../custom/shot-input";
import { buildTimeline, type Timeline } from "./timeline";
import { TRANSITION_FRAMES } from "./transitions";

/**
 * Partial re-render (docs/PLAN.md section 8): the video is drawn in
 * segments, one per scene, each a frame range of the full composition, and
 * each cached by a hash of everything that can change a pixel in that range.
 * After an edit only segments whose hash changed are drawn again; the rest
 * are stitched back from the cache.
 *
 * Segment i covers scene i's own frames, [start, start + frames). What can be
 * on screen there:
 *
 * - every scene Sequence that overlaps the range. That is scene i, and the
 *   previous scene while its tail runs under scene i's transition
 *   (TRANSITION_FRAMES), or further back if scenes are shorter than a
 *   transition. Each with its whole scene object (the id seeds idle motion),
 *   the cast looks it uses, the art style it is drawn in when that is not
 *   stick (style.ts: the project's style or the scene's own, after the
 *   low-poly fallback), its length, and the next scene's transition
 *   (it shapes the outro: dip, iris, wipe push);
 * - caption chunks and overlays that overlap the range.
 *
 * Positions are stored relative to the segment's first frame. Every animation
 * in the library reads Sequence-relative frames, and captions and overlays
 * read `frame - start`, so a scene that only moved later by whole frames has
 * the same hash and is reused. Sound effects are not drawn, so they are not
 * in the hash (an SFX edit re-mixes the audio and re-renders nothing).
 *
 * The key also holds the render code hash (library + schema + fonts) and the
 * encode profile, so a library change or another profile never reuses a file.
 */

export const SEGMENT_FORMAT = 1;

export type SegmentProfile = { width: number; height: number; crf: number; preset: string; jpegQuality: number; pixelFormat: "yuv420p"; codec: "h264" };

export type Segment = {
  index: number;
  sceneId: string;
  /** first frame of the segment in the full composition */
  start: number;
  frames: number;
  key: string;
  /** scene ids whose Sequences draw in this segment (the scene itself, and any earlier one still in its outro) */
  layers: string[];
};

export type SegmentPlan = { timeline: Timeline; segments: Segment[]; total: number };

/** JSON with sorted keys, so equal content always hashes the same. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const sha = (v: unknown) => createHash("sha256").update(stableStringify(v)).digest("hex");

/** What a scene's Sequence draws, minus what is never drawn (sound effects). */
function drawn(scene: Scene, cast: Record<string, CastMember>, file: Pick<SceneFile, "artStyle">) {
  const { sfx: _sfx, ...rest } = scene;
  // the art style the scene is drawn in (the project's style is not in the scene object); absent for stick, so stick keys are unchanged
  const style = sceneStyle(file, scene).drawn;
  return { scene: rest, cast: Object.fromEntries(scene.chars.map((c) => [c.id, cast[c.id]])), ...(style === "stick" ? {} : { style }) };
}

export type PlanOptions = {
  code: string;
  profile: SegmentProfile;
  /** Custom shots drawn in place of a scene: scene id → the source hash (docs/PLAN.md section 6, custom-shots.ts in @studio/project) */
  custom?: Readonly<Record<string, string>>;
};

export function planSegments(project: Project, o: PlanOptions): SegmentPlan {
  // the tall frame lays scenes out and cuts captions differently (scene/portrait.ts), so it draws different pixels
  const portrait = o.profile.height > o.profile.width;
  const timeline = buildTimeline(project, { portrait });
  const scenes = project.scenes.scenes;
  const cast = project.scenes.cast;
  const seqs = timeline.scenes.map((t, i) => {
    const next = scenes[i + 1];
    const overlap = next ? TRANSITION_FRAMES[next.transitionIn] : 0;
    return { i, from: t.start, end: t.start + t.frames + overlap, frames: t.frames, next: next?.transitionIn ?? null };
  });

  const segments = timeline.scenes.map((t, index): Segment => {
    const a = t.start;
    const b = t.start + t.frames;
    const over = <T extends { start: number; end: number }>(x: T) => x.start < b && x.end > a;
    const layers = seqs.filter((s) => s.from < b && s.end > a);
    const spec = {
      format: SEGMENT_FORMAT,
      frames: t.frames,
      layers: layers.map((s) => {
        const scene = scenes[s.i]!;
        const source = o.custom?.[scene.id];
        // a shot is keyed by its source and by what it is given (frames, word and line frames, the scene it stands in for),
        // so editing the words it reacts to redraws it and nothing else does
        const shot = source ? { source, input: shotInputFor(project, timeline, s.i) } : undefined;
        return { from: s.from - a, length: s.end - s.from, frames: s.frames, next: s.next, ...drawn(scene, cast, project.scenes), ...(shot ? { shot } : {}) };
      }),
      overlays: timeline.overlays.filter(over).map((x) => ({ overlay: x.overlay, start: x.start - a, end: x.end - a })),
      chunks: timeline.chunks.filter(over).map((c) => ({ style: c.style, start: c.start - a, end: c.end - a, words: c.words.map((w) => ({ text: w.text, start: w.start - a, end: w.end - a })) })),
    };
    const key = sha({ code: o.code, profile: o.profile, spec }).slice(0, 24);
    return { index, sceneId: scenes[index]!.id, start: a, frames: t.frames, key, layers: layers.map((s) => scenes[s.i]!.id) };
  });
  return { timeline, segments, total: timeline.total };
}

/**
 * What a custom shot was checked with: its scene's frames, word and line frames and the library scene it stands in for.
 * A scene that is trimmed or re-voiced changes it, and the shot is checked again before the next render.
 */
export function shotInputsHash(project: Project, timeline: Timeline, index: number): string {
  const scene = project.scenes.scenes[index]!;
  return sha({ input: shotInputFor(project, timeline, index), ...drawn(scene, project.scenes.cast, project.scenes) }).slice(0, 16);
}
