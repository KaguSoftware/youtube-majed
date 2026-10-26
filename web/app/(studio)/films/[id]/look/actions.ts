"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState } from "@/app/(studio)/films/[id]/actions";
import { requireUser } from "@/lib/auth";
import { one, transaction } from "@/lib/db";
import { latestApproved } from "@/lib/documents";
import { ring } from "@/lib/doorbell";

/** Paint candidate looks: the hero beat on three fresh seeds, on the GPU lane. */
export async function paintLooks(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const presetId = String(form.get("preset") ?? "");
  const prefix = String(form.get("prompt_prefix") ?? "").replace(/\s+/g, " ").trim();
  const preset = await one<{ id: string; preset_json: { preset: string } }>(
    "SELECT id, preset_json FROM styles WHERE id = $1 AND is_library", [presetId]);
  if (!preset) return { error: "Choose a look to start from." };
  if (prefix.length < 10) return { error: "Describe the look in a few words, for example: dark oil painting, heavy impasto." };
  const p = await one<{ hero_beat: string | null }>("SELECT hero_beat FROM projects WHERE id = $1", [projectId]);
  const script = await latestApproved(projectId, "script");
  const beat = script?.parsed_json?.beats?.find((b) => b.id === (String(form.get("beat") || "") || p?.hero_beat));
  if (!beat) return { error: "The beat to paint is not in the approved script. Choose another." };
  const seeds = [0, 1, 2].map(() => randomInt(1, 2 ** 31 - 1));
  try {
    await transaction(async (db) => {
      await db.query("INSERT INTO jobs (project_id, kind, payload) VALUES ($1, 'style', $2)", [projectId, JSON.stringify({
        preset_id: preset.id, preset: preset.preset_json.preset, prompt_prefix: prefix.endsWith(",") ? prefix : `${prefix},`,
        beat_id: beat.id, visual: beat.visual, mood: beat.mood, seeds, requested_by: user.id,
        period: (script?.parsed_json?.meta?.period as string | undefined) ?? null,
        protagonist: (script?.parsed_json?.meta?.protagonist as string | undefined) ?? null,
        protagonist_look: (script?.parsed_json?.meta?.protagonist_look as string | undefined) ?? null,
      })]);
      await db.query("UPDATE projects SET state = 'style', hero_beat = $2, updated_at = now() WHERE id = $1", [projectId, beat.id]);
    });
  } catch (err) {
    if (String(err).includes("jobs_one_live_per_project")) return { error: "Looks are already being painted." };
    throw err;
  }
  await ring();
  revalidatePath(`/films/${projectId}/look`);
  return { ok: "Painting" };
}

