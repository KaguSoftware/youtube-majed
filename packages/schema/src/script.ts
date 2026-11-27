import { z } from "zod";
import { LineId } from "./scene";

/**
 * Narration lines (docs/PLAN.md section 3). The full story format with loops,
 * stakes and head fakes arrives in Phase 2; Phase 0 only needs lines, so the
 * sample's captions have text to show.
 */

export const Line = z.strictObject({
  id: LineId,
  text: z.string().min(1),
  energy: z.int().min(1).max(5),
  delivery: z.string(),
});

export const ScriptFile = z.strictObject({
  version: z.literal(1),
  lines: z.array(Line).min(1),
});

export type Line = z.infer<typeof Line>;
export type ScriptFile = z.infer<typeof ScriptFile>;
