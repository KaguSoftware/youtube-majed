import { z } from "zod";
import { SceneId } from "./scene";

/**
 * Phase 0 only: seconds per scene, kept out of the scene file so scenes stay
 * timing-free. From Phase 1 on, scene timing comes from word timestamps and
 * this file goes away.
 */
export const TimingFile = z.strictObject({
  version: z.literal(1),
  fps: z.literal(30),
  seconds: z.record(SceneId, z.number().min(0.5, "a scene must last at least 0.5 s").max(60)),
});

export type TimingFile = z.infer<typeof TimingFile>;
