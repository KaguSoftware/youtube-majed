import type { SceneFile, StoryboardFile, VoiceFile } from "@studio/schema";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Asset } from "./assets";
import { DUCK, placeTags, planMix, sceneStarts } from "./mix";

const dir = mkdtempSync(join(tmpdir(), "studio-mix-"));
const narration = join(dir, "narration.wav");
writeFileSync(narration, "not really audio");

let k = 0;
function asset(kind: Asset["kind"], tags: string[], o: Partial<Asset> = {}): Asset {
  const id = `${kind}/${tags[0]}-${k++}`;
  return { id, file: `${id}.flac`, path: `/assets/${id}.flac`, kind, tags, moods: [], description: id, duration: 3, sample_rate: 48000, channels: 2, lufs: -20, loudest: -12, peak_db: -1, onset: 0.05, peak_at: 0.4, loop_start: kind === "music" || kind === "ambience" ? 0 : null, loop_end: kind === "music" || kind === "ambience" ? 30 : null, licence: "Own work", licence_url: null, author: null, source_url: null, sha256: "a".repeat(64), ...o };
}

const ASSETS: Asset[] = [
  asset("sfx", ["footsteps_wood", "footsteps"], { onset: 0.12 }),
  asset("sfx", ["clock_tick"]),
  asset("riser", ["riser", "riser_short"], { duration: 2 }),
  asset("riser", ["riser", "riser_long"], { duration: 4 }),
  asset("hit", ["hit", "impact"], { onset: 0.01 }),
  asset("hit", ["hit", "boom"], { moods: ["dread"], onset: 0.02 }),
  asset("whoosh", ["whoosh"], { duration: 0.8, peak_at: 0.48 }),
  asset("ambience", ["sea", "coast"], { duration: 60, loop_end: 60 }),
  asset("ambience", ["room_tone", "interior"]),
  asset("music", ["placeholder", "bed_mystery"], { moods: ["mystery"], duration: 48, loop_end: 48 }),
];

/** Three lines of four words, one second per word, half a second between lines. */
function voice(ids: string[]): VoiceFile {
  let t = 0.4;
  const lines = ids.map((id) => {
    const words = ["one", "two", "three", "four"].map((text) => {
      const w = { text, start: t, end: t + 0.8, score: 1 };
      t += 1;
      return w;
    });
    t += 0.5;
    return { id, text: "one two three four", energy: 3, file: `${id}.wav`, offset: words[0]!.start, duration: 4, seed: 1, seedUsed: 1, settings: {}, quality: { status: "ok", wer: 0, heard: "", issues: [], attempts: 1 }, words };
  });
  return { version: 1, track: { file: "narration.wav", sampleRate: 48000, duration: t + 1, loudness: { integratedLufs: -14, truePeakDbtp: -1.5, targetLufs: -14 } }, lines } as unknown as VoiceFile;
}

const scene = (id: string, lineIds: string[], bg: string, transitionIn: string, sfx: { tag: string; at: string }[] = []) =>
  ({ id, lineIds, bg, grade: "night", chars: [], props: [], camera: "static", transitionIn, sfx, caption: "word_pop" }) as unknown as SceneFile["scenes"][number];

const scenes = {
  version: 1,
  title: "t",
  cast: {},
  scenes: [scene("S1", ["L1.1"], "lighthouse_exterior", "cut"), scene("S2", ["L1.2"], "lighthouse_stairs", "whoosh_wipe", [{ tag: "footsteps_wod", at: "L1.2:1" }]), scene("S3", ["L2.1"], "lighthouse_stairs", "smash_cut")],
} as unknown as SceneFile;

const report = { music: [{ loopId: "L1", mood: "dread" }, { loopId: "L2", mood: "mystery" }], reveals: [{ lineId: "L2.1", at: "L2.1:2", kind: "hit" }] } as unknown as StoryboardFile;

const v = voice(["L1.1", "L1.2", "L2.1"]);
const plan = planMix({ project: "test", scenes, report, voice: v, narration, assets: ASSETS });
const word = (line: number, w: number) => v.lines[line]!.words[w]!.start;

describe("mix plan", () => {
  it("lands an sfx tag's first sound on its word, mapping a misspelt tag", () => {
    const c = plan.cues.find((x) => x.kind === "sfx")!;
    expect(c.asset).toMatch(/footsteps_wood/);
    expect(c.start).toBeCloseTo(word(1, 1), 3);
    expect(c.offset).toBeCloseTo(0.12, 3); // playback starts at the file's onset
    expect(plan.warnings).toContain('S2: sound tag "footsteps_wod" → "footsteps_wood"');
  });

  it("ends a riser exactly on the reveal word, hits on it, and drops the beds out just before", () => {
    const at = word(2, 2);
    const riser = plan.cues.find((x) => x.kind === "riser")!;
    expect(riser.start + riser.length).toBeCloseTo(at, 3);
    const hit = plan.cues.find((x) => x.kind === "hit" && /reveal/.test(x.reason))!;
    expect(hit.start).toBeCloseTo(at, 3);
    expect(plan.gates[0]!.start).toBeLessThan(at);
    expect(plan.gates[0]!.end).toBeGreaterThan(v.lines[2]!.words.at(-1)!.end);
  });

  it("puts a whoosh's peak on a wipe and gives no extra impact to a smash cut that is a reveal", () => {
    const starts = sceneStarts(scenes, { word: () => 0, lineStart: (id) => v.lines.find((l) => l.id === id)!.words[0]!.start, lineEnd: (id) => v.lines.find((l) => l.id === id)!.words.at(-1)!.end });
    const w = plan.cues.find((x) => x.kind === "whoosh")!;
    expect(w.start + 0.48).toBeCloseTo(starts[1]!, 3);
    expect(plan.cues.filter((x) => x.kind === "hit").length).toBe(1);
  });

  it("gives each run of places one ambience loop", () => {
    const amb = plan.cues.filter((x) => x.kind === "ambience");
    expect(amb.map((a) => a.asset)).toEqual([expect.stringMatching(/sea/), expect.stringMatching(/room_tone/)]);
    expect(amb.every((a) => a.loop !== null)).toBe(true);
  });

  it("plays a bed per mood, falls back to a near mood, and says when it is a placeholder", () => {
    const music = plan.cues.filter((x) => x.kind === "music");
    expect(music.length).toBe(2);
    expect(plan.warnings.some((w) => /no music for mood "dread".*used a "mystery" bed/.test(w))).toBe(true);
    expect(plan.warnings.some((w) => /placeholder music/.test(w))).toBe(true);
    expect(plan.duck).toEqual(DUCK);
    expect(DUCK.music.depthDb).toBeGreaterThanOrEqual(10);
    expect(DUCK.music.depthDb).toBeLessThanOrEqual(12);
  });

  it("is deterministic, so the cache key is stable", () => {
    expect(planMix({ project: "test", scenes, report, voice: v, narration, assets: ASSETS })).toEqual(plan);
  });

  it("finds an ambience for a background from its id or description", () => {
    expect(placeTags("lighthouse_exterior")).toContain("sea");
    expect(placeTags("forest")).toContain("forest");
    expect(placeTags("house_interior")).toEqual(["room_tone"]);
  });
});
