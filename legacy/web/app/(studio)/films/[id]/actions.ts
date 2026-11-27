"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { one, transaction } from "@/lib/db";
import { latestApproved, researchUpstream, textSha, type DocKind } from "@/lib/documents";
import { ring } from "@/lib/doorbell";
import { isNarrative } from "@/lib/narratives";
import { checkDocument } from "@/lib/pipeline";

const STATE_FOR: Record<DocKind, string> = { research: "staging", script: "scripting" };
const NEXT_STATE: Record<DocKind, string> = { research: "scripting", script: "style" };
const NOUN: Record<DocKind, string> = { research: "research", script: "script" };

async function project(id: string) {
  const p = await one<{ id: string; topic: string; angle: string | null; narrative: string | null; state: string }>(
    "SELECT id, topic, angle, narrative, state FROM projects WHERE id = $1", [id]);
  if (!p) throw new Error("no such film");
  return p;
}

export type ActionState = { error?: string; ok?: string };

/** Ask Claude (on the studio machine's light lane) to write a document. */
export async function askClaude(projectId: string, kind: DocKind, _prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const p = await project(projectId);
  const note = String(form.get("note") ?? "").trim().slice(0, 2000) || undefined;
  // The script form asks every time; research is told the film's choice.
  const narrative = kind === "script" ? String(form.get("narrative") ?? "") : p.narrative;
  if (kind === "script" && !isNarrative(narrative)) {
    return { error: "Choose how the film is told before Claude writes the script." };
  }
  // Pinned in the job, so changing the choice later cannot alter a script being written.
  const payload: Record<string, unknown> = { verify_sources: true, requested_by: user.id, note, narrative };
  if (kind === "script") {
    const research = await latestApproved(projectId, "research");
    if (!research) return { error: "Approve the research first: the script is written from it." };
    payload.research_id = Number(research.id);
  }
  try {
    await transaction(async (db) => {
      await db.query("INSERT INTO jobs (project_id, kind, payload) VALUES ($1, $2, $3)",
        [projectId, kind, JSON.stringify(payload)]);
      await db.query("UPDATE projects SET state = $2, narrative = $3, updated_at = now() WHERE id = $1",
        [projectId, STATE_FOR[kind], narrative]);
      await db.query(
        "INSERT INTO project_events (project_id, kind, to_state, user_id, data) VALUES ($1, 'asked_claude', $2, $3, $4)",
        [projectId, STATE_FOR[kind], user.id, JSON.stringify({ document: kind, note: note ?? null, narrative })]);
    });
  } catch (err) {
    if (String(err).includes("jobs_one_live_per_project")) {
      return { error: `Claude is already writing the ${NOUN[kind]}.` };
    }
    throw err;
  }
  await ring();
  revalidatePath(`/films/${projectId}`);
  redirect(`/films/${projectId}/${kind}`);
}

/** Stop Claude. The worker sees its lease token gone at the next heartbeat
 *  and kills the run without writing anything. */
export async function stopClaude(projectId: string, kind: DocKind): Promise<void> {
  const user = await requireUser();
  await transaction(async (db) => {
    const { rowCount } = await db.query(
      "UPDATE jobs SET state = 'cancelled', lease_token = NULL, finished_at = now() " +
      "WHERE project_id = $1 AND kind = $2 AND state IN ('queued', 'running')", [projectId, kind]);
    if (rowCount) {
      await db.query(
        "INSERT INTO project_events (project_id, kind, user_id, data) VALUES ($1, 'stopped_claude', $2, $3)",
        [projectId, user.id, JSON.stringify({ document: kind })]);
    }
  });
  revalidatePath(`/films/${projectId}/${kind}`);
}

/** A pasted document: validated by the pipeline's own checks, then stored as
 *  the next version exactly as a Claude-written one would be. */
