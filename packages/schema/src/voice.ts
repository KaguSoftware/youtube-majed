import { z } from "zod";
import { LineId } from "./scene";

/**
 * voice.json: what the audio service (audio/) writes into
 * projects/<id>/audio/ after voicing a script. It is the source of truth for
 * timing from Phase 1 on: scene starts, caption word times and the audio
 * track all come from here.
 *
 * All times are seconds on the narration track (`track.file`), so a word's
 * `start` is already offset by its line's `offset`. Audio file paths are
 * relative to the folder voice.json sits in.
 */

const Seconds = z.number().finite().min(0);

export const VoiceWord = z
  .strictObject({
    text: z.string().min(1), // as written in the script, punctuation attached
    start: Seconds,
    end: Seconds,
    score: z.number().min(0).max(1), // forced-alignment confidence
  })
  .refine((w) => w.end >= w.start, { message: "word ends before it starts" });

export const VoiceQuality = z.strictObject({
  status: z.enum(["ok", "warn", "fail"]),
  wer: z.number().min(0), // share of script words the voice did not say clearly
  heard: z.string(), // what the alignment model heard, for diagnosing a bad take
  issues: z.array(z.string()),
  attempts: z.int().min(1), // takes the service tried before keeping this one
});

export const VoiceSettings = z.strictObject({
  exaggeration: z.number().optional(), // original Chatterbox only
  cfgWeight: z.number().optional(), // original Chatterbox only
  temperature: z.number().optional(), // Turbo only
});

export const VoiceLine = z.strictObject({
  id: LineId,
  text: z.string().min(1),
  energy: z.int().min(1).max(5), // the energy the take was made at (a retake can override the script's)
  file: z.string().min(1), // the raw take, relative to voice.json
  offset: Seconds, // where the line's audio starts on the track
  duration: z.number().positive(),
  seed: z.int(), // the seed that was asked for (and the cache key)
  seedUsed: z.int(), // differs from `seed` when an automatic retake was kept
  settings: VoiceSettings,
  quality: VoiceQuality,
  words: z.array(VoiceWord).min(1),
});

export const VoiceFile = z
  .strictObject({
    version: z.literal(1),
    engine: z.strictObject({ name: z.enum(["original", "turbo"]), revision: z.string(), device: z.enum(["mps", "cpu"]) }),
    reference: z.strictObject({ file: z.string(), sha256: z.string() }),
    aligner: z.strictObject({ model: z.string(), revision: z.string(), device: z.string(), dtype: z.string() }),
    pauses: z.strictObject({
      leadIn: Seconds,
      tail: Seconds,
      loopBoundary: Seconds,
      byEnding: z.record(z.string(), Seconds),
      continues: Seconds,
      beforeReveal: Seconds,
    }),
    track: z.strictObject({
      file: z.string(),
      sampleRate: z.int().positive(),
      duration: z.number().positive(),
      loudness: z.strictObject({ integratedLufs: z.number(), truePeakDbtp: z.number(), targetLufs: z.number() }),
    }),
    lines: z.array(VoiceLine).min(1),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    let cursor = 0;
    v.lines.forEach((line, i) => {
      const at = (msg: string) => ctx.addIssue({ code: "custom", path: ["lines", i], message: msg });
      if (seen.has(line.id)) at(`line ${line.id} appears twice`);
      seen.add(line.id);
      if (line.offset < cursor - 1e-6) at(`line ${line.id} starts at ${line.offset}s, before the previous line ends (${cursor}s)`);
      cursor = line.offset + line.duration;
      if (cursor > v.track.duration + 1e-3) at(`line ${line.id} runs past the end of the track (${v.track.duration}s)`);
      let prev = line.offset - 1e-3;
      line.words.forEach((w, j) => {
        if (w.start < prev - 1e-6) ctx.addIssue({ code: "custom", path: ["lines", i, "words", j], message: `word "${w.text}" starts before the previous word` });
        if (w.start < line.offset - 1e-3 || w.end > line.offset + line.duration + 1e-3)
          ctx.addIssue({ code: "custom", path: ["lines", i, "words", j], message: `word "${w.text}" (${w.start}–${w.end}s) lies outside its line (${line.offset}–${line.offset + line.duration}s)` });
        prev = w.start;
      });
    });
  });

export type VoiceWord = z.infer<typeof VoiceWord>;
export type VoiceLine = z.infer<typeof VoiceLine>;
export type VoiceFile = z.infer<typeof VoiceFile>;
