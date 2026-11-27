import "server-only";

import { createHash } from "node:crypto";

import { one, query } from "./db";

export type DocKind = "research" | "script";

export type Claim = { id: string; claim: string; source: string };
export type Beat = {
  id: string; title: string; narration: string; visual: string; mood: string;
  cites: string[]; tone: boolean;
};

export type DocVersion = {
  id: string;
  kind: DocKind;
  version: number;
  doc_status: "awaiting" | "invalid" | "valid" | "approved";
  source: "paste" | "claude" | "seed";
  markdown_raw: string;
  content_sha: string;
  upstream_hash: string | null;
  parsed_json: { meta?: Record<string, unknown>; claims?: Claim[]; beats?: Beat[] } | null;
  validator_report: { errors?: string[]; warnings?: string[]; sources_checked?: number | null } | null;
  override: { by: string; at: string; errors: string[] } | null;
  created_at: Date;
  approved_at: Date | null;
  created_by_name: string | null;
  approved_by_name: string | null;
};

const SELECT = `
  SELECT a.id, a.kind, a.version, a.doc_status, a.source, a.markdown_raw, a.content_sha,
         a.upstream_hash, a.parsed_json, a.validator_report, a.override, a.created_at,
         a.approved_at, cu.display_name AS created_by_name, au.display_name AS approved_by_name
  FROM artifacts a
  LEFT JOIN users cu ON cu.id = a.created_by
  LEFT JOIN users au ON au.id = a.approved_by`;

export async function versions(projectId: string, kind: DocKind): Promise<DocVersion[]> {
  return query<DocVersion>(`${SELECT} WHERE a.project_id = $1 AND a.kind = $2 ORDER BY a.version DESC`,
    [projectId, kind]);
}

export async function latestApproved(projectId: string, kind: DocKind): Promise<DocVersion | null> {
  return one<DocVersion>(
    `${SELECT} WHERE a.project_id = $1 AND a.kind = $2 AND a.doc_status = 'approved' ORDER BY a.version DESC LIMIT 1`,
    [projectId, kind]);
}

export type WritingJob = {
  id: string; state: string; error: string | null; created_at: Date; started_at: Date | null;
  finished_at: Date | null; progress: { stage?: string };
};

/** The newest Claude job for this document, live or not. */
export async function lastWriting(projectId: string, kind: DocKind): Promise<WritingJob | null> {
  return one<WritingJob>(
    "SELECT id, state, error, created_at, started_at, finished_at, progress FROM jobs " +
    "WHERE project_id = $1 AND kind = $2 ORDER BY id DESC LIMIT 1", [projectId, kind]);
}

/** pipeline/timeline.py text_sha: sha256 hex, first 16. */
export function textSha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** DESIGN.md "Staleness": research.md <- hash(topic, angle). Same string the
 *  worker hashes (worker.write_document). */
export function researchUpstream(topic: string, angle: string | null): string {
  return textSha(`${topic}\n${angle ?? ""}`);
}

/** Validator messages that belong to one claim or beat ("c3: ...", "B02, B05: ...")
 *  are shown next to it; the rest at the top of the document. */
export function splitReport(messages: string[] = []): { general: string[]; byItem: Record<string, string[]> } {
  const general: string[] = [];
  const byItem: Record<string, string[]> = {};
  for (const m of messages) {
    const match = /^((?:[cB]\d+)(?:,\s*[cB]\d+)*):\s*([\s\S]*)$/.exec(m);
    if (!match) { general.push(m); continue; }
    for (const id of match[1].split(/,\s*/)) (byItem[id] ??= []).push(match[2]);
  }
  return { general, byItem };
}
