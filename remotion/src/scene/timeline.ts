import type { Project } from "@studio/schema";

/**
 * Turns a validated project into frame numbers: where each scene starts and
 * ends, and (Phase 0 only) estimated word timings for captions. From Phase 1
 * the word timings come from WhisperX instead of this estimate.
 */

export type TimedScene = { index: number; start: number; frames: number };
export type TimedWord = { text: string; start: number; end: number; lineId: string; sceneIndex: number };
export type Chunk = { words: TimedWord[]; start: number; end: number; style: "word_pop" };

export type Timeline = { fps: number; total: number; scenes: TimedScene[]; words: TimedWord[]; chunks: Chunk[] };

const LEAD_IN = 4; // frames of silence at the start of a scene
const TAIL = 6; // frames of silence at the end
const MAX_WORDS = 3;
const MAX_CHARS = 20;
const BREAK = /[,.!?;:…—]$/;

export function buildTimeline(p: Project): Timeline {
  const fps = p.timing.fps;
  const lines = new Map(p.script.lines.map((l) => [l.id, l]));
  const scenes: TimedScene[] = [];
  const words: TimedWord[] = [];
  const chunks: Chunk[] = [];
  let cursor = 0;

  p.scenes.scenes.forEach((scene, index) => {
    const frames = Math.round(p.timing.seconds[scene.id]! * fps);
    scenes.push({ index, start: cursor, frames });

    const sceneWords = scene.lineIds.flatMap((id) => lines.get(id)!.text.split(/\s+/).filter(Boolean).map((text) => ({ text, lineId: id })));
    const weight = (w: string) => w.length + 2 + (BREAK.test(w) ? 4 : 0);
    const totalWeight = sceneWords.reduce((s, w) => s + weight(w.text), 0);
    const span = Math.max(1, frames - LEAD_IN - TAIL);
    let t = cursor + LEAD_IN;
    const timed = sceneWords.map((w) => {
      const d = (weight(w.text) / totalWeight) * span;
      const tw: TimedWord = { text: w.text, lineId: w.lineId, start: Math.round(t), end: Math.round(t + d), sceneIndex: index };
      t += d;
      return tw;
    });
    words.push(...timed);

    if (scene.caption === "word_pop") {
      let current: TimedWord[] = [];
      const flush = () => {
        if (current.length) chunks.push({ words: current, start: current[0]!.start, end: current[current.length - 1]!.end, style: "word_pop" });
        current = [];
      };
      timed.forEach((w, i) => {
        const prev = current[current.length - 1];
        const chars = current.reduce((s, x) => s + x.text.length + 1, 0) + w.text.length;
        if (prev && (prev.lineId !== w.lineId || current.length >= MAX_WORDS || chars > MAX_CHARS)) flush();
        current.push(w);
        if (BREAK.test(w.text) || i === timed.length - 1) flush();
      });
    }

    cursor += frames;
  });

  // Each chunk stays up until the next one starts (or a short hold at the end of its scene).
  chunks.forEach((c, i) => {
    const next = chunks[i + 1];
    const sceneEnd = scenes[c.words[0]!.sceneIndex]!;
    const hardEnd = sceneEnd.start + sceneEnd.frames;
    c.end = Math.min(next ? next.start : hardEnd, c.end + 10, hardEnd);
  });

  return { fps, total: cursor, scenes, words, chunks };
}
