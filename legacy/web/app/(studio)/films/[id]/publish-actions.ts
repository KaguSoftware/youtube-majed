"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { currentVersion } from "@/lib/cuts";
import { one, transaction } from "@/lib/db";
import { ring } from "@/lib/doorbell";
import { checkPublication } from "@/lib/pipeline";
import { postedCuts } from "@/lib/publications";

const LIVE = "state IN ('queued', 'running')";
const PRIVACY = new Set(["private", "unlisted", "public"]);

export type PublishState = { errors?: string[]; again?: boolean; ok?: boolean };

function tags(raw: string): string[] {
  // pipeline/publish.py clean_tags, so the form shows what will be sent.
  const seen = new Set<string>();
  return raw.split(",").map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => {
    const k = t.toLowerCase();
    if (!t || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Publish the film (the cut it is now) to the studio's YouTube channel.
 *  The upload runs on the studio machine; this writes what it is to say. */
export async function publishFilm(projectId: string, _prev: PublishState, form: FormData): Promise<PublishState> {
  const user = await requireUser();
  const version = await currentVersion(projectId);
  if (version === null) return { errors: ["There is no film to publish yet."] };
  const meta = {
    title: String(form.get("title") ?? "").replace(/\s+/g, " ").trim(),
    description: String(form.get("description") ?? "").replace(/\r\n/g, "\n").trim(),
    tags: tags(String(form.get("tags") ?? "")),
    privacy: String(form.get("privacy") ?? ""),
  };
  if (!PRIVACY.has(meta.privacy)) return { errors: ["Choose who can see the film."] };
  const errors = await checkPublication(meta);
  if (errors.length) return { errors };
  const thumb = String(form.get("thumbnail") ?? "") || null;
  const synthetic = form.get("synthetic") === "on";
  const kids = form.get("made_for_kids") === "yes";
  if (!["yes", "no"].includes(String(form.get("made_for_kids")))) {
    return { errors: ["Say whether the film is made for children. It is a legal declaration YouTube requires."] };
  }
  const posted = (await postedCuts(projectId)).find((c) => c.version === version);
  if (posted && form.get("again") !== "yes") return { again: true };

  try {
    await transaction(async (db) => {
      const busy = await db.query(`SELECT 1 FROM jobs WHERE project_id = $1 AND kind IN ('production', 'edit') AND ${LIVE}`, [projectId]);
      if (busy.rowCount) throw new Error("busy");
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO publications (project_id, version, title, description, tags, privacy, thumbnail_shot,
           synthetic, made_for_kids, requested_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [projectId, version, meta.title, meta.description, meta.tags, meta.privacy, thumb, synthetic, kids, user.id]);
      const pub = rows[0].id;
      const job = await db.query<{ id: string }>(
        "INSERT INTO jobs (project_id, kind, payload, max_attempts) VALUES ($1, 'publish', $2, 3) RETURNING id",
        [projectId, JSON.stringify({ publication_id: Number(pub), requested_by: user.id })]);
      await db.query("UPDATE publications SET job_id = $2 WHERE id = $1", [pub, job.rows[0].id]);
      // Posted stays posted: a second upload failing does not take the first one down.
      await db.query("UPDATE projects SET state = CASE WHEN state = 'posted' THEN state ELSE 'finalized' END, " +
        "updated_at = now() WHERE id = $1", [projectId]);
      await db.query(
        "INSERT INTO project_events (project_id, kind, from_state, to_state, user_id, data) " +
        "VALUES ($1, 'publish_requested', 'editing', 'finalized', $2, $3)",
        [projectId, user.id, JSON.stringify({ publication_id: Number(pub), version, privacy: meta.privacy,
          synthetic, made_for_kids: kids, again: !!posted })]);
    });
  } catch (err) {
    if (String(err).includes("jobs_one_live_per_project")) return { errors: ["The film is already being published."] };
    if (String(err).includes("busy")) return { errors: ["The film is being changed. Publish it once the change is made."] };
    throw err;
  }
  await ring();
  revalidatePath(`/films/${projectId}`);
  return { ok: true };
}

/** Try a stopped publish again, as it was. The studio machine carries on
 *  the same upload where YouTube still has it (pipeline/youtube.py). */
export async function retryPublish(projectId: string, publicationId: string): Promise<void> {
  const user = await requireUser();
  const pub = await one<{ video_id: string | null }>(
    "SELECT video_id FROM publications WHERE id = $1 AND project_id = $2", [publicationId, projectId]);
  if (!pub) throw new Error("no such publication");
  try {
    await transaction(async (db) => {
      await db.query("INSERT INTO jobs (project_id, kind, payload, max_attempts) VALUES ($1, 'publish', $2, 3)",
        [projectId, JSON.stringify({ publication_id: Number(publicationId), requested_by: user.id })]);
      await db.query(
        "INSERT INTO project_events (project_id, kind, user_id, data) VALUES ($1, 'publish_retried', $2, $3)",
        [projectId, user.id, JSON.stringify({ publication_id: Number(publicationId) })]);
    });
  } catch (err) {
    if (!String(err).includes("jobs_one_live_per_project")) throw err;
  }
  await ring();
  revalidatePath(`/films/${projectId}`);
}

/** Stop an upload. Nothing reaches YouTube that was not already there;
 *  trying again later resumes rather than starting over. */
export async function stopPublish(projectId: string): Promise<void> {
  const user = await requireUser();
  const { rowCount } = await transaction((db) => db.query(
    `UPDATE jobs SET state = 'cancelled', lease_token = NULL, finished_at = now()
     WHERE project_id = $1 AND kind = 'publish' AND ${LIVE}`, [projectId]));
  if (rowCount) {
    await one("INSERT INTO project_events (project_id, kind, user_id) VALUES ($1, 'publish_stopped', $2) RETURNING id",
      [projectId, user.id]);
  }
  revalidatePath(`/films/${projectId}`);
}
