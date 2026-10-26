import "server-only";

import { getCache } from "@vercel/functions";

/**
 * The worker's doorbell. See pipeline/worker.py, "The doorbell".
 *
 * An idle worker polls GET /api/worker/doorbell instead of Postgres, so the
 * database can scale to zero (Neon's free tier allows 100 compute-hours a
 * month; a worker polling every few seconds would use ~180). The value lives
 * in Vercel's runtime cache and changes whenever a job is enqueued. The
 * worker only compares it with the last value it saw, so any change — a
 * ring, or a fresh value written after an eviction — sends it to the
 * database once.
 */

const RING = "doorbell:ring";
const WORKERS = "doorbell:workers";
const RING_TTL = 30 * 24 * 3600;
/** A worker entry is refreshed at most this often, to keep cache writes low. */
const LIVENESS_WRITE_MS = 60_000;
/** Doorbell polls are every 15s; three missed polls reads as offline. */
export const IDLE_OFFLINE_MS = 60_000;

const cache = () => getCache({ namespace: "ytm" });

function fresh(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Call after every enqueue, once the job row is committed. */
export async function ring(): Promise<void> {
  await cache().set(RING, fresh("e"), { ttl: RING_TTL, name: "worker doorbell" });
}

export async function currentRing(): Promise<string> {
  const c = cache();
  const value = await c.get(RING);
  if (typeof value === "string") return value;
  // Evicted or never set. A fresh value reads as a ring, so the worker checks
  // the database once rather than possibly missing a job.
  const next = fresh("m");
  await c.set(RING, next, { ttl: RING_TTL, name: "worker doorbell" });
  return next;
}

export type IdleWorker = { id: string; kinds: string[]; at: number };

/** Record that a worker polled. Writes at most once a minute per worker. */
export async function noteWorker(id: string, kinds: string[]): Promise<void> {
  const c = cache();
  const key = `worker:${id}`;
  const prev = (await c.get(key)) as IdleWorker | null;
  const now = Date.now();
  if (prev && now - prev.at < LIVENESS_WRITE_MS) return;
  await c.set(key, { id, kinds, at: now } satisfies IdleWorker, { ttl: 3600 });
  const ids = ((await c.get(WORKERS)) as string[] | null) ?? [];
  if (!ids.includes(id)) await c.set(WORKERS, [...ids, id].slice(-16), { ttl: 30 * 24 * 3600 });
}

/** Workers seen polling the doorbell recently: the idle half of liveness.
 *  A busy worker does not poll; its heartbeat updates workers.last_seen_at. */
export async function idleWorkers(): Promise<IdleWorker[]> {
  const c = cache();
  const ids = ((await c.get(WORKERS)) as string[] | null) ?? [];
  const entries = await Promise.all(ids.map((id) => c.get(`worker:${id}`) as Promise<IdleWorker | null>));
  return entries.filter((e): e is IdleWorker => e !== null);
}
