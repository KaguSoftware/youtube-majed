import type { Project } from "@studio/schema";
import { FPS } from "../theme";

/**
 * Turns a validated project into frame numbers: where each scene starts and
 * ends, and the word timings captions use.
 *
 * Two sources, in this order:
 *
 * 1. voice.json (Phase 1): real word timestamps from forced alignment.
 *    - A scene starts SCENE_LEAD_IN frames before the first word of its first
 *      line, and lasts until the next scene starts. The first scene starts at
 *      frame 0; the last one lasts until the end of the narration track.
 *    - Pauses between lines are not decided here: audio/ inserts them into the
 *      narration track (see audio/README.md, "Pause rules") and the word times
 *      already include them.
 *    - Caption words start and end on the frames nearest the spoken word, so
 *      a caption can be off by at most half a frame (16.7 ms at 30 fps).
 *    - Transitions never shift any of this: StoryVideo overlaps a transition
 *      with the previous scene instead of moving scene starts.
 * 2. timing.json (Phase 0 fallback for unvoiced samples): fixed seconds per
 *    scene, with word times ESTIMATED from word lengths.
 */

export type TimedScene = { index: number; start: number; frames: number };
export type TimedWord = { text: string; start: number; end: number; lineId: string; sceneIndex: number };
export type Chunk = { words: TimedWord[]; start: number; end: number; style: "word_pop" };

export type Timeline = { fps: number; total: number; scenes: TimedScene[]; words: TimedWord[]; chunks: Chunk[]; source: "voice" | "timing" };

const SCENE_LEAD_IN = 6; // voiced: frames a scene starts before its first word
const MIN_SCENE = 15; // voiced: a scene is never shorter than half a second
const LEAD_IN = 4; // estimated: frames of silence at the start of a scene
const TAIL = 6; // frames of silence at the end
const MAX_WORDS = 3;
const MAX_CHARS = 20;
const BREAK = /[,.!?;:…—]$/;

/** Groups a scene's timed words into 1–3 word caption chunks. */
function chunkWords(timed: TimedWord[]): Chunk[] {
  const chunks: Chunk[] = [];
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
  return chunks;
}

/** Each chunk stays up until the next one starts (or a short hold), never past its scene. */
function holdChunks(chunks: Chunk[], scenes: TimedScene[]): void {
  chunks.forEach((c, i) => {
    const next = chunks[i + 1];
    const scene = scenes[c.words[0]!.sceneIndex]!;
    const hardEnd = scene.start + scene.frames;
    c.end = Math.min(next ? next.start : hardEnd, c.end + 10, hardEnd);
  });
}

export function buildTimeline(p: Project): Timeline {
  if (p.voice) return fromVoice(p);
  if (p.timing) return fromTiming(p);
  throw new Error("project has neither voice.json nor timing.json");
}

function fromVoice(p: Project): Timeline {
  const voice = p.voice!;
  const fps = FPS;
  const lines = new Map(voice.lines.map((l) => [l.id, l]));
  const total = Math.ceil(voice.track.duration * fps);
  const sec = (t: number) => Math.round(t * fps);

  // Scene starts: just before the first word, never before the previous scene's last word has ended.
  const starts: number[] = [];
  p.scenes.scenes.forEach((scene, i) => {
    if (i === 0) return starts.push(0);
    const first = lines.get(scene.lineIds[0]!)!.words[0]!;
    const prevLast = lines.get(p.scenes.scenes[i - 1]!.lineIds.at(-1)!)!.words.at(-1)!;
    starts.push(Math.min(sec(first.start), Math.max(starts[i - 1]! + MIN_SCENE, sec(first.start) - SCENE_LEAD_IN, sec(prevLast.end))));
  });
  const scenes: TimedScene[] = starts.map((start, index) => ({ index, start, frames: (starts[index + 1] ?? total) - start }));

  const words: TimedWord[] = [];
  const chunks: Chunk[] = [];
  p.scenes.scenes.forEach((scene, index) => {
    const timed = scene.lineIds.flatMap((id) =>
      lines.get(id)!.words.map((w): TimedWord => ({ text: w.text, lineId: id, sceneIndex: index, start: sec(w.start), end: Math.max(sec(w.start) + 1, sec(w.end)) })),
    );
    words.push(...timed);
    if (scene.caption === "word_pop") chunks.push(...chunkWords(timed));
  });
  holdChunks(chunks, scenes);
  return { fps, total, scenes, words, chunks, source: "voice" };
}

function fromTiming(p: Project): Timeline {
  const timing = p.timing!;
  const fps = timing.fps;
  const lines = new Map(p.script.lines.map((l) => [l.id, l]));
  const scenes: TimedScene[] = [];
  const words: TimedWord[] = [];
  const chunks: Chunk[] = [];
  let cursor = 0;

  p.scenes.scenes.forEach((scene, index) => {
    const frames = Math.round(timing.seconds[scene.id]! * fps);
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

    if (scene.caption === "word_pop") chunks.push(...chunkWords(timed));

    cursor += frames;
  });

  holdChunks(chunks, scenes);

  return { fps, total: cursor, scenes, words, chunks, source: "timing" };
}
