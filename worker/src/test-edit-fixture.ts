/** A locked, storyboarded project with a voice.json but no audio, for edit tests (fake claude; no audio service). */
import { projectPaths, writeJson } from "@studio/project";
import { VoiceFile, type ScriptFile } from "@studio/schema";
import { readFileSync } from "node:fs";
import { lock } from "./review";
import { createProject, generateOptions, pickOption, writeStory } from "./story";
import { storyboard } from "./storyboard";
import type { useFakeClaude } from "./test-env";

/** A voice.json for a script without audio: every word 0.3 s, a 0.3 s pause between lines. */
export function fakeVoice(script: ScriptFile): VoiceFile {
  let t = 0.4;
  const lines = script.lines.map((l) => {
    const offset = t;
    const words = l.text.split(/\s+/).filter(Boolean).map((w, i) => ({ text: w, start: offset + 0.06 + i * 0.3, end: offset + 0.06 + i * 0.3 + 0.25, score: 0.9 }));
    const duration = 0.06 + words.length * 0.3 + 0.12;
    t += duration + 0.3;
    return { id: l.id, text: l.text, energy: l.energy, file: `lines/${l.id}.0123456789ab.wav`, offset, duration, seed: 1, seedUsed: 1, settings: {}, quality: { status: "ok" as const, wer: 0, heard: l.text, issues: [], attempts: 1 }, words };
  });
  return VoiceFile.parse({
    version: 1,
    engine: { name: "original", revision: "r", device: "cpu" },
    reference: { file: "builtin:x", sha256: "s" },
    aligner: { model: "m", revision: "r", device: "cpu", dtype: "float32" },
    pauses: { leadIn: 0.4, tail: 1, loopBoundary: 0.7, byEnding: {}, continues: 0.05, beforeReveal: 0.15 },
    track: { file: "narration.wav", sampleRate: 48000, duration: t + 1, loudness: { integratedLufs: -14, truePeakDbtp: -1.5, targetLufs: -14 } },
    lines,
  });
}

export async function editable(env: ReturnType<typeof useFakeClaude>): Promise<string> {
  const b = createProject({ sentence: "A lighthouse keeper finds his oil disappearing every night.", narrative: "mystery", format: "reel", minutes: 1.25 });
  await generateOptions(b.id);
  pickOption(b.id, "A");
  await writeStory(b.id);
  lock(b.id, { force: true });
  await storyboard(b.id);
  const script = JSON.parse(readFileSync(projectPaths(b.id).scriptJson, "utf8")) as ScriptFile;
  writeJson(projectPaths(b.id).voiceJson, fakeVoice(script));
  env.reset();
  return b.id;
}
