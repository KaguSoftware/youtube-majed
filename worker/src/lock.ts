/**
 * One job at a time, across processes: the worker server and any `pnpm story`
 * command take projects/.job.lock before calling Claude. A lock left by a
 * process that no longer exists is stale and taken over.
 */
import { projectsDir } from "@studio/project";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const Holder = z.object({ pid: z.int(), label: z.string(), startedAt: z.string() });
export type Holder = z.infer<typeof Holder>;

export class BusyError extends Error {
  override name = "BusyError";
  constructor(readonly holder: Holder) {
    super(`another job is running: ${holder.label} (pid ${holder.pid}, since ${holder.startedAt}). One job at a time.`);
  }
}

const lockFile = () => join(projectsDir(), ".job.lock");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function currentHolder(): Holder | undefined {
  try {
    const h = Holder.parse(JSON.parse(readFileSync(lockFile(), "utf8")));
    return alive(h.pid) ? h : undefined;
  } catch {
    return undefined;
  }
}

/** Takes the lock or throws BusyError. Returns the release function. */
export function acquire(label: string): () => void {
  mkdirSync(projectsDir(), { recursive: true });
  const file = lockFile();
  for (let tries = 0; tries < 2; tries++) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, label, startedAt: new Date().toISOString() }));
      closeSync(fd);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        process.off("exit", release);
        rmSync(file, { force: true });
      };
      process.on("exit", release);
      return release;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = currentHolder();
      if (holder) throw new BusyError(holder);
      rmSync(file, { force: true }); // stale: its process is gone
    }
  }
  throw new Error(`could not take ${file}`);
}

export async function withLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const release = acquire(label);
  try {
    return await fn();
  } finally {
    release();
  }
}
