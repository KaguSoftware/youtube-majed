/** Tone presets (docs/PLAN.md section 4): each maps onto the voice's energy and a delivery note. */
export const TONES = [
  { id: "hype", label: "Hype", energy: 4, delivery: "hype, quick" },
  { id: "hushed", label: "Hushed", energy: 1, delivery: "hushed, slow" },
  { id: "dread", label: "Dread", energy: 2, delivery: "dread, low" },
  { id: "deadpan", label: "Deadpan", energy: 2, delivery: "deadpan, flat" },
  { id: "awe", label: "Awe", energy: 3, delivery: "awe, slow" },
  { id: "comic", label: "Comic", energy: 3, delivery: "comic timing" },
] as const;
export type Tone = (typeof TONES)[number];

export const ENERGY_WORDS = ["", "hushed", "calm", "telling", "tense", "reveal"] as const;
