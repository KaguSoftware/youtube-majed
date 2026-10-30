import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";

import { env } from "./env";

/*
 * The pipeline's Python (pipeline/webapi.py): validation and prompts, from the
 * same code the worker runs. On Vercel it is the Python function at
 * /api/pipeline; in local development (`next dev` has no Python runtime) the
 * repo's own interpreter runs `python -m pipeline.webapi`.
 */

export type Verdict = {
  doc_status: "valid" | "invalid";
  errors: string[];
  warnings: string[];
  parsed: Record<string, unknown> | null;
  sources_checked: number | null;
};

type Request =
  | { action: "check"; kind: "research" | "script"; markdown: string; research_markdown?: string; verify_sources?: boolean }
  | { action: "prompt"; kind: "research" | "script"; project: Record<string, unknown>; research_markdown?: string; note?: string }
  | { action: "publish_draft"; project: { topic: string; angle: string | null }; research_markdown?: string; credits?: string[] }
  | { action: "publish_check"; meta: { title: string; description: string; tags: string[]; privacy: string } };

async function viaFunction(req: Request): Promise<unknown> {
  // Same deployment: production uses its stable domain; a preview its own URL,
  // with the automation bypass so preview protection does not refuse us.
  const host = process.env.VERCEL_ENV === "production"
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL
    : process.env.VERCEL_URL;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-internal-key": env("INTERNAL_API_KEY"),
  };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  const res = await fetch(`https://${host}/api/pipeline`, {
    method: "POST", headers, body: JSON.stringify(req), cache: "no-store",
    signal: AbortSignal.timeout(50_000),
  });
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(`pipeline function: ${body.error ?? res.status}`);
  return body;
}

function viaLocalPython(req: Request): Promise<unknown> {
  // Development only (never on Vercel). The ignore comments stop the bundler
  // from tracing the whole repository into the server bundle because of this
  // filesystem access.
  const repo = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
  const python = process.env.PIPELINE_PYTHON ?? path.join(/*turbopackIgnore: true*/ repo, ".venv", "bin", "python");
  return new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ python, ["-m", "pipeline.webapi"], { cwd: repo, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const body = JSON.parse(out);
        if (code !== 0 || body.error) reject(new Error(body.error ?? err));
        else resolve(body);
      } catch {
        reject(new Error(`python -m pipeline.webapi exited ${code}: ${err.slice(-400)}`));
      }
    });
    child.stdin.end(JSON.stringify(req));
  });
}

function call(req: Request): Promise<unknown> {
  return process.env.VERCEL ? viaFunction(req) : viaLocalPython(req);
}

export async function checkDocument(
  kind: "research" | "script", markdown: string,
  opts: { researchMarkdown?: string; verifySources?: boolean } = {},
): Promise<Verdict> {
  return (await call({
    action: "check", kind, markdown,
    research_markdown: opts.researchMarkdown, verify_sources: opts.verifySources,
  })) as Verdict;
}

export async function buildPrompt(
  kind: "research" | "script", project: Record<string, unknown>,
  opts: { researchMarkdown?: string; note?: string } = {},
): Promise<{ system: string; prompt: string }> {
  return (await call({
    action: "prompt", kind, project, research_markdown: opts.researchMarkdown, note: opts.note,
  })) as { system: string; prompt: string };
}

export type PublishDraft = { title: string; description: string; tags: string[]; sources: number };

/** A first title and description for the publish form (pipeline/publish.py
 *  draft). `credits`: what the cut's sound effects' licences ask it to say. */
export async function publishDraft(project: { topic: string; angle: string | null }, researchMarkdown?: string,
  credits: string[] = []): Promise<PublishDraft> {
  return (await call({ action: "publish_draft", project, research_markdown: researchMarkdown, credits })) as PublishDraft;
}

/** Everything YouTube would refuse, judged by the code the worker runs before it uploads. */
export async function checkPublication(meta: { title: string; description: string; tags: string[]; privacy: string }): Promise<string[]> {
  return ((await call({ action: "publish_check", meta })) as { errors: string[] }).errors;
}
