import type { VoiceFile } from "@studio/schema";
import { describe, expect, it } from "vitest";
import { buildChapters, buildCues, buildSrt, chapterTime, chaptersText, headFakeMoments, pickThumbnails, srtTime, thumbnailFrame, type Moment } from "./sidecars";
import type { Story } from "./storyboard";

/** A voice file with only what the sidecars read: lines, their words and their times. */
function voice(lines: { id: string; words: [string, number, number][] }[]): VoiceFile {
  return {
    track: { duration: 100 },
    lines: lines.map((l) => ({ id: l.id, words: l.words.map(([text, start, end]) => ({ text, start, end, score: 1 })) })),
  } as unknown as VoiceFile;
}

const seq = (text: string, t0: number, step = 0.3): [string, number, number][] => text.split(" ").map((w, i) => [w, t0 + i * step, t0 + i * step + step * 0.8]);

describe("srt", () => {
  it("formats times", () => {
    expect(srtTime(0)).toBe("00:00:00,000");
    expect(srtTime(61.5)).toBe("00:01:01,500");
    expect(srtTime(3723.0049)).toBe("01:02:03,005");
  });

  it("breaks on sentence ends and keeps cues under 38 characters", () => {
    const v = voice([{ id: "L1.1", words: seq("He walked down the long dark corridor toward the old lift. Nothing moved.", 1) }]);
    const cues = buildCues(v);
    expect(cues.length).toBeGreaterThan(2);
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(38);
    expect(cues.map((c) => c.text).join(" ")).toBe("He walked down the long dark corridor toward the old lift. Nothing moved.");
    expect(cues.at(-2)!.text.endsWith("lift.")).toBe(true);
  });

  it("never ends a cue on a weak word", () => {
    const v = voice([{ id: "L1.1", words: seq("She waited outside the door of the", 0, 0.3).concat(seq("building until dawn", 2.5, 0.3)) }]);
    for (const c of buildCues(v)) expect(c.text.split(" ").at(-1)).not.toMatch(/^(the|of|a|an)$/i);
  });

  it("breaks on a long pause and starts a new cue on a new line", () => {
    const v = voice([
      { id: "L1.1", words: [["Wait", 0, 0.3], ["here", 0.35, 0.6], ["now", 1.8, 2.1]] },
      { id: "L1.2", words: [["Go", 2.3, 2.6]] },
    ]);
    expect(buildCues(v).map((c) => c.text)).toEqual(["Wait here", "now", "Go"]);
  });

  it("holds a short cue for at least 0.8 s but never into the next cue", () => {
    const v = voice([
      { id: "L1.1", words: [["No.", 0, 0.2]] },
      { id: "L1.2", words: [["Why?", 0.5, 0.7]] },
    ]);
    const [a, b] = buildCues(v);
    expect(a!.end).toBeLessThan(b!.start);
    expect(b!.end - b!.start).toBeGreaterThanOrEqual(0.79);
    expect(buildSrt([a!]).startsWith("1\n00:00:00,000 --> ")).toBe(true);
  });
});

const story = (loops: [string, string, string[]][], times: Record<string, [number, number]>, seconds = 100): Story =>
  ({
    loops: loops.map(([id, title, ids]) => ({ id, title, question: "", lines: ids.map((l) => ({ id: l, text: l, energy: 3, delivery: "", beats: [], plants: [], payoffs: [] })) })),
    times: new Map(Object.entries(times).map(([k, [start, end]]) => [k, { start, end, words: 3 }])),
    seconds,
  }) as unknown as Story;

describe("chapters", () => {
  it("starts at 0:00, uses loop titles, folds chapters under 10 s into the previous one", () => {
    const s = story(
      [["L1", "The call", ["L1.1"]], ["L2", "Floor thirteen", ["L2.1"]], ["L3", "Blink", ["L3.1"]], ["L4", "The key", ["L4.1"]]],
      { "L1.1": [0.4, 3], "L2.1": [40, 43], "L3.1": [95, 97], "L4.1": [96, 99] },
      120,
    );
    const marks = buildChapters(s);
    expect(marks.map((m) => [m.loopId, m.atS])).toEqual([["L1", 0], ["L2", 40], ["L4", 96]]);
    expect(chaptersText(marks)).toBe("0:00 The call\n0:40 Floor thirteen\n1:36 The key\n");
  });

  it("formats hours", () => expect(chapterTime(3725)).toBe("1:02:05"));

  it("falls back to Part N when a loop has no title", () => {
    const s = story([["L1", "L1", ["L1.1"]], ["L2", "L2", ["L2.1"]]], { "L1.1": [0.4, 2], "L2.1": [30, 32] });
    expect(buildChapters(s).map((m) => m.title)).toEqual(["Part 1", "Part 2"]);
  });
});

describe("thumbnails", () => {
  const m = (lineId: string, atS: number, weight: number): Moment => ({ lineId, atS, loopId: "L1", why: "", weight });

  it("takes the ending twist first, then strong head fakes at least 45 s apart", () => {
    const picks = pickThumbnails([m("a", 30, 1), m("b", 40, 3), m("c", 100, 2), m("d", 200, 4), m("e", 210, 2)]);
    expect(picks.map((p) => p.lineId)).toEqual(["b", "c", "d"]);
  });

  it("fills up with the rest when head fakes are close together", () => {
    expect(pickThumbnails([m("a", 10, 3), m("b", 20, 2), m("c", 30, 1), m("d", 40, 0)]).map((p) => p.lineId)).toEqual(["a", "b", "c"]);
  });

  it("finds moments from the reveal words, and weighs the last loop most", () => {
    const s = story([["L1", "One", ["L1.1"]], ["L2", "Two", ["L2.1"]]], { "L1.1": [0, 1], "L2.1": [50, 51] });
    const v = voice([
      { id: "L1.1", words: seq("It was him", 0) },
      { id: "L2.1", words: seq("It was never him", 50) },
    ]);
    const moments = headFakeMoments(s, v, [{ lineId: "L1.1", at: "L1.1:2", kind: "hit" }, { lineId: "L2.1", at: "L2.1:3", kind: "silence" }]);
    expect(moments.map((x) => x.lineId)).toEqual(["L1.1", "L2.1"]);
    expect(moments[1]!.atS).toBeCloseTo(50.9);
    expect(moments[1]!.weight).toBeGreaterThan(moments[0]!.weight);
    expect(thumbnailFrame(moments[1]!, 30)).toBe(Math.round((50.9 + 0.35) * 30));
  });
});
