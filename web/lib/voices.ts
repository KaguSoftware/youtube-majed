/** Who narrates a film, and how. The ids are pipeline/tts.py VOICES and PACES,
 *  in the same order; pipeline/selftest.py checks the lists agree and that
 *  every voice has its sample in public/voices. Pure data, safe to import
 *  from client components. */

export const VOICES = [
  { id: "narrator_male_low", name: "Michael", accent: "American", who: "man", hint: "The studio's voice so far." },
  { id: "narrator_male_us_fenrir", name: "Fenrir", accent: "American", who: "man" },
  { id: "narrator_male_us_puck", name: "Puck", accent: "American", who: "man" },
  { id: "narrator_male_british", name: "George", accent: "British", who: "man" },
  { id: "narrator_male_british_fable", name: "Fable", accent: "British", who: "man" },
  { id: "narrator_female_us_heart", name: "Heart", accent: "American", who: "woman", hint: "The most natural voice." },
  { id: "narrator_female_us_bella", name: "Bella", accent: "American", who: "woman", hint: "Among the most natural." },
  { id: "narrator_female_us_nicole", name: "Nicole", accent: "American", who: "woman", hint: "Soft and close, almost whispered. Slow." },
  { id: "narrator_female_us_aoede", name: "Aoede", accent: "American", who: "woman" },
  { id: "narrator_female_us_kore", name: "Kore", accent: "American", who: "woman" },
  { id: "narrator_female_us_sarah", name: "Sarah", accent: "American", who: "woman" },
  { id: "narrator_female_us_nova", name: "Nova", accent: "American", who: "woman" },
  { id: "narrator_female_us_alloy", name: "Alloy", accent: "American", who: "woman" },
  { id: "narrator_female_british_emma", name: "Emma", accent: "British", who: "woman", hint: "The most natural British voice." },
  { id: "narrator_female_british_isabella", name: "Isabella", accent: "British", who: "woman" },
] as const satisfies readonly { id: string; name: string; accent: string; who: "man" | "woman"; hint?: string }[];

/** `rate`: how much faster or slower than natural, as tts.PACES speeds it. */
export const PACES = [
  { id: "measured", label: "Measured", hint: "Slower, with longer pauses between beats. Lets a grave line land.", rate: 0.9 },
  { id: "natural", label: "Natural", hint: "An even storytelling pace.", rate: 1.0 },
  { id: "brisk", label: "Brisk", hint: "Quicker, with short pauses. Carries a lively film.", rate: 1.1 },
] as const;

export type VoiceId = (typeof VOICES)[number]["id"];
export type PaceId = (typeof PACES)[number]["id"];

export const DEFAULT_VOICE: VoiceId = "narrator_male_low";
export const DEFAULT_PACE: PaceId = "natural";

export const isVoice = (id: unknown): id is VoiceId => VOICES.some((v) => v.id === id);
export const isPace = (id: unknown): id is PaceId => PACES.some((p) => p.id === id);

export const voiceSample = (id: VoiceId) => `/voices/${id}.mp3`;
