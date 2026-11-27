import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { acquire } from "./lock";
import { JobQueue, type Job, type JobKind, type Runner } from "./queue";
import { useFakeClaude } from "./test-env";

const env = useFakeClaude();
let n = 0;
const dbFile = () => join(env.dir, `queue-${++n}.sqlite`);

function stub(log: string[], ms = 20) {
  let running = 0;
  let maxRunning = 0;
  const run: Runner = async (job) => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    log.push(`${job.kind}:${job.project}:${JSON.stringify(job.args)}`);
    await new Promise((r) => setTimeout(r, ms));
    running--;
    return { ok: job.id };
  };
  const runners = Object.fromEntries((["options", "write", "review", "fix", "rewrite"] as JobKind[]).map((k) => [k, run])) as Record<JobKind, Runner>;
  return { runners, maxRunning: () => maxRunning };
}

async function settled(q: JobQueue, ids: string[]): Promise<Job[]> {
  for (let i = 0; i < 200; i++) {
    const jobs = ids.map((id) => q.get(id)!);
    if (jobs.every((j) => ["done", "failed", "cancelled"].includes(j.status))) return jobs;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("jobs did not settle");
}

describe("JobQueue", () => {
  it("runs jobs one at a time, in order, and keeps them in SQLite", async () => {
    const log: string[] = [];
    const s = stub(log);
    const file = dbFile();
    const q = new JobQueue(file, s.runners);
    const a = q.enqueue("p1", "write", "write p1", { force: false });
    const b = q.enqueue("p2", "rewrite", "rewrite p2", { lineIds: ["L1.1"], direction: "shorter" });
    const done = await settled(q, [a.id, b.id]);
    expect(done.map((j) => j.status)).toEqual(["done", "done"]);
    expect(log).toEqual(['write:p1:{"force":false}', 'rewrite:p2:{"lineIds":["L1.1"],"direction":"shorter"}']);
    expect(s.maxRunning()).toBe(1);
    expect(done[1]!.result).toEqual({ ok: b.id });
    q.close();
    // a new queue on the same file sees the history
    const again = new JobQueue(file, s.runners);
    expect(again.list().map((j) => [j.id, j.status])).toEqual([[a.id, "done"], [b.id, "done"]]);
    again.close();
  });

  it("resumes the jobs a stopped worker left unfinished, with their arguments", async () => {
    const file = dbFile();
    new JobQueue(file, stub([]).runners).close(); // creates the table
    const db = new DatabaseSync(file);
    const insert = db.prepare("insert into jobs (project, kind, label, args, status, created_at, started_at, steps) values (?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run("p1", "review", "review of p1", JSON.stringify({ force: false, fix: true }), "running", 1, 2, JSON.stringify({ critic: { phase: "running", startedAt: 2, attempt: 1 } }));
    insert.run("p2", "fix", "fix p2", "{}", "queued", 3, null, "{}");
    insert.run("p3", "fix", "fix p3", "{}", "done", 4, null, "{}");
    db.close();

    const log: string[] = [];
    const q = new JobQueue(file, stub(log).runners);
    const resumed = q.recover();
    expect(resumed.map((j) => [j.project, j.status])).toEqual([["p1", "queued"], ["p2", "queued"]]);
    await q.pump();
    expect(log).toEqual(['review:p1:{"force":false,"fix":true}', "fix:p2:{}"]);
    expect(q.list().map((j) => j.status)).toEqual(["done", "done", "done"]);
    q.close();
  });

  it("cancels a queued job before it starts", async () => {
    const log: string[] = [];
    const q = new JobQueue(dbFile(), stub(log, 60).runners);
    const a = q.enqueue("p1", "fix", "a");
    const b = q.enqueue("p1", "fix", "b");
    expect(q.cancel(b.id)!.status).toBe("cancelled");
    await settled(q, [a.id, b.id]);
    expect(log).toHaveLength(1);
    q.close();
  });

  it("waits while another job (the CLI) holds the lock", async () => {
    const log: string[] = [];
    const seen: string[] = [];
    const q = new JobQueue(dbFile(), stub(log).runners, (j) => seen.push(j.status), 20);
    const release = acquire("story review elsewhere");
    const a = q.enqueue("p1", "fix", "a");
    await new Promise((r) => setTimeout(r, 80));
    expect(q.get(a.id)!.status).toBe("waiting");
    release();
    await settled(q, [a.id]);
    expect(seen).toEqual(expect.arrayContaining(["queued", "waiting", "running", "done"]));
    q.close();
  });
});
