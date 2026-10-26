import "server-only";

import { one, query } from "./db";

/*
 * A film's cuts: the immutable timeline versions (pipeline/migrations
 * 005_editing.sql). The studio calls a version a "cut". The film *is* the
 * cut projects.timeline_version points at; an edit adds a cut on top of it
 * and moves the pointer, undo moves it back. Nothing is ever rewritten.
 */

export type Hls = {
  fps: number; base: number; codecs: string; width: number; height: number;
  narration: string; duration: number; chunks: { key: string; frames: number }[];
  /** [seconds, length, offset] byte ranges of the narration file. */
  narration_slices?: [number, number, number][];
};

/**
 * `look`: why a person should check this shot before the film goes out, in
 * plain words; empty when nothing was flagged (PLAN.md section 5, failure
 * modes 5 and 6). The checks ran on the studio machine; this only reads what
 * they recorded on the timeline.
 */
export type ShotMark = { id: string; start: number; end: number; text: string; look: string[] };

/**
 * pipeline/align.py WEAK_WORD_SCORE: below this the aligner was unsure it
 * heard the word (selftest holds the two equal). One such word is noise: in
 * the three local films, all watched and right, 25 of ~150 shots had one,
 * mostly names (Nahuatl, Catterick) and short words ("of"). A run of them is
 * the shape of mangled audio: time-reversing three words of real narration
 * left every one of them unsure, while the good films had no run of even two
 * (PLAN.md 13). So a shot is flagged for runs only. The narration gate fails
 * such audio outright; this is for a film made past the gate on purpose.
 */
const WEAK_WORD_SCORE = 0.25;

export type Change = {
  request: string; at: number | null; summary: string;
  ops: { tool: string; args: Record<string, unknown>; result: string }[];
  shots: string[];
  timings?: Record<string, number>;
};

export type Cut = {
  version: number;
  parent_version: number | null;
  created_at: Date;
  by: string | null;
  change: Change | null;
  duration: number;
  hls: Hls | null;
  film: string | null;
  sheet: { key: string; cols: number; rows: number; thumb: [number, number]; shots: string[] } | null;
};

const SELECT = `
  SELECT t.version, t.parent_version, t.created_at, u.display_name AS by, t.change,
         (t.timeline_json->>'duration')::float AS duration,
         t.timeline_json->'media'->'hls' AS hls,
         t.timeline_json->'media'->>'film' AS film,
         t.timeline_json->'media'->'sheet' AS sheet
  FROM timelines t LEFT JOIN users u ON u.id = t.created_by`;

export async function listCuts(projectId: string): Promise<Cut[]> {
  return query<Cut>(`${SELECT} WHERE t.project_id = $1 ORDER BY t.version DESC LIMIT 100`, [projectId]);
}

export async function getCut(projectId: string, version: number): Promise<Cut | null> {
  return one<Cut>(`${SELECT} WHERE t.project_id = $1 AND t.version = $2`, [projectId, version]);
}

/** The cut the film is: the pointer, or the newest for a film from before it. */
export async function currentVersion(projectId: string): Promise<number | null> {
  const row = await one<{ v: number | null }>(
    `SELECT coalesce(p.timeline_version,
       (SELECT max(version) FROM timelines WHERE project_id = p.id)) AS v
     FROM projects p WHERE p.id = $1`, [projectId]);
  return row?.v ?? null;
}

/** Where each shot sits in a cut, for the strip under the player. */
export async function shotMarks(projectId: string, version: number): Promise<ShotMark[]> {
  const rows = await query<Omit<ShotMark, "look"> & {
    qa_failed: boolean | null; qa_failures: string[] | null; attempts: number | null; unsure: string[] | null;
  }>(
    `SELECT s->>'shot_id' AS id, (s->>'start')::float AS start, (s->>'end')::float AS end, s->>'text' AS text,
            (s->'image'->'qa'->>'ok')::boolean = false AS qa_failed,
            s->'image'->'qa'->'failures' AS qa_failures,
            (s->'image'->>'attempts')::int AS attempts,
            (SELECT jsonb_agg(word ORDER BY n) FROM (
               SELECT o.w->>'word' AS word, o.n, (o.w->>'score')::float < $3 AS weak,
                      lag((o.w->>'score')::float) OVER (ORDER BY o.n) < $3 AS after_weak,
                      lead((o.w->>'score')::float) OVER (ORDER BY o.n) < $3 AS before_weak
               FROM jsonb_array_elements(coalesce(s->'words', '[]')) WITH ORDINALITY o(w, n)) x
             WHERE weak AND (after_weak OR before_weak)) AS unsure
     FROM timelines t, jsonb_array_elements(t.timeline_json->'shots') s
     WHERE t.project_id = $1 AND t.version = $2
     ORDER BY (s->>'start')::float`, [projectId, version, WEAK_WORD_SCORE]);
  return rows.map(({ qa_failed, qa_failures, attempts, unsure, ...m }) => ({
    ...m,
    look: [
      ...(qa_failed ? [pictureProblem(qa_failures ?? [], attempts ?? 1)] : []),
      ...(unsure?.length ? [narrationProblem(unsure)] : []),
    ],
  }));
}

/** pipeline/qa.py's verdict on a still, in the studio's words. */
function pictureProblem(failures: string[], attempts: number): string {
  const f = failures.join(" ");
  const what = /hero_reference/.test(f) ? "copies the character reference instead of painting the scene"
    : /\(adjacent\)/.test(f) ? "looks almost the same as the shot next to it"
    : /too close/.test(f) ? "looks almost the same as another shot in the film"
    : /blurred/.test(f) ? "looks blurred"
    : /flat frame/.test(f) ? "looks empty"
    : /exposure/.test(f) ? "is too dark or too bright"
    : "did not pass its picture checks";
  return attempts > 1 ? `Even after ${attempts} tries, the picture ${what}.` : `The picture ${what}.`;
}

/** A run of words the aligner was unsure it heard: the narration may not say them. */
function narrationProblem(words: string[]): string {
  const shown = [...new Set(words.map((w) => w.toLowerCase()))].slice(0, 4);
  const list = shown.map((w) => `\u201c${w}\u201d`).join(", ");
  return `The narration is hard to make out around ${list}. Listen that it says what the script says.`;
}

export type EditJob = {
  id: string; state: string; error: string | null; created_at: Date;
  payload: { request: string; at: number | null; base_version: number };
};

/** The newest edit request, live or finished. */
export async function lastEdit(projectId: string): Promise<EditJob | null> {
  return one<EditJob>(
    "SELECT id, state, error, created_at, payload FROM jobs WHERE project_id = $1 AND kind = 'edit' " +
    "ORDER BY id DESC LIMIT 1", [projectId]);
}

export type Export = { state: string; film: string | null; size: number | null };

/** The download of one cut: done, being made, or never asked for. */
export async function exportOf(projectId: string, version: number): Promise<Export | null> {
  return one<Export>(
    `SELECT state, checkpoint->>'film' AS film, (checkpoint->>'size')::bigint AS size FROM jobs
     WHERE project_id = $1 AND kind = 'export' AND (payload->>'version')::int = $2
       AND state IN ('queued', 'running', 'done')
     ORDER BY id DESC LIMIT 1`, [projectId, version]);
}

/** "1:24", for the studio's words. */
export function timecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