export async function pasteDocument(projectId: string, kind: DocKind, _prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const p = await project(projectId);
  const markdown = String(form.get("markdown") ?? "").replace(/\r\n/g, "\n").trim() + "\n";
  if (markdown.trim().length < 20) return { error: `Paste the whole ${NOUN[kind]} document, front matter included.` };
  let researchMarkdown: string | undefined;
  let upstream: string;
  if (kind === "script") {
    const research = await latestApproved(projectId, "research");
    if (!research) return { error: "Approve the research first: the script's citations are checked against it." };
    researchMarkdown = research.markdown_raw;
    upstream = research.content_sha;
  } else {
    upstream = researchUpstream(p.topic, p.angle);
  }
  const verdict = await checkDocument(kind, markdown, { researchMarkdown, verifySources: kind === "research" });
  await transaction(async (db) => {
    await db.query("SELECT 1 FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
    const { rows } = await db.query<{ v: number }>(
      "SELECT coalesce(max(version), 0) + 1 AS v FROM artifacts WHERE project_id = $1 AND kind = $2",
      [projectId, kind]);
    await db.query(
      "INSERT INTO artifacts (project_id, kind, version, markdown_raw, content_sha, parsed_json, doc_status, " +
      " upstream_hash, validator_report, source, created_by) " +
      "VALUES ($1, $2, $3, $4, $10, $5, $6, $7, $8, 'paste', $9)",
      [projectId, kind, rows[0].v, markdown, JSON.stringify(verdict.parsed), verdict.doc_status, upstream,
        JSON.stringify({ errors: verdict.errors, warnings: verdict.warnings, sources_checked: verdict.sources_checked }), user.id,
        // pipeline/timeline.py text_sha, so pasted and written versions hash alike.
        textSha(markdown)]);
    await db.query("UPDATE projects SET state = $2, updated_at = now() WHERE id = $1 AND state IN ('idea', $2)",
      [projectId, STATE_FOR[kind]]);
  });
  revalidatePath(`/films/${projectId}`);
  redirect(`/films/${projectId}/${kind}`);
}

/** Approve a version, or approve it anyway past its validator errors. The
 *  override is recorded with the exact errors overridden and who did it. */
export async function approve(projectId: string, kind: DocKind, _prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const artifactId = Number(form.get("artifact"));
  const anyway = form.get("anyway") === "yes";
  const heroBeat = String(form.get("hero_beat") ?? "") || null;
  const art = await one<{ id: string; doc_status: string; validator_report: { errors?: string[] } | null }>(
    "SELECT id, doc_status, validator_report FROM artifacts WHERE id = $1 AND project_id = $2 AND kind = $3",
    [artifactId, projectId, kind]);
  if (!art) return { error: "That version no longer exists." };
  const errors = art.validator_report?.errors ?? [];
  if (art.doc_status === "invalid" && !anyway) {
    return { error: "This version has problems. Fix them, or confirm you are approving it anyway." };
  }
  if (kind === "script" && !heroBeat) return { error: "Choose the beat the look will be tested on." };
  const override = art.doc_status === "invalid"
    ? { by: user.displayName, user_id: user.id, at: new Date().toISOString(), errors } : null;
  await transaction(async (db) => {
    await db.query(
      "UPDATE artifacts SET doc_status = 'approved', approved_at = now(), approved_by = $2, override = $3 WHERE id = $1",
      [artifactId, user.id, override ? JSON.stringify(override) : null]);
    await db.query(
      "UPDATE projects SET state = $2, updated_at = now()" + (kind === "script" ? ", hero_beat = $3" : "") + " WHERE id = $1",
      kind === "script" ? [projectId, NEXT_STATE[kind], heroBeat] : [projectId, NEXT_STATE[kind]]);
    await db.query(
      "INSERT INTO project_events (project_id, kind, from_state, to_state, user_id, data) " +
      "VALUES ($1, $2, $3, $4, $5, $6)",
      [projectId, override ? "approved_anyway" : "approved", STATE_FOR[kind], NEXT_STATE[kind], user.id,
        JSON.stringify({ document: kind, artifact_id: artifactId, overrode: errors.length ? errors : undefined })]);
  });
  revalidatePath(`/films/${projectId}`);
  redirect(`/films/${projectId}`);
}

/** Demote: back to research or script, with a reason. Nothing is deleted;
 *  later documents stay and show as stale until reviewed again. */
export async function demote(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const to = String(form.get("to"));
  const reason = String(form.get("reason") ?? "").trim();
  if (to !== "staging" && to !== "scripting") return { error: "Choose where to go back to." };
  if (reason.length < 3) return { error: "Say why, in a few words. It goes in the film's history." };
  const p = await project(projectId);
  await transaction(async (db) => {
    await db.query("UPDATE projects SET state = $2, updated_at = now() WHERE id = $1", [projectId, to]);
    await db.query(
      "INSERT INTO project_events (project_id, kind, from_state, to_state, reason, user_id) VALUES ($1, 'demoted', $2, $3, $4, $5)",
      [projectId, p.state, to, reason.slice(0, 1000), user.id]);
  });
  revalidatePath(`/films/${projectId}`);
  redirect(`/films/${projectId}/${to === "staging" ? "research" : "script"}`);
}
