import type { CaptionId, OverlayInScene, Project } from "@studio/schema";
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
export type TimedWord = { text: string; start: number; end: number; lineId: string; index: number; sceneIndex: number };
export type CaptionStyle = Exclude<CaptionId, "none">;
export type Chunk = { words: TimedWord[]; start: number; end: number; style: CaptionStyle };
/** An overlay with its frames: from its `at` word (or the scene start) to the end of its scene. */
export type TimedOverlay = { overlay: OverlayInScene; start: number; end: number; sceneIndex: number };

export type Timeline = {
  fps: number;
  total: number;
  scenes: TimedScene[];
  words: TimedWord[];
  chunks: Chunk[];
  overlays: TimedOverlay[];
  source: "voice" | "timing";
};

const SCENE_LEAD_IN = 6; // voiced: frames a scene starts before its first word
const MIN_SCENE = 15; // voiced: a scene is never shorter than half a second
const LEAD_IN = 4; // estimated: frames of silence at the start of a scene
const TAIL = 6; // frames of silence at the end
const BREAK = /[,.!?;:…—]$/;

/** How many words (and characters) each caption style shows at once. */
const CHUNK: Record<CaptionStyle, { words: number; chars: number }> = {
  word_pop: { words: 3, chars: 20 },
  karaoke: { words: 7, chars: 38 },
  subtitle: { words: 9, chars: 46 },
  punch: { words: 1, chars: 99 },
};
/** The same in the 9:16 frame, whose safe text box is 840 px wide (scene/view.ts): the words a line holds are fewer, and wrap to two lines at most. */
const CHUNK_PORTRAIT: Record<CaptionStyle, { words: number; chars: number }> = {
  word_pop: { words: 3, chars: 16 },
  karaoke: { words: 5, chars: 24 },
  subtitle: { words: 7, chars: 32 },
  punch: { words: 1, chars: 99 },
};

/** Groups a scene's timed words into caption chunks for its style. */
function chunkWords(timed: TimedWord[], style: CaptionStyle, portrait: boolean): Chunk[] {
  const { words: maxWords, chars: maxChars } = (portrait ? CHUNK_PORTRAIT : CHUNK)[style];
  const chunks: Chunk[] = [];
  let current: TimedWord[] = [];
  const flush = () => {
    if (current.length) chunks.push({ words: current, start: current[0]!.start, end: current[current.length - 1]!.end, style });
    current = [];
  };
  timed.forEach((w, i) => {
    const prev = current[current.length - 1];
    const chars = current.reduce((s, x) => s + x.text.length + 1, 0) + w.text.length;
    if (prev && (prev.lineId !== w.lineId || current.length >= maxWords || chars > maxChars)) flush();
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

export type TimelineOptions = { /** 9:16: captions are cut into shorter chunks for the narrower safe box */ portrait?: boolean };

export function buildTimeline(p: Project, o: TimelineOptions = {}): Timeline {
  const portrait = Boolean(o.portrait);
  const t = p.voice ? fromVoice(p, portrait) : p.timing ? fromTiming(p, portrait) : undefined;
  if (!t) throw new Error("project has neither voice.json nor timing.json");
  return { ...t, overlays: timeOverlays(p, t) };
}

/** Overlays start on their `at` word (or with the scene) and last until the scene ends. */
function timeOverlays(p: Project, t: Omit<Timeline, "overlays">): TimedOverlay[] {
  return p.scenes.scenes.flatMap((scene, sceneIndex) => {
    const timed = t.scenes[sceneIndex]!;
    const end = timed.start + timed.frames;
    return scene.overlays.map((overlay) => {
      let start = timed.start;
      if (overlay.at) {
        const [lineId, idx] = overlay.at.split(":");
        const words = t.words.filter((w) => w.lineId === lineId && w.sceneIndex === sceneIndex);
        const word = words[Math.min(Number(idx), words.length - 1)];
        if (word) start = word.start;
      }
      return { overlay, start: Math.min(start, end - 1), end, sceneIndex };
    });
  });
}

function fromVoice(p: Project, portrait: boolean): Omit<Timeline, "overlays"> {
  const voice = p.voice!;
  const fps = FPS;
  const lines = new Map(voice.lines.map((l) => [l.id, l]));
  const total = Math.ceil(voice.track.duration * fps);
  const sec = (t: number) => Math.round(t * fps);
  // Frame-aligned tracks (voice.json pauses.frameRate, Phase 4): a word's frame is its line's frame plus its own
  // offset in the line, rounded on its own. An edit that moves a line by whole frames then moves every word by the
  // same frames, and the render segments of unchanged scenes are reused (segments.ts). Older tracks keep plain rounding.
  const aligned = voice.pauses.frameRate === fps;
  const at = (lineId: string, t: number) => {
    if (!aligned) return sec(t);
    const offset = lines.get(lineId)!.offset;
    return sec(offset) + Math.round((t - offset) * fps);
  };

  // Scene starts: just before the first word, never before the previous scene's last word has ended.
  const starts: number[] = [];
  p.scenes.scenes.forEach((scene, i) => {
    if (i === 0) return starts.push(0);
    const firstId = scene.lineIds[0]!;
    const prevId = p.scenes.scenes[i - 1]!.lineIds.at(-1)!;
    const first = at(firstId, lines.get(firstId)!.words[0]!.start);
    const prevEnd = at(prevId, lines.get(prevId)!.words.at(-1)!.end);
    starts.push(Math.min(first, Math.max(starts[i - 1]! + MIN_SCENE, first - SCENE_LEAD_IN, prevEnd)));
  });
  const scenes: TimedScene[] = starts.map((start, index) => ({ index, start, frames: (starts[index + 1] ?? total) - start }));

  const words: TimedWord[] = [];
  const chunks: Chunk[] = [];
  p.scenes.scenes.forEach((scene, index) => {
    const timed = scene.lineIds.flatMap((id) =>
      lines.get(id)!.words.map((w, wi): TimedWord => ({ text: w.text, lineId: id, index: wi, sceneIndex: index, start: at(id, w.start), end: Math.max(at(id, w.start) + 1, at(id, w.end)) })),
    );
    words.push(...timed);
    if (scene.caption !== "none") chunks.push(...chunkWords(timed, scene.caption, portrait));
  });
  holdChunks(chunks, scenes);
  return { fps, total, scenes, words, chunks, source: "voice" };
}

function fromTiming(p: Project, portrait: boolean): Omit<Timeline, "overlays"> {
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

    const sceneWords = scene.lineIds.flatMap((id) => lines.get(id)!.text.split(/\s+/).filter(Boolean).map((text, wi) => ({ text, lineId: id, index: wi })));
    const weight = (w: string) => w.length + 2 + (BREAK.test(w) ? 4 : 0);
    const totalWeight = sceneWords.reduce((s, w) => s + weight(w.text), 0);
    const span = Math.max(1, frames - LEAD_IN - TAIL);
    let t = cursor + LEAD_IN;
    const timed = sceneWords.map((w) => {
      const d = (weight(w.text) / totalWeight) * span;
      const tw: TimedWord = { text: w.text, lineId: w.lineId, index: w.index, start: Math.round(t), end: Math.round(t + d), sceneIndex: index };
      t += d;
      return tw;
    });
    words.push(...timed);

    if (scene.caption !== "none") chunks.push(...chunkWords(timed, scene.caption, portrait));

    cursor += frames;
  });

  holdChunks(chunks, scenes);

  return { fps, total: cursor, scenes, words, chunks, source: "timing" };
}
