/**
 * The worker's job queue, kept in SQLite (projects/studio.sqlite, local only)
 * so a restart loses nothing: docs/PLAN.md section 10. A job stores its kind
 * and arguments, so it can be rebuilt; jobs that were queued, waiting or
 * running when the worker stopped are queued again on start. Steps already
 * finished are skipped on the rerun (steps.json), so resuming is cheap.
 *
 * One job at a time, in order, under the same lock file as the `pnpm story`
 * CLI: if the CLI is busy, the job waits.
 *
 * Uses node:sqlite (no native build). Node 24 still marks it experimental and
 * warns once; the worker scripts pass --disable-warning=ExperimentalWarning.
 */
import { StepName } from "@studio/schema";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { BusyError, acquire } from "./lock";
import type { Progress } from "./story";

export const JobKind = z.enum(["options", "write", "review", "fix", "rewrite", "storyboard", "voice", "mix", "render", "export", "edit", "rollback", "regenerate", "beat", "fixscenes"]);
export type JobKind = z.infer<typeof JobKind>;

const StepState = z.object({ phase: z.enum(["running", "done", "skipped"]), startedAt: z.number(), finishedAt: z.number().optional(), estimateMs: z.number().optional(), attempt: z.number() });
export type Job = {
  id: string;
  project: string;
  kind: JobKind;
  label: string;
  args: Record<string, unknown>;
  status: "queued" | "waiting" | "running" | "done" | "failed" | "cancelled";
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  steps: Partial<Record<StepName, z.infer<typeof StepState>>>;
  /** Local jobs (voice, mix, render, export): how far along, live only, not stored. */
  progress?: JobProgress;
  result?: unknown;
};

export type JobProgress = { label: string; done: number; total: number; detail?: string };

/** Rebuilds the work of a job from its stored kind and arguments. */
export type Runner = (job: Job, o: { progress: Progress; signal: AbortSignal; report: (p: JobProgress) => void }) => Promise<unknown>;

const Row = z.object({
  seq: z.number(),
  project: z.string(),
  kind: JobKind,
  label: z.string(),
  args: z.string(),
  status: z.enum(["queued", "waiting", "running", "done", "failed", "cancelled"]),
  created_at: z.number(),
  started_at: z.number().nullable(),
  finished_at: z.number().nullable(),
  error: z.string().nullable(),
  steps: z.string(),
  result: z.string().nullable(),
});

function fromRow(raw: unknown): Job {
  const r = Row.parse(raw);
  return {
    id: `j${r.seq}`,
    project: r.project,
    kind: r.kind,
    label: r.label,
    args: z.record(z.string(), z.unknown()).parse(JSON.parse(r.args)),
    status: r.status,
    createdAt: r.created_at,
    ...(r.started_at === null ? {} : { startedAt: r.started_at }),
    ...(r.finished_at === null ? {} : { finishedAt: r.finished_at }),
    ...(r.error === null ? {} : { error: r.error }),
    steps: z.partialRecord(StepName, StepState).parse(JSON.parse(r.steps)),
    ...(r.result === null ? {} : { result: JSON.parse(r.result) as unknown }),
  };
}

export class JobQueue {
  private db: DatabaseSync;
  private controllers = new Map<string, AbortController>();
  /** live progress of running local jobs, by job id */
  private live = new Map<string, JobProgress>();
  private lastEmit = new Map<string, number>();
  private pumping = false;
  private stopped = false;

