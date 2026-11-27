import "server-only";
import { z } from "zod";
import { ProjectDetail, ProjectSummary } from "./api";
import { WORKER_URL } from "./worker-url";

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string; offline: boolean };

async function get<T extends z.ZodType>(path: string, schema: T): Promise<Loaded<z.output<T>>> {
  let res: Response;
  try {
    res = await fetch(WORKER_URL + path, { cache: "no-store" });
  } catch {
    return { ok: false, offline: true, error: "The worker isn't running." };
  }
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, offline: false, error: (data as { error?: string }).error ?? `The worker answered ${res.status}` };
  const parsed = schema.safeParse(data);
  if (!parsed.success) return { ok: false, offline: false, error: `The worker sent something unexpected: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  return { ok: true, data: parsed.data };
}

export const loadProjects = () => get("/projects", z.array(ProjectSummary));
export const loadProject = (id: string) => get(`/projects/${encodeURIComponent(id)}`, ProjectDetail);
