import { z } from "zod";

/**
 * Sound design (docs/PLAN.md section 7). Claude writes only tags: scene `sfx`
 * tags, a music mood per loop and a reveal word per head fake. Code picks the
 * files from the asset index (assets/index.sqlite), places them on the word
 * timestamps and mixes (audio/studio_audio/mix.py).
 */

/** Music moods a loop can ask for. Music files in the index are tagged with these. */
export const MUSIC_MOODS = {
  tense: "a clock running down, pressure building",
  mystery: "investigation, curiosity, something hidden",
  dread: "horror, something wrong, the worst is near",
  action: "a chase, a fight, fast movement",
  calm: "setup, an ordinary day, breathing room",
  warm: "family, kindness, a happy memory",
  sad: "loss, aftermath, regret",
  hopeful: "a way out, a small win",
  triumphant: "victory, the truth comes out, the hero wins",
  playful: "comedy, mischief, light trouble",
  none: "no music: voice, ambience and effects only",
} as const;
export type MusicMood = keyof typeof MUSIC_MOODS;
export const MusicMood = z.enum(Object.keys(MUSIC_MOODS) as [MusicMood, ...MusicMood[]]);

// ---------------------------------------------------------------- the mix plan (projects/<id>/audio/mixplan.json)

/**
 * Everything the mixer needs, decided by code (worker/src/mix.ts): every cue
 * with its file, its time on the narration track and its gain. The mixer
 * (audio/studio_audio/mix.py) only renders it, so a plan is the whole recipe:
 * the same plan always gives the same mix, and the cache keys on its hash.
 *
 * Buses: music and ambience duck under the voice and drop out in `gates`
 * (the silence before a reveal); sfx, risers, hits and whooshes are never
 * ducked. The sum is normalised to `targetLufs` (BS.1770 integrated) under a
 * true-peak ceiling.
 */
export const CueKind = z.enum(["sfx", "riser", "hit", "whoosh", "ambience", "music"]);
export type CueKind = z.infer<typeof CueKind>;

const Sec = z.number().finite();

export const MixCue = z.strictObject({
  id: z.string().min(1),
  kind: CueKind,
  asset: z.string().min(1),
  file: z.string().min(1),
  sha256: z.string().length(64),
  licence: z.string().min(1),
  /** where the cue's audio starts on the narration track (may be < 0: the start is cut) */
  start: Sec,
  /** seconds into the file where playback starts */
  offset: Sec.min(0),
  /** how long it plays; longer than the file loops it between loopStart and loopEnd */
  length: z.number().positive(),
  loop: z.strictObject({ start: Sec.min(0), end: z.number().positive() }).nullable(),
  gainDb: z.number().min(-60).max(24),
  fadeIn: z.number().min(0),
  fadeOut: z.number().min(0),
  /** why code placed it, e.g. "sfx tag footsteps_wood on L3.3:1" or "riser into the reveal on L4.1:6" */
  reason: z.string(),
});
export type MixCue = z.infer<typeof MixCue>;

export const MixGate = z.strictObject({
  start: Sec,
  end: Sec,
  /** seconds to drop out before `start` */
  fade: z.number().min(0),
  /** seconds to come back after `end` */
  release: z.number().min(0),
  reason: z.string(),
});
export type MixGate = z.infer<typeof MixGate>;

export const DuckRule = z.strictObject({ depthDb: z.number().min(0).max(40), attackMs: z.number().positive(), releaseMs: z.number().positive(), lookaheadMs: z.number().min(0) });

export const MixPlan = z.strictObject({
  version: z.literal(1),
  /** bumped when the mixer's DSP changes, so cached mixes are redone */
  mixer: z.int().positive(),
  project: z.string(),
  sampleRate: z.literal(48000),
  duration: z.number().positive(),
  voice: z.strictObject({ file: z.string(), sha256: z.string().length(64) }),
  targetLufs: z.number(),
  truePeakDbtp: z.number().max(0),
  duck: z.strictObject({ music: DuckRule, ambience: DuckRule }),
  cues: z.array(MixCue),
  gates: z.array(MixGate),
  /** tags or rules code could not honour (no file for a tag, no music for a mood) */
  warnings: z.array(z.string()),
});
export type MixPlan = z.infer<typeof MixPlan>;

/** What the mixer reports back (projects/<id>/audio/mix.json). */
export const MixResult = z.strictObject({
  version: z.literal(1),
  planHash: z.string(),
  file: z.string(),
  duration: z.number().positive(),
  integratedLufs: z.number(),
  truePeakDbtp: z.number(),
  voiceLufs: z.number(),
  musicUnderVoiceDb: z.number().nullable(),
  renderedMs: z.number().nonnegative(),
});
export type MixResult = z.infer<typeof MixResult>;