  constructor(
    file: string,
    private runners: Record<JobKind, Runner>,
    private emit: (job: Job) => void = () => {},
    private pollMs = 3000,
  ) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists jobs (
        seq integer primary key autoincrement,
        project text not null,
        kind text not null,
        label text not null,
        args text not null default '{}',
        status text not null,
        created_at integer not null,
        started_at integer,
        finished_at integer,
        error text,
        steps text not null default '{}',
        result text
      );
      create index if not exists jobs_project on jobs(project, seq);
    `);
  }

  /** Jobs the last worker left unfinished go back in the queue. Returns them. */
  recover(): Job[] {
    const rows = this.db.prepare("select * from jobs where status in ('queued','waiting','running') order by seq").all().map(fromRow);
    this.db.prepare("update jobs set status = 'queued', started_at = null, steps = '{}', error = ? where status in ('waiting','running')").run("resumed after the worker restarted");
    return rows.map((j) => (j.status === "queued" ? j : { ...j, status: "queued" as const, error: "resumed after the worker restarted" }));
  }

  enqueue(project: string, kind: JobKind, label: string, args: Record<string, unknown> = {}): Job {
    const r = this.db.prepare("insert into jobs (project, kind, label, args, status, created_at) values (?, ?, ?, ?, 'queued', ?)").run(project, kind, label, JSON.stringify(args), Date.now());
    const job = this.get(`j${r.lastInsertRowid}`)!;
    this.emit(job);
    void this.pump();
    return job;
  }

  get(id: string): Job | undefined {
    const row = this.db.prepare("select * from jobs where seq = ?").get(Number(id.slice(1)));
    return row ? this.withLive(fromRow(row)) : undefined;
  }

  /** The newest jobs, oldest first. */
  list(limit = 30, project?: string): Job[] {
    const rows = project
      ? this.db.prepare("select * from jobs where project = ? order by seq desc limit ?").all(project, limit)
      : this.db.prepare("select * from jobs order by seq desc limit ?").all(limit);
    return rows.map((r) => this.withLive(fromRow(r))).reverse();
  }

  cancel(id: string): Job | undefined {
    const job = this.get(id);
    if (!job) return undefined;
    if (job.status === "queued" || job.status === "waiting") this.save({ ...job, status: "cancelled", finishedAt: Date.now() });
    else this.controllers.get(id)?.abort();
    return this.get(id);
  }

  /** Stops taking new jobs (for tests and shutdown). A running job finishes. */
  close(): void {
    this.stopped = true;
    this.db.close();
  }

  private withLive(job: Job): Job {
    const p = this.live.get(job.id);
    return p && job.status === "running" ? { ...job, progress: p } : job;
  }

  private save(job: Job): void {
    this.db
      .prepare("update jobs set status = ?, started_at = ?, finished_at = ?, error = ?, steps = ?, result = ? where seq = ?")
      .run(job.status, job.startedAt ?? null, job.finishedAt ?? null, job.error ?? null, JSON.stringify(job.steps), job.result === undefined ? null : JSON.stringify(job.result), Number(job.id.slice(1)));
    this.emit(this.withLive(job));
  }

  private next(): Job | undefined {
    const row = this.db.prepare("select * from jobs where status = 'queued' order by seq limit 1").get();
    return row ? fromRow(row) : undefined;
  }

  async pump(): Promise<void> {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    try {
      for (let job = this.next(); job && !this.stopped; job = this.next()) {
        const release = await this.waitForLock(job);
        if (!release) continue;
        await this.run(job, release);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async waitForLock(job: Job): Promise<(() => void) | undefined> {
    for (;;) {
      try {
        return acquire(`app: ${job.label}`);
      } catch (e) {
        if (!(e instanceof BusyError)) throw e;
        if (job.status !== "waiting") {
          job = { ...job, status: "waiting", error: e.message };
          this.save(job);
        }
        await new Promise((r) => setTimeout(r, this.pollMs));
        if (this.stopped || this.get(job.id)?.status === "cancelled") return undefined;
      }
    }
  }

  private async run(queued: Job, release: () => void): Promise<void> {
    const ac = new AbortController();
    this.controllers.set(queued.id, ac);
    let job: Job = { ...queued, status: "running", startedAt: Date.now(), steps: {} };
    delete job.error;
    this.save(job);
    const report = (p: JobProgress) => {
      this.live.set(job.id, p);
      const now = Date.now();
      if (now - (this.lastEmit.get(job.id) ?? 0) < 400 && p.done < p.total) return;
      this.lastEmit.set(job.id, now);
      this.emit(this.withLive(job));
    };
    const progress: Progress = (e) => {
      const steps = { ...job.steps };
      const s = steps[e.step];
      if (e.phase === "start") steps[e.step] = { phase: "running", startedAt: Date.now(), ...(e.estimateMs ? { estimateMs: e.estimateMs } : {}), attempt: 1 };
      else if (e.phase === "attempt" && s) steps[e.step] = { ...s, attempt: e.attempt ?? 1 };
      else if (e.phase === "done" && s) steps[e.step] = { ...s, phase: "done", finishedAt: Date.now() };
      else if (e.phase === "skipped") steps[e.step] = { phase: "skipped", startedAt: Date.now(), finishedAt: Date.now(), attempt: 0 };
      job = { ...job, steps };
      this.save(job);
    };
    try {
      const result = await this.runners[job.kind](job, { progress, signal: ac.signal, report });
      job = { ...job, status: "done", result: result ?? null };
    } catch (e) {
      job = { ...job, status: ac.signal.aborted ? "cancelled" : "failed", error: (e as Error).message };
    } finally {
      release();
      this.controllers.delete(job.id);
      this.live.delete(job.id);
      this.lastEmit.delete(job.id);
      job = { ...job, finishedAt: Date.now() };
      if (!this.stopped) this.save(job);
    }
  }
}
