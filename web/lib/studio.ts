import "server-only";

import { query } from "./db";
import { idleWorkers, IDLE_OFFLINE_MS } from "./doorbell";

/** pipeline/jobs.py OFFLINE_AFTER_SECONDS: three missed heartbeats. */
const BUSY_OFFLINE_MS = 45_000;

export type Lane = "gpu" | "light";
export type MachineState =
  | { state: "offline"; lastSeen: Date | null }
  | { state: "ready" }
  | { state: "busy"; doing: string; projectId: string };

type WorkerRow = {
  id: string; kinds: string[]; last_seen_at: Date; age_ms: number;
  current_job: string | null; job_kind: string | null; project_id: string | null; topic: string | null;
};

const DOING: Record<string, string> = {
  production: "Rendering", style: "Painting looks for", research: "Claude is researching",
  script: "Claude is writing the script for",
  edit: "Changing", export: "Preparing a download of",
};

/**
 * Whether the studio machine can take work, per lane. Two sources, because a
 * worker reports in two ways: while busy its heartbeat updates
 * workers.last_seen_at every 15s; while idle it polls the doorbell instead
 * (lib/doorbell.ts) and leaves the database alone.
 */
export async function machineStatus(): Promise<Record<Lane, MachineState>> {
  const [rows, idle] = await Promise.all([
    query<WorkerRow>(`
      SELECT w.id, w.kinds, w.last_seen_at,
             extract(epoch FROM now() - w.last_seen_at) * 1000 AS age_ms,
             w.current_job, j.kind AS job_kind, j.project_id, p.topic
      FROM workers w
      LEFT JOIN jobs j ON j.id = w.current_job
      LEFT JOIN projects p ON p.id = j.project_id
      ORDER BY w.last_seen_at DESC`),
    idleWorkers().catch(() => []),
  ]);
  const now = Date.now();
  const lane = (l: Lane): MachineState => {
    const mine = rows.filter((w) => w.kinds.some((k) => (l === "gpu" ? k === "production" : k === "research")));
    const busy = mine.find((w) => w.current_job && Number(w.age_ms) < BUSY_OFFLINE_MS);
    if (busy) {
      return { state: "busy", doing: `${DOING[busy.job_kind ?? ""] ?? "Working on"} ${busy.topic ?? busy.project_id}`,
        projectId: busy.project_id ?? "" };
    }
    const fresh = mine.some((w) => Number(w.age_ms) < BUSY_OFFLINE_MS) ||
      idle.some((w) => now - w.at < IDLE_OFFLINE_MS &&
        w.kinds.some((k) => (l === "gpu" ? k === "production" : k === "research")));
    if (fresh) return { state: "ready" };
    return { state: "offline", lastSeen: mine[0]?.last_seen_at ?? null };
  };
  return { gpu: lane("gpu"), light: lane("light") };
}

type WorkerHealth = {
  pins?: { problems?: string[]; notes?: string[] } | null;
  smoke?: { ok?: boolean; at?: string; failures?: string[]; drift?: string[] } | null;
};

/**
 * What the studio machine last found wrong with itself (pipeline/worker.py,
 * migration 006). `refusing` says what it will not do until fixed: "all" when
 * its software no longer matches what was tested, "gpu" when its nightly test
 * film failed. `drift` is the softer case: the test film came out differently
 * from before, and films still render. `details` are the machine's own words,
 * for whoever looks after it.
 */
export type MachineHealth = {
  refusing: "all" | "gpu" | null;
  drift: boolean;
  details: string[];
  checkedAt: Date | null;
};

export async function machineHealth(): Promise<MachineHealth | null> {
  const rows = await query<{ kinds: string[]; health: WorkerHealth | null }>(`
    SELECT DISTINCT ON ('production' = ANY(kinds)) kinds, health
    FROM workers ORDER BY 'production' = ANY(kinds), last_seen_at DESC`);
  const pins = rows.flatMap((r) => r.health?.pins?.problems ?? []);
  const smoke = rows.find((r) => r.kinds.includes("production"))?.health?.smoke ?? null;
  const failures = smoke?.failures ?? [];
  const drift = smoke?.drift ?? [];
  if (!pins.length && !failures.length && !drift.length) return null;
  return {
    refusing: pins.length ? "all" : failures.length ? "gpu" : null,
    drift: drift.length > 0,
    details: [...pins, ...failures, ...drift],
    checkedAt: smoke?.at ? new Date(smoke.at) : null,
  };
}

/** Work that is waiting for a lane: the offline banner only matters then. */
export async function waitingWork(): Promise<{ gpu: number; light: number; renders: number; looks: number }> {
  const [row] = await query<{ renders: string; looks: string; light: string }>(`
    SELECT count(*) FILTER (WHERE kind = 'production') AS renders,
           count(*) FILTER (WHERE kind IN ('style', 'edit', 'export')) AS looks,
           count(*) FILTER (WHERE kind IN ('research', 'script')) AS light
    FROM jobs WHERE state = 'queued' AND coalesce((payload->>'fake')::boolean, false) = false`);
  const renders = Number(row?.renders ?? 0), looks = Number(row?.looks ?? 0);
  return { gpu: renders + looks, light: Number(row?.light ?? 0), renders, looks };
}
