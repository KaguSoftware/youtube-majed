"use client";
/**
 * What the Shots tab of the editor reads from the worker (worker/src/custom-shots-api.ts), checked with zod.
 * Custom shots (docs/PLAN.md section 6) live beside the scene JSON, never in it: the library scene stays the fallback.
 */
import { CustomShot, CustomShotLogLine, type FailureKind } from "@studio/schema";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { call } from "./api";

export const ShotRow = CustomShot.extend({ live: z.boolean(), stale: z.boolean() });
export type ShotRow = z.infer<typeof ShotRow>;

export const Suggestion = z.object({ scene: z.string(), why: z.string(), score: z.number(), seconds: z.number(), revealAt: z.string().nullable() });
export type Suggestion = z.infer<typeof Suggestion>;

export const ShotsState = z.object({
  max: z.number(),
  live: z.number(),
  shots: z.array(ShotRow),
  suggestions: z.array(Suggestion),
  log: z.array(CustomShotLogLine),
});
export type ShotsState = z.infer<typeof ShotsState>;

export const VerdictResponse = z.object({ shot: z.unknown() }).loose();

/** The custom shots of a project, reloaded whenever a job for it finishes. `undefined` until the first answer, `null` if the worker is older than the routes. */
export function useShots(id: string, trigger: string | undefined) {
  const [state, setState] = useState<ShotsState | null | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      setState(await call(`/projects/${id}/custom-shots`, ShotsState));
    } catch {
      setState((s) => (s === undefined ? null : s));
    }
  }, [id]);
  useEffect(() => void load(), [load, trigger]);
  return { state, load };
}

export const FAILURE: Record<FailureKind, string> = {
  import_rule: "Imported something it may not",
  typecheck: "Does not typecheck",
  crash: "Crashed while drawing",
  timeout: "Took too long to draw",
  blank: "Drew a blank picture",
  claude: "Claude's answer was unusable",
  other: "Failed a check",
};

/** "crash: the landscape frame fails at frame 63: …" → its kind and the rest. */
export function reasonOf(reason: string): { kind: FailureKind | null; text: string } {
  const m = /^(import_rule|typecheck|crash|timeout|blank|claude|other): ([\s\S]*)$/.exec(reason);
  return m ? { kind: m[1] as FailureKind, text: m[2]! } : { kind: null, text: reason };
}

/** `custom/stills` file names carry their frame: "S93/ab12/landscape-0042.jpg" → 42. */
export const frameOf = (still: string): number => Number(/-(\d+)\.jpg$/.exec(still)?.[1] ?? 0);
