/**
 * What the worker answers, checked with zod (the app trusts nothing that
 * crosses a process boundary). Shared by server components (which call the
 * worker directly) and client components (which go through /api/worker).
 */
import { Brief, CastId, CastMember, Comment, FactCheckOutput, LoopMapOutput, MasterOptionsOutput, MixResult, NarrationFile, PickFile, PipelineState, ReelCutFile, ReelRecord, RenderRecord, ReviewRound, SceneFile, StepName, StoryboardFile } from "@studio/schema";
import { z } from "zod";

export const Job = z.object({
  id: z.string(),
  project: z.string(),
  kind: z.enum(["options", "write", "review", "fix", "rewrite", "storyboard", "voice", "mix", "render", "export", "edit", "rollback", "regenerate", "beat", "fixscenes", "reelcut", "reelexport"]),
  label: z.string(),
  status: z.enum(["queued", "waiting", "running", "done", "failed", "cancelled"]),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  error: z.string().optional(),
  steps: z.partialRecord(StepName, z.object({ phase: z.enum(["running", "done", "skipped"]), startedAt: z.number(), finishedAt: z.number().optional(), estimateMs: z.number().optional(), attempt: z.number() })),
  /** voice, mix, render and export report how far along they are */
  progress: z.object({ label: z.string(), done: z.number(), total: z.number(), detail: z.string().optional() }).optional(),
});
export type Job = z.infer<typeof Job>;

const Totals = z.object({ calls: z.number(), failed: z.number(), inputTokens: z.number(), outputTokens: z.number(), cacheReadTokens: z.number(), cacheWriteTokens: z.number(), webSearches: z.number(), durationMs: z.number(), costUsd: z.number() });

export const ProjectSummary = z.object({
  id: z.string(),
  brief: Brief,
  state: z.enum(["brief", "options", "writing", "script", "locked"]),
  title: z.string().nullable(),
  lockedAt: z.string().nullable(),
  updatedAt: z.string(),
  budget: z.number(),
  wpm: z.number(),
  pipeline: PipelineState,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ProjectDetail = ProjectSummary.extend({
  options: MasterOptionsOutput.nullable(),
  pick: PickFile.nullable(),
  loopmap: LoopMapOutput.nullable(),
  narration: NarrationFile.nullable(),
  comments: z.array(Comment),
  history: z.array(ReviewRound),
  factcheck: FactCheckOutput.nullable(),
  steps: z.record(z.string(), z.object({ inputHash: z.string(), finishedAt: z.string() })),
  usage: z.object({ total: Totals, byStep: z.record(z.string(), Totals) }),
  jobs: z.array(Job),
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;

export class WorkerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** A request through the same-origin proxy, validated. */
export async function call<T extends z.ZodType>(path: string, schema: T, init?: { method?: string; body?: unknown }): Promise<z.output<T>> {
  const res = await fetch(`/api/worker${path}`, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json" },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new WorkerError((data as { error?: string }).error ?? `The worker answered ${res.status}`, res.status);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new WorkerError(`The worker sent something unexpected: ${parsed.error.issues[0]?.message ?? ""}`, 502);
  // anything that wrote something may have moved a step: the stepper listens
  if ((init?.method ?? (init?.body !== undefined ? "POST" : "GET")) !== "GET" && typeof window !== "undefined") window.dispatchEvent(new Event("studio:changed"));
  return parsed.data;
}

/** A project's file through the same-origin proxy (the player seeks with byte ranges). Only renders, takes and the mixed track are served. */
export const fileUrl = (id: string, rel: string, download = false) => `/api/worker/projects/${id}/file/${rel}${download ? "?download=1" : ""}`;

// ---------------------------------------------------------------- phase 3 pages

export const VoiceState = z.object({
  voice: z
    .object({
      engine: z.object({ name: z.string(), revision: z.string(), device: z.string() }),
      reference: z.string(),
      track: z.object({ file: z.string(), duration: z.number(), loudness: z.object({ integratedLufs: z.number(), truePeakDbtp: z.number(), targetLufs: z.number() }) }),
      lines: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
          energy: z.number(),
          offset: z.number(),
          duration: z.number(),
          file: z.string(),
          quality: z.object({ status: z.enum(["ok", "warn", "fail"]), wer: z.number(), heard: z.string(), issues: z.array(z.string()), attempts: z.number() }),
          retake: z.object({ seed: z.number().optional(), energy: z.number().optional() }).nullable(),
        }),
      ),
    })
    .nullable(),
});
export type VoiceState = z.infer<typeof VoiceState>;

export const StoryboardState = z.object({ storyboard: StoryboardFile.nullable() });
export const ScenesState = z.object({ scenes: SceneFile.nullable() });
export const CastState = z.object({ cast: z.record(CastId, CastMember).nullable() });
export const MixState = z.object({ mix: MixResult.nullable() });
export const RendersState = z.object({ preview: RenderRecord.nullable(), export: RenderRecord.nullable() });

/** The Reel export of a project (9:16), whether it is out of date, and how Reel cuts and long videos are linked. */
export const ReelState = z.object({
  format: z.enum(["youtube", "reel"]),
  links: z.object({
    cutFrom: ReelCutFile.nullable(),
    reels: z.array(z.object({ id: z.string(), seconds: z.number().nullable(), loopId: z.string(), createdAt: z.string() })),
  }),
  reel: ReelRecord.nullable(),
  stale: z.boolean(),
});
export type ReelState = z.infer<typeof ReelState>;

export const JobResponse = z.object({ job: Job }).loose();
export type StoryboardState = z.infer<typeof StoryboardState>;
export type ScenesState = z.infer<typeof ScenesState>;
export type CastState = z.infer<typeof CastState>;
export type RendersState = z.infer<typeof RendersState>;
export type MixState = z.infer<typeof MixState>;
