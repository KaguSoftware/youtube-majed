"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { currentVersion, getCut } from "@/lib/cuts";
import { one, transaction } from "@/lib/db";
import { ring, warm } from "@/lib/doorbell";

import type { ActionState } from "./actions";

const LIVE = "state IN ('queued', 'running')";

/** Ask Claude for a change to the film as it is now. The edit is made on the
 *  current cut and becomes the next one (pipeline/editor.py). */
export async function requestEdit(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const request = String(form.get("request") ?? "").replace(/\s+/g, " ").trim();
  const atRaw = String(form.get("at") ?? "");
  const at = atRaw === "" ? null : Number(atRaw);
  if (request.length < 4) return { error: "Say what should change, for example: the mood at 1:24 doesn't match." };
  if (request.length > 1000) return { error: "Keep it to a few sentences; ask for one change at a time." };
  const base = await currentVersion(projectId);
  if (base === null) return { error: "There is no film to change yet." };
  const busy = await one<{ kind: string }>(
    `SELECT kind FROM jobs WHERE project_id = $1 AND kind IN ('production', 'edit') AND ${LIVE} LIMIT 1`, [projectId]);
  if (busy) return { error: busy.kind === "edit" ? "A change is already being made. Wait for it, or stop it." : "The film is being rendered again. Changes can be asked for once it is done." };
  try {
    await transaction(async (db) => {
      await db.query("INSERT INTO jobs (project_id, kind, payload, max_attempts) VALUES ($1, 'edit', $2, 2)", [projectId,
        JSON.stringify({ base_version: base, request, at: at !== null && Number.isFinite(at) ? Math.max(0, at) : null, requested_by: user.id })]);
      await db.query(
        "INSERT INTO project_events (project_id, kind, user_id, data) VALUES ($1, 'edit_requested', $2, $3)",
        [projectId, user.id, JSON.stringify({ request, at, base_version: base })]);
    });
  } catch (err) {
    if (String(err).includes("jobs_one_live_per_project")) return { error: "A change is already being made." };
    throw err;
  }
  await Promise.all([ring(), warm()]);
  revalidatePath(`/films/${projectId}`);
  return { ok: "asked" };
}

/** Make a cut the film. Undo is this, with the cut before. Free: every cut's
 *  chunks are already in the store. */
export async function chooseCut(projectId: string, version: number): Promise<void> {
  const user = await requireUser();
  const cut = await getCut(projectId, version);
  if (!cut) throw new Error("no such cut");
  await transaction(async (db) => {
    const live = await db.query(`SELECT 1 FROM jobs WHERE project_id = $1 AND kind = 'edit' AND ${LIVE}`, [projectId]);
    if (live.rowCount) throw new Error("A change is being made; choose a cut when it is done.");
    const { rows } = await db.query<{ from: number | null }>(
      "SELECT timeline_version AS from FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
    await db.query("UPDATE projects SET timeline_version = $2, updated_at = now() WHERE id = $1", [projectId, version]);
    await db.query(
      "INSERT INTO project_events (project_id, kind, user_id, data) VALUES ($1, 'cut_chosen', $2, $3)",
      [projectId, user.id, JSON.stringify({ from: rows[0]?.from ?? null, to: version })]);
  });
  revalidatePath(`/films/${projectId}`);
}

/** Stop a change being made. The worker sees its claim gone at the next
 *  heartbeat and abandons the edit; the film is untouched. */
export async function stopEdit(projectId: string): Promise<void> {
  const user = await requireUser();
  const { rowCount } = await transaction((db) => db.query(
    `UPDATE jobs SET state = 'cancelled', lease_token = NULL, finished_at = now()
     WHERE project_id = $1 AND kind = 'edit' AND ${LIVE}`, [projectId]));
  if (rowCount) {
    await one("INSERT INTO project_events (project_id, kind, user_id) VALUES ($1, 'edit_stopped', $2) RETURNING id",
      [projectId, user.id]);
  }
  revalidatePath(`/films/${projectId}`);
}

/** An mp4 of one cut, made on the studio machine and kept for download. */
export async function prepareDownload(projectId: string, version: number): Promise<void> {
  await requireUser();
  if (!(await getCut(projectId, version))) throw new Error("no such cut");
  await one(
    `INSERT INTO jobs (project_id, kind, payload)
     SELECT $1, 'export', $2 WHERE NOT EXISTS (
       SELECT 1 FROM jobs WHERE project_id = $1 AND kind = 'export' AND ${LIVE}) RETURNING id`,
    [projectId, JSON.stringify({ version })]);
  await Promise.all([ring(), warm()]);
  revalidatePath(`/films/${projectId}`);
}

/** The editing page is open: keep the studio machine listening closely. */
export async function keepWarm(): Promise<void> {
  await requireUser();
  await warm();
}