/** Lock a candidate and its character crop as this film's look. */
export async function lockLook(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const runId = Number(form.get("run"));
  const index = Number(form.get("candidate"));
  const box = String(form.get("box") ?? "").split(",").map(Number);
  if (box.length !== 4 || box.some((v) => !Number.isFinite(v) || v < 0 || v > 1) ||
      box[2] - box[0] < 0.08 || box[3] - box[1] < 0.12) {
    return { error: "The crop is too small. Frame at least the character's head and shoulders." };
  }
  const run = await one<{ id: string; candidates_json: { seed: number; key: string }[]; preset_id: string;
    prompt_prefix: string; beat_id: string }>(
    "SELECT id, candidates_json, preset_id, prompt_prefix, beat_id FROM style_runs WHERE id = $1 AND project_id = $2",
    [runId, projectId]);
  const chosen = run?.candidates_json[index];
  if (!run || !chosen) return { error: "That candidate is no longer available. Pick one again." };
  const preset = await one<{ preset_json: { preset: string } }>("SELECT preset_json FROM styles WHERE id = $1", [run.preset_id]);
  const styleId = `sty_${projectId}_${run.id}_${index}`.slice(0, 120);
  const words = String(form.get("prompt_prefix") ?? "").replace(/\s+/g, " ").trim();
  if (words.length < 6) return { error: "Describe the look in a few words: its medium, line and colour." };
  const rounded = box.map((v) => Math.round(v * 1000) / 1000);
  await transaction(async (db) => {
    // hero_crop is left for the worker: it crops the frame to exactly this box
    // the first time the style is used (worker.materialize_crop).
    await db.query(
      "INSERT INTO styles (id, name, preset_json, is_library) VALUES ($1, $2, $3, false) " +
      "ON CONFLICT (id) DO UPDATE SET preset_json = EXCLUDED.preset_json",
      [styleId, `Look for ${projectId}`, JSON.stringify({
        preset: preset?.preset_json.preset ?? "custom", prompt_prefix: words, seed: chosen.seed,
        hero_full: chosen.key, crop_box: rounded, beat_id: run.beat_id,
      })]);
    await db.query("UPDATE projects SET style_id = $2, state = 'production', updated_at = now() WHERE id = $1",
      [projectId, styleId]);
    await db.query(
      "INSERT INTO project_events (project_id, kind, from_state, to_state, user_id, data) VALUES ($1, 'look_locked', 'style', 'production', $2, $3)",
      [projectId, user.id, JSON.stringify({ style_id: styleId, seed: chosen.seed, crop_box: rounded })]);
  });
  revalidatePath(`/films/${projectId}`);
  redirect(`/films/${projectId}`);
}

/** Shots for a film: ten a minute, as the Phase 1 slice measured (10 for 61s). */
function targetShots(seconds: number | null): number {
  return Math.max(6, Math.round(((seconds ?? 180) / 60) * 10));
}

/** Start the render on the pinned research, script and look. */
export async function renderFilm(projectId: string): Promise<ActionState> {
  const user = await requireUser();
  const p = await one<{ style_id: string | null; target_duration: number | null }>(
    "SELECT style_id, target_duration FROM projects WHERE id = $1", [projectId]);
  const [research, script] = await Promise.all([latestApproved(projectId, "research"), latestApproved(projectId, "script")]);
  if (!p?.style_id || !research || !script) return { error: "The research, the script and the look must all be approved first." };
  if (script.upstream_hash && script.upstream_hash !== research.content_sha) {
    return { error: "The research changed after the script was written. Review the script again before rendering." };
  }
  try {
    await transaction(async (db) => {
      await db.query("INSERT INTO jobs (project_id, kind, payload) VALUES ($1, 'production', $2)", [projectId, JSON.stringify({
        research_id: Number(research.id), script_id: Number(script.id), style_id: p.style_id,
        target_shots: targetShots(p.target_duration), requested_by: user.id,
      })]);
      await db.query("UPDATE projects SET state = 'production', updated_at = now() WHERE id = $1", [projectId]);
      await db.query("INSERT INTO project_events (project_id, kind, to_state, user_id) VALUES ($1, 'render_started', 'production', $2)",
        [projectId, user.id]);
    });
  } catch (err) {
    if (String(err).includes("jobs_one_live_per_project")) return { error: "This film is already rendering." };
    throw err;
  }
  await ring();
  revalidatePath(`/films/${projectId}`);
  redirect(`/films/${projectId}`);
}

/** Stop a render. The worker sees its lease token gone at the next heartbeat
 *  and stops after the current frame; every finished frame stays cached, so
 *  rendering again picks up where this left off. */
export async function stopRender(projectId: string): Promise<void> {
  const user = await requireUser();
  await transaction(async (db) => {
    const { rowCount } = await db.query(
      "UPDATE jobs SET state = 'cancelled', lease_token = NULL, finished_at = now() " +
      "WHERE project_id = $1 AND kind = 'production' AND state IN ('queued', 'running')", [projectId]);
    if (rowCount) {
      await db.query("INSERT INTO project_events (project_id, kind, user_id) VALUES ($1, 'render_stopped', $2)",
        [projectId, user.id]);
    }
  });
  revalidatePath(`/films/${projectId}`);
}

