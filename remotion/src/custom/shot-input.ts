import type { Project, ShotLine, ShotWord } from "@studio/schema";
import type { Timeline } from "../scene/timeline";

/**
 * What a scene gives its custom shot, as plain data (React-free, so the segment
 * planner and the worker can read it): its frames, and its words and lines with
 * frames counted from the scene's first frame.
 */
export type ShotInput = { frames: number; fps: number; words: ShotWord[]; lines: ShotLine[] };

export function shotInputFor(project: Project, timeline: Timeline, index: number): ShotInput {
  const scene = project.scenes.scenes[index]!;
  const timed = timeline.scenes[index]!;
  const words = timeline.words
    .filter((w) => w.sceneIndex === index)
    .map((w) => ({ text: w.text, lineId: w.lineId, index: w.index, start: w.start - timed.start, end: w.end - timed.start }));
  const text = new Map(project.script.lines.map((l) => [l.id, l.text]));
  const lines = scene.lineIds.flatMap((id) => {
    const own = words.filter((w) => w.lineId === id);
    return own.length ? [{ id, text: text.get(id) ?? "", start: own[0]!.start, end: own[own.length - 1]!.end }] : [];
  });
  return { frames: timed.frames, fps: timeline.fps, words, lines };
}
