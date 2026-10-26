import "server-only";

import { one, query } from "./db";

/*
 * Publishing a cut to YouTube (pipeline/migrations/007_publish.sql). The
 * studio writes a publication and a job; the studio machine's light lane
 * uploads it (pipeline/worker.py publish_film). Google credentials never
 * reach this app: it only reads what the machine reported.
 */

export type Privacy = "private" | "unlisted" | "public";

export type Publication = {
  id: string;
  version: number;
  title: string;
  description: string;
  tags: string[];
  privacy: Privacy;
  thumbnail_shot: string | null;
  synthetic: boolean;
  made_for_kids: boolean;
  video_id: string | null;
  uploaded_at: Date | null;
  created_at: Date;
  by: string | null;
  youtube: {
    privacy?: Privacy; upload_status?: string; processing?: string; notes?: string[];
    channel_title?: string; session?: string;
    /** The shot whose still YouTube took as the thumbnail; null when it refused. */
    thumbnail?: string | null;
  };
  job: {
    id: string; state: string; error: string | null; attempts: number;
    progress: { stage?: string; done?: number; total?: number };
  } | null;
};

const PUB_SELECT = `
  SELECT p.id, p.version, p.title, p.description, p.tags, p.privacy, p.thumbnail_shot, p.synthetic,
            p.made_for_kids, p.video_id, p.uploaded_at, p.created_at, u.display_name AS by, p.youtube,
            (SELECT row_to_json(j) FROM (SELECT id, state, error, attempts, progress FROM jobs
               WHERE kind = 'publish' AND (payload->>'publication_id')::bigint = p.id
               ORDER BY id DESC LIMIT 1) j) AS job
     FROM publications p LEFT JOIN users u ON u.id = p.requested_by`;

/** The newest publication of a film, with the request that is uploading it. */
export async function latestPublication(projectId: string): Promise<Publication | null> {
  return one<Publication>(`${PUB_SELECT} WHERE p.project_id = $1 ORDER BY p.id DESC LIMIT 1`, [projectId]);
}

/** The newest publication that reached YouTube. */
export async function lastPosted(projectId: string): Promise<Publication | null> {
  return one<Publication>(
    `${PUB_SELECT} WHERE p.project_id = $1 AND p.video_id IS NOT NULL ORDER BY p.uploaded_at DESC LIMIT 1`, [projectId]);
}

/** Cuts of a film that are already on YouTube, with their videos. */
export async function postedCuts(projectId: string): Promise<{ version: number; video_id: string }[]> {
  return query(
    `SELECT DISTINCT ON (version) version, video_id FROM publications
     WHERE project_id = $1 AND video_id IS NOT NULL ORDER BY version, id DESC`, [projectId]);
}

export type Channel =
  | { state: "connected"; title: string; problem: string | null }
  | { state: "disconnected"; problem: string }
  /** No studio machine has said it can publish (its software predates Phase 6). */
  | { state: "unknown" };

/** The channel the studio machine publishes to, as it last reported it. */
export async function publishChannel(): Promise<Channel> {
  const row = await one<{ youtube: { channel?: { title: string } | null; problem?: string | null; connected?: boolean } | null }>(
    `SELECT health->'youtube' AS youtube FROM workers
     WHERE 'publish' = ANY(kinds) ORDER BY last_seen_at DESC LIMIT 1`);
  const yt = row?.youtube;
  if (!yt) return { state: "unknown" };
  if (yt.channel) return { state: "connected", title: yt.channel.title, problem: yt.problem ?? null };
  return { state: "disconnected", problem: yt.problem ?? "No YouTube channel is connected." };
}

/** Each shot of a cut and the beat it belongs to: the thumbnail picker's frames. */
export async function cutShots(projectId: string, version: number): Promise<{ id: string; beat: string; start: number; hash: string | null }[]> {
  return query(
    `SELECT s->>'shot_id' AS id, s->>'beat_id' AS beat, (s->>'start')::float AS start, s->'image'->>'hash' AS hash
     FROM timelines t, jsonb_array_elements(t.timeline_json->'shots') s
     WHERE t.project_id = $1 AND t.version = $2 ORDER BY (s->>'start')::float`, [projectId, version]);
}

/** The plain-words reason a publish stopped (pipeline/youtube.py Refused). */
export function explainPublishFailure(error: string | null): { text: string; retry: boolean } {
  const e = error ?? "";
  if (/midnight Pacific/.test(e)) {
    return { text: "YouTube's limit for today is reached, so nothing was uploaded. Try again tomorrow (after midnight Pacific time, which is when YouTube's day starts).", retry: true };
  }
  if (/connect/i.test(e) && /YouTube/.test(e)) {
    return { text: "The studio machine is no longer connected to the YouTube channel. Whoever looks after the machine needs to connect it again; then try again.", retry: true };
  }
  if (/< or >|title|description|tags/i.test(e) && /publish:/.test(e)) {
    return { text: `YouTube would not accept the details: ${e.replace(/^publish:\s*/, "")} Change them below and publish again.`, retry: false };
  }
  if (/YouTube 4\d\d/.test(e)) return { text: "YouTube refused the upload. Check the details below and publish again.", retry: false };
  return { text: "The upload was interrupted on the studio machine. Trying again carries on from where it stopped.", retry: true };
}
