import "server-only";

import { one, query } from "./db";

export type Preset = { id: string; name: string; preset_json: { preset: string; prompt_prefix: string } };
export type Candidate = { seed: number; key: string; hash: string };
export type StyleRun = {
  id: string; candidates_json: Candidate[]; preset_id: string | null; beat_id: string | null;
  prompt_prefix: string | null; created_at: Date;
};
export type Locked = {
  id: string; preset_json: { preset: string; prompt_prefix: string; seed: number; hero_full: string;
    hero_crop?: string; crop_box: [number, number, number, number] };
};

export const presets = () =>
  query<Preset>("SELECT id, name, preset_json FROM styles WHERE is_library ORDER BY created_at");

export const styleRuns = (projectId: string) =>
  query<StyleRun>(
    "SELECT id, candidates_json, preset_id, beat_id, prompt_prefix, created_at FROM style_runs " +
    "WHERE project_id = $1 ORDER BY id DESC LIMIT 6", [projectId]);

export async function lockedStyle(projectId: string): Promise<Locked | null> {
  return one<Locked>(
    "SELECT s.id, s.preset_json FROM projects p JOIN styles s ON s.id = p.style_id " +
    "WHERE p.id = $1 AND NOT s.is_library", [projectId]);
}

/** Candidates that have finished while a style job is still running: the
 *  job's `candidate` events, so frames appear one by one. */
export async function paintingNow(projectId: string) {
  return one<{ id: string; state: string; payload: { seeds: number[] }; started_at: Date | null; keys: string[] | null }>(
    `SELECT j.id, j.state, j.payload, j.started_at,
            (SELECT array_agg(e.data->>'key' ORDER BY e.id) FROM job_events e
              WHERE e.job_id = j.id AND e.kind = 'candidate' AND e.attempt = j.attempts) AS keys
     FROM jobs j WHERE j.project_id = $1 AND j.kind = 'style' AND j.state IN ('queued', 'running')
     ORDER BY j.id DESC LIMIT 1`, [projectId]);
}

/** A sensible first crop: a tall band in the middle of the frame, where a
 *  painted figure usually stands. The user adjusts it; the worker crops to
 *  whatever they confirm. */
export const DEFAULT_BOX: [number, number, number, number] = [0.32, 0.06, 0.68, 0.98];
