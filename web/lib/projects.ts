import "server-only";

import { one, query } from "./db";

type Doc = { version: number; doc_status: "awaiting" | "invalid" | "valid" | "approved"; source: string };
type Job = {
  id: string; kind: string; state: string; error: string | null;
  progress: { stage?: string; done?: number; total?: number };
};
export type Sheet = { key: string; cols: number; rows: number; thumb: [number, number]; shots: string[] };

export type ProjectRow = {
  id: string;
  topic: string;
  angle: string | null;
  narrative: string | null;
  target_duration: number | null;
  state: string;
  hero_beat: string | null;
  created_at: Date;
  activity_at: Date;
  research: Doc | null;
  script: Doc | null;
  job: Job | null;
  sheet: Sheet | null;
};

const PROJECT_SELECT = `
  SELECT p.id, p.topic, p.angle, p.narrative, p.target_duration, p.state, p.hero_beat, p.created_at,
    (SELECT row_to_json(a) FROM (SELECT version, doc_status, source FROM artifacts
       WHERE project_id = p.id AND kind = 'research' ORDER BY version DESC LIMIT 1) a) AS research,
    (SELECT row_to_json(a) FROM (SELECT version, doc_status, source FROM artifacts
       WHERE project_id = p.id AND kind = 'script' ORDER BY version DESC LIMIT 1) a) AS script,
    (SELECT row_to_json(j) FROM (SELECT id, kind, state, error, progress FROM jobs
       WHERE project_id = p.id ORDER BY id DESC LIMIT 1) j) AS job,
    (SELECT timeline_json->'media'->'sheet' FROM timelines
       WHERE project_id = p.id ORDER BY (version = p.timeline_version) DESC, version DESC LIMIT 1) AS sheet,
    GREATEST(p.updated_at,
      (SELECT max(created_at) FROM artifacts WHERE project_id = p.id),
      (SELECT max(e.at) FROM job_events e JOIN jobs j ON j.id = e.job_id WHERE j.project_id = p.id)
    ) AS activity_at
  FROM projects p`;

export async function listProjects(): Promise<ProjectRow[]> {
  return query<ProjectRow>(`${PROJECT_SELECT} ORDER BY activity_at DESC NULLS LAST, p.created_at DESC LIMIT 200`);
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  return one<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = $1`, [id]);
}

export type NextStep = {
  text: string;
  /** who the project is waiting on: the user, the machine, a problem, or nobody */
  tone: "you" | "machine" | "problem" | "done";
};

const LIVE = new Set(["queued", "running"]);

/** What the project needs next, in the studio's words (web/PRODUCT.md:
 *  never "job", "artifact" or "worker" in front of the user). */
export function nextStep(p: ProjectRow): NextStep {
  const job = p.job;
  if (job && LIVE.has(job.state)) {
    if (job.state === "queued") return { text: "Waiting for the studio machine", tone: "machine" };
    switch (job.kind) {
      case "research": return { text: "Researching your topic", tone: "machine" };
      case "script": return { text: "Writing the script", tone: "machine" };
      case "style": return { text: "Painting three looks", tone: "machine" };
      case "edit": return { text: "Making a change", tone: "machine" };
      case "export": return { text: "Preparing a download", tone: "machine" };
      case "publish": {
        const { stage, done, total } = job.progress ?? {};
        if (stage === "uploading" && total) return { text: `Uploading to YouTube, ${Math.floor((100 * (done ?? 0)) / total)}%`, tone: "machine" };
        return { text: "Publishing to YouTube", tone: "machine" };
      }
      default: {
        const { stage, done, total } = job.progress ?? {};
        if (stage === "images" && total) return { text: `Rendering, frame ${done ?? 0} of ${total}`, tone: "machine" };
        if (stage === "render") return { text: "Assembling the film", tone: "machine" };
        return { text: "Recording the narration", tone: "machine" };
      }
    }
  }
  const failedHere = job?.state === "failed" && (
    (job.kind === "production" && p.state === "production") ||
    (job.kind === "style" && p.state === "style") ||
    (job.kind === "research" && p.state === "staging") ||
    (job.kind === "script" && p.state === "scripting") ||
    (job.kind === "publish" && p.state === "finalized"));
  if (failedHere) {
    return { text: job.kind === "publish" ? "Not published. See what happened" : "Stopped with a problem. See what happened", tone: "problem" };
  }

  const doc = (d: Doc | null, noun: string): NextStep => {
    if (!d) return { text: `Add the ${noun}`, tone: "you" };
    if (d.doc_status === "invalid") return { text: `The ${noun} needs fixes`, tone: "problem" };
    return { text: `The ${noun} is ready for your review`, tone: "you" };
  };
  switch (p.state) {
    case "idea": return { text: "Start the research", tone: "you" };
    case "staging": return doc(p.research, "research");
    case "scripting": return doc(p.script, "script");
    case "style": return { text: "Choose the look", tone: "you" };
    case "production": return { text: "Ready to render", tone: "you" };
    case "posted": return { text: "On YouTube", tone: "done" };
    default: return { text: "Film ready to watch", tone: "done" };
  }
}
