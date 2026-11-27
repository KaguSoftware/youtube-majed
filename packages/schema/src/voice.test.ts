import { describe, expect, it } from "vitest";
import { validateProject } from "./validate";
import { VoiceFile } from "./voice";

const word = (text: string, start: number, end: number) => ({ text, start, end, score: 0.9 });
const quality = { status: "ok", wer: 0, heard: "HELLO THERE", issues: [], attempts: 1 };
const voiceLine = (over: Record<string, unknown> = {}) => ({
  id: "L1.1", text: "Hello there.", energy: 2, file: "lines/L1.1.abc.wav", offset: 0.4, duration: 1.5, seed: 1, seedUsed: 1,
  settings: { exaggeration: 0.3, cfgWeight: 0.5 }, quality, words: [word("Hello", 0.5, 0.9), word("there.", 1.0, 1.6)], ...over,
});
const voice = (over: Record<string, unknown> = {}) => ({
  version: 1,
  engine: { name: "original", revision: "r", device: "mps" },
  reference: { file: "assets/voices/x.wav", sha256: "00" },
  aligner: { model: "m", revision: "r", device: "cpu", dtype: "float32" },
  pauses: { leadIn: 0.4, tail: 1, loopBoundary: 0.7, byEnding: { ".": 0.28 }, continues: 0.05, beforeReveal: 0.15 },
  track: { file: "narration.wav", sampleRate: 48000, duration: 3, loudness: { integratedLufs: -14, truePeakDbtp: -1.5, targetLufs: -14 } },
  lines: [voiceLine()],
  ...over,
});

describe("VoiceFile", () => {
  it("accepts a valid file", () => expect(VoiceFile.safeParse(voice()).success).toBe(true));

  it("rejects a word outside its line, words out of order and overlapping lines", () => {
    const bad = (lines: unknown[]) => VoiceFile.safeParse(voice({ lines }));
    expect(bad([voiceLine({ words: [word("Hello", 0.5, 0.9), word("there.", 2.5, 2.9)] })]).success).toBe(false);
    expect(bad([voiceLine({ words: [word("Hello", 1.0, 1.2), word("there.", 0.6, 0.9)] })]).success).toBe(false);
    expect(bad([voiceLine(), voiceLine({ id: "L1.2", offset: 1.0, words: [word("Hi", 1.1, 1.3)] })]).success).toBe(false);
  });

  it("rejects unknown fields", () => expect(VoiceFile.safeParse(voice({ extra: 1 })).success).toBe(false));
});

describe("validateProject with a voice", () => {
  const scenes = { version: 1, title: "t", cast: { tom: { name: "Tom", hat: "none", color: "#336699" } }, scenes: [{ id: "S1", lineIds: ["L1.1"], bg: "street", grade: "day", chars: [{ id: "tom", action: "walk", expr: "neutral", pos: "left" }], props: [], camera: "static", transitionIn: "cut", sfx: [], caption: "word_pop" }] };
  const script = (text = "Hello there.") => ({ version: 1, lines: [{ id: "L1.1", text, energy: 2, delivery: "calm" }] });

  it("needs voice.json or timing.json", () => {
    const r = validateProject({ scenes, script: script() });
    expect(r.ok).toBe(false);
  });

  it("needs no timing.json when voiced", () => expect(validateProject({ scenes, script: script(), voice: voice() }).ok).toBe(true));

  it("says which line is stale when the script text changed after voicing", () => {
    const r = validateProject({ scenes, script: script("Hello, you."), voice: voice() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('line "L1.1" was voiced as "Hello there." but script.json now says "Hello, you."');
  });

  it("names a scene line that was never voiced", () => {
    const r = validateProject({ scenes, script: script(), voice: voice({ lines: [voiceLine({ id: "L9.9" })] }) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('line "L1.1" (Scene S1) has not been voiced');
  });
});
