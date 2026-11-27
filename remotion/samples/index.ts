import type { RawProject } from "@studio/schema";
import lighthouseScenes from "./lighthouse/scenes.json";
import lighthouseScript from "./lighthouse/script.json";
import lighthouseTiming from "./lighthouse/timing.json";

/** Hand-written sample projects (Phase 0). Raw JSON: validated before use. */
export const SAMPLES = {
  lighthouse: { scenes: lighthouseScenes, script: lighthouseScript, timing: lighthouseTiming },
} satisfies Record<string, RawProject>;

export type SampleId = keyof typeof SAMPLES;

/** Remotion composition id for a sample: "lighthouse" → "Lighthouse". */
export const compositionId = (id: string) => id.replace(/(^|[-_])(\w)/g, (_, __, c: string) => c.toUpperCase());
