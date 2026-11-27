/**
 * What the worker answers, checked with zod (the app trusts nothing that
 * crosses a process boundary). Shared by server components (which call the
 * worker directly) and client components (which go through /api/worker).
 */
import { Brief, Comment, FactCheckOutput, LoopMapOutput, MasterOptionsOutput, NarrationFile, PickFile, ReviewRound, StepName } from "@studio/schema";
import { z } from "zod";

export const Job = z.object({
  id: z.string(),
  project: z.string(),
  kind: z.enum(["options", "write", "review", "fix", "rewrite"]),
  label: z.string(),
  status: z.enum(["queued", "waiting", "running", "done", "failed", "cancelled"]),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  error: z.string().optional(),
  steps: z.partialRecord(StepName, z.object({ phase: z.enum(["running", "done", "skipped"]), startedAt: z.number(), finishedAt: z.number().optional(), estimateMs: z.number().optional(), attempt: z.number() })),
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
  return parsed.data;
}

export const JobResponse = z.object({ job: Job }).loose();
