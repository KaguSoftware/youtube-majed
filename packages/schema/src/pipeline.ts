import { z } from "zod";

/**
 * The nine steps of docs/PLAN.md section 2, and where a project stands in
 * them. Computed by the worker (worker/src/pipeline.ts) from the files on disk
 * and the job queue, shown by the app's stepper.
 *
 * Status words (never colour alone):
 *   waiting    can't start yet: something before it isn't done
 *   running    a job for this step is running or queued
 *   needs_you  ready, and the next move is yours: a decision, or a go
 *   done       finished
 * `stale` is separate: a finished step whose inputs changed since. Its output
 * is kept (so the next step can reuse what is still valid) but flagged.
 */
export const STEP_KEYS = ["brief", "story", "review", "script", "voice", "storyboard", "render", "editor", "export"] as const;
export const StepKey = z.enum(STEP_KEYS);
export type StepKey = z.infer<typeof StepKey>;

export const StepStatus = z.enum(["waiting", "running", "needs_you", "done"]);
export type StepStatus = z.infer<typeof StepStatus>;

export const StageState = z.strictObject({
  key: StepKey,
  status: StepStatus,
  /** done, but made from inputs that have changed since */
  stale: z.boolean(),
  /** one plain sentence: what is true now, or what is missing */
  note: z.string(),
});
export type StageState = z.infer<typeof StageState>;

export const PipelineState = z.strictObject({
  stages: z.array(StageState).length(STEP_KEYS.length),
  /** the first step that is not done (or "export" when everything is) */
  current: StepKey,
});
export type PipelineState = z.infer<typeof PipelineState>;
