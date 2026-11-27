/**
 * What an export writes next to the video (docs/PLAN.md section 9): an .srt,
 * a chapter list from the loop map, and three thumbnail frame suggestions
 * from head-fake moments. All of it is derived from voice.json's word times
 * and the story's loops, so it lines up with the video by construction.
 */
import type { ChapterMark, StoryboardFile, ThumbnailPick, VoiceFile } from "@studio/schema";
import type { Story } from "./storyboard";

// ---------------------------------------------------------------- srt

const WEAK = new Set(["a", "an", "the", "of", "to", "in", "on", "at", "by", "for", "and", "but", "or", "nor", "so", "with", "from", "into", "that", "this", "his", "her", "their", "its", "my", "your", "our", "as", "than", "if", "was", "is", "were", "be"]);
const SENTENCE_END = /[.!?…]["')\]]*$/;
const SOFT_END = /[,;:—–-]["')\]]*$/;
const MAX_CHARS = 38; // the old system's rule (legacy/INVENTORY.md: captions.py), kept so subtitles match what the channel already looked like
const PAUSE_BREAK_S = 0.55;
const MIN_CUE_S = 0.8;

export type Cue = { start: number; end: number; text: string };

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** Subtitle cues: at most 38 characters, a break at every sentence end and long pause, never ending on a weak word, at least 0.8 s on screen. */
export function buildCues(voice: VoiceFile): Cue[] {
  type W = { text: string; start: number; end: number; lineId: string };
  const words: W[] = voice.lines.flatMap((l) => l.words.map((w) => ({ text: w.text, start: w.start, end: w.end, lineId: l.id })));
  const groups: W[][] = [];
  let cur: W[] = [];
  const chars = (ws: W[]) => ws.reduce((n, w) => n + w.text.length + 1, -1);
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = cur[cur.length - 1];
    if (prev && (prev.lineId !== w.lineId || w.start - prev.end > PAUSE_BREAK_S || chars(cur) + 1 + w.text.length > MAX_CHARS)) {
      // never end a cue on a weak word: carry the trailing weak words to the next cue (unless that would empty it, or the break is a sentence or clause end)
      const carry: W[] = [];
      if (prev.lineId === w.lineId) {
        while (cur.length > 1) {
          const last = cur[cur.length - 1]!;
          if (!WEAK.has(bare(last.text)) || SENTENCE_END.test(last.text) || SOFT_END.test(last.text)) break;
          carry.unshift(cur.pop()!);
        }
      }
      flush();
      cur = carry;
    }
    cur.push(w);
    if (SENTENCE_END.test(w.text) || i === words.length - 1) flush();
  });
  flush();

  return groups.map((g, i) => {
    const start = g[0]!.start;
    const spoken = g[g.length - 1]!.end;
    const nextStart = groups[i + 1]?.[0]?.start ?? Infinity;
    // stay up a moment after the last word, at least MIN_CUE_S, never into the next cue
    const end = Math.min(Math.max(spoken + 0.15, start + MIN_CUE_S), nextStart - 0.02);
    return { start, end: Math.max(end, Math.min(spoken, nextStart - 0.02)), text: g.map((w) => w.text).join(" ") };
  });
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export function srtTime(s: number): string {
  const ms = Math.round(s * 1000);
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function buildSrt(cues: readonly Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

// ---------------------------------------------------------------- chapters

const MIN_CHAPTER_S = 10; // YouTube ignores a chapter list with chapters shorter than this

/** One chapter per loop at the time of its first spoken word; the first is 0:00. Chapters under 10 s are folded into the one before. */
export function buildChapters(story: Story): ChapterMark[] {
  const marks: ChapterMark[] = [];
  for (const loop of story.loops) {
    const first = loop.lines[0] && story.times.get(loop.lines[0].id);
    if (!first) continue;
    marks.push({ loopId: loop.id, title: loop.title === loop.id ? `Part ${marks.length + 1}` : loop.title, atS: marks.length ? first.start : 0 });
  }
  const kept: ChapterMark[] = [];
  marks.forEach((m, i) => {
    const next = marks[i + 1];
    const length = (next ? next.atS : story.seconds) - m.atS;
    if (kept.length && length < MIN_CHAPTER_S) return;
    kept.push(m);
  });
  return kept;
}

export function chapterTime(s: number): string {
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  return h ? `${h}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}` : `${Math.floor(t / 60)}:${pad(t % 60)}`;
}

export const chaptersText = (marks: readonly ChapterMark[]) => marks.map((m) => `${chapterTime(m.atS)} ${m.title}`).join("\n") + "\n";

// ---------------------------------------------------------------- thumbnails

export type Moment = { lineId: string; atS: number; loopId: string; why: string; weight: number };

/** Head-fake moments: the storyboard's reveal words (the exact word where the truth lands), or the story's head-fake lines when there is no storyboard report. */
export function headFakeMoments(story: Story, voice: VoiceFile, reveals: StoryboardFile["reveals"]): Moment[] {
  const lines = new Map(voice.lines.map((l) => [l.id, l]));
  const info = new Map(story.loops.flatMap((loop) => loop.lines.map((l) => [l.id, { loop, line: l }] as const)));
  const lastLoop = story.loops.at(-1)?.id;
  const picks: { lineId: string; at?: number }[] = reveals.length
    ? reveals.map((r) => ({ lineId: r.lineId, at: Number(r.at.split(":")[1]) }))
    : story.loops.flatMap((loop) => loop.lines.filter((l) => l.beats.some((b) => /head.?fake/i.test(b))).map((l) => ({ lineId: l.id })));
  return picks.flatMap(({ lineId, at }) => {
    const v = lines.get(lineId);
    const i = info.get(lineId);
    if (!v || !i) return [];
    const word = v.words[Math.min(at ?? 0, v.words.length - 1)]!;
    const weight = (i.loop.id === lastLoop ? 4 : 0) + (i.line.energy >= 5 ? 2 : 0) + (i.line.energy >= 4 ? 1 : 0);
    return [{ lineId, atS: word.start, loopId: i.loop.id, why: i.loop.headFake?.actual ? `${i.loop.id} head fake: ${i.loop.headFake.actual}` : `${lineId}: ${i.line.text}`, weight }];
  });
}

const THUMB_SPACING_S = 45;
const THUMB_AFTER_S = 0.35; // a beat after the word: the reveal shot's camera or transition has landed

/** Three suggestions: the ending twist first, then the strongest head fakes at least 45 s apart (the rest by strength, if there are too few). */
export function pickThumbnails(moments: readonly Moment[], count = 3): Moment[] {
  const sorted = [...moments].sort((a, b) => b.weight - a.weight || a.atS - b.atS);
  const chosen: Moment[] = [];
  for (const m of sorted) if (chosen.length < count && chosen.every((c) => Math.abs(c.atS - m.atS) >= THUMB_SPACING_S)) chosen.push(m);
  for (const m of sorted) if (chosen.length < count && !chosen.includes(m)) chosen.push(m);
  return chosen.sort((a, b) => a.atS - b.atS);
}

export const thumbnailFrame = (m: Pick<Moment, "atS">, fps: number) => Math.round((m.atS + THUMB_AFTER_S) * fps);
export const thumbnailPick = (m: Moment, file: string, fps: number): ThumbnailPick => ({ file, atS: Math.round(((thumbnailFrame(m, fps)) / fps) * 100) / 100, lineId: m.lineId, why: m.why });
