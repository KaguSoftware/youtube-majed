/**
 * One headless Claude Code run: `claude -p` inside engine/, structured output
 * via `--json-schema`. Ported from legacy/pipeline/writer.py (`run_claude`,
 * `parse_result`): timeout, error parsing and usage, adapted to schemas.
 *
 * Runs on Majed's Claude subscription, never the API: ANTHROPIC_API_KEY and
 * ANTHROPIC_AUTH_TOKEN are removed from the child's environment, so the CLI
 * falls back to its own sign-in (the keychain). Not `--bare`: bare mode skips
 * the keychain, which is where a subscription sign-in lives.
 *
 * Only engine/CLAUDE.md is loaded: the repo's and the user's CLAUDE.md
 * (rules for developing Studio, git authorship) are excluded with
 * `claudeMdExcludes`, user settings, plugins and MCP servers are skipped
 * (`--setting-sources project`, `--strict-mcp-config`), and no session is
 * saved.
 *
 * Failures split three ways, as in v1:
 * - ClaudeGate: Claude declined (usage limit, sign-in). Retrying soon repeats it.
 * - OutputError: Claude ran but the output failed zod. Worth one retry with the errors.
 * - ClaudeError: crash, timeout, unparseable output.
 */
import { ENGINE_DIR, REPO_DIR } from "@studio/project";
import type { StepName } from "@studio/schema";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export class ClaudeGate extends Error {
  override name = "ClaudeGate";
}
export class ClaudeError extends Error {
  override name = "ClaudeError";
}
export class OutputError extends Error {
  override name = "OutputError";
  constructor(
    message: string,
    readonly errors: string[],
  ) {
    super(message);
  }
}

/** The CLI to run. Tests point this at worker/fake/claude.mjs. */
export const claudeBin = () => process.env.STUDIO_CLAUDE_BIN ?? "claude";

/** Model per step: STUDIO_CLAUDE_MODEL_<STEP> overrides STUDIO_CLAUDE_MODEL, which defaults to sonnet. */
export function modelFor(step: StepName): string {
  return process.env[`STUDIO_CLAUDE_MODEL_${step.toUpperCase()}`] ?? process.env.STUDIO_CLAUDE_MODEL ?? "sonnet";
}

/**
 * Effort per step: STUDIO_CLAUDE_EFFORT_<STEP> overrides STUDIO_CLAUDE_EFFORT; unset means the
 * CLI's default. An option, not a default: e.g. STUDIO_CLAUDE_EFFORT_NARRATION=medium if the
 * narration step's thinking (most of its ~41k output tokens at Gate 2) costs too much.
 */
export function effortFor(step: StepName): string | undefined {
  return process.env[`STUDIO_CLAUDE_EFFORT_${step.toUpperCase()}`] ?? process.env.STUDIO_CLAUDE_EFFORT;
}

/** Long enough for an 8-minute script or a web-searched fact check, short enough to notice a hang. */
export const TIMEOUT_MS: Record<StepName, number> = {
  options: 8 * 60_000,
  loopmap: 10 * 60_000,
  narration: 20 * 60_000,
  rewrite: 8 * 60_000,
  factcheck: 25 * 60_000,
  critic: 12 * 60_000,
  cast: 8 * 60_000,
  storyboard: 15 * 60_000,
  regenerate: 6 * 60_000,
  beat: 6 * 60_000,
  fixscenes: 10 * 60_000,
  reelcut: 10 * 60_000,
};

/** The fields of `--output-format json` we use. Everything else passes through. */
const CliResult = z.looseObject({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  api_error_status: z.number().nullable().optional(),
  num_turns: z.number().default(0),
  duration_ms: z.number().default(0),
  duration_api_ms: z.number().default(0),
  total_cost_usd: z.number().nullable().optional(),
  session_id: z.string().optional(),
  usage: z
    .looseObject({
      input_tokens: z.number().default(0),
      output_tokens: z.number().default(0),
      cache_read_input_tokens: z.number().default(0),
      cache_creation_input_tokens: z.number().default(0),
      server_tool_use: z.looseObject({ web_search_requests: z.number().default(0) }).optional(),
    })
    .optional(),
  modelUsage: z.record(z.string(), z.looseObject({})).optional(),
});
export type CliResult = z.infer<typeof CliResult>;

export type RunOptions = {
  step: StepName;
  /** The prompt, sent on stdin: `/<skill> …`. */
  prompt: string;
  /** JSON Schema text (engine/schemas/<step>.json). */
  schema: string;
  /** Built-in tools to allow, e.g. ["WebSearch", "WebFetch"]. None by default. */
  tools?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type RunResult = { output: unknown; cli: CliResult; model: string; argv: string[] };

/** The child's environment: no API key (subscription only), no markers of a parent Claude Code session. */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === "ANTHROPIC_API_KEY" || k === "ANTHROPIC_AUTH_TOKEN") continue;
    if (k === "CLAUDECODE" || k === "CLAUDE_PID" || k === "CLAUDE_EFFORT" || k === "CLAUDE_AGENT_SDK_VERSION") continue;
    if (k.startsWith("CLAUDE_CODE_") && k !== "CLAUDE_CODE_OAUTH_TOKEN") continue;
    out[k] = v;
  }
  return out;
}

export function buildArgv(o: RunOptions, model: string): string[] {
  const settings = { claudeMdExcludes: [join(REPO_DIR, "CLAUDE.md"), join(homedir(), ".claude", "CLAUDE.md")] };
  const tools = o.tools ?? [];
  const argv = [
    "-p",
    "--model", model,
    "--output-format", "json",
    "--json-schema", o.schema,
    "--setting-sources", "project",
    "--settings", JSON.stringify(settings),
    "--strict-mcp-config",
    "--no-session-persistence",
    "--tools", tools.join(","),
  ];
  if (tools.length) argv.push("--allowedTools", ...tools);
  const effort = effortFor(o.step);
  if (effort) argv.push("--effort", effort);
  return argv;
}

/** The CLI's JSON result, or the reason there is none (legacy parse_result). */
export function parseResult(stdout: string, stderr: string, code: number | null): CliResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    const tail = (stderr || stdout).trim().slice(-600);
    if (/limit|quota|rate|log ?in|auth|credit/i.test(tail)) throw new ClaudeGate(`Claude did not run: ${tail}`);
    throw new ClaudeError(`claude -p exited ${code} without a result: ${tail || "(no output)"}`);
  }
  const parsed = CliResult.safeParse(raw);
  if (!parsed.success) throw new ClaudeError(`claude -p printed JSON that is not a result: ${stdout.slice(0, 300)}`);
  const result = parsed.data;
  if (result.is_error) {
    const message = String(result.result || result.subtype || "unknown error");
    const status = result.api_error_status;
    if (status === 401 || status === 403 || status === 429 || /limit|quota|log ?in|auth/i.test(message)) throw new ClaudeGate(`Claude did not run: ${message}`);
    throw new ClaudeError(`claude -p reported an error (${status ?? result.subtype}): ${message.slice(0, 600)}`);
  }
  return result;
}

export async function runClaude(o: RunOptions): Promise<RunResult> {
  const model = modelFor(o.step);
  const argv = buildArgv(o, model);
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS[o.step];
  const child = spawn(claudeBin(), argv, { cwd: ENGINE_DIR, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
  child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));

  let killedFor: string | undefined;
  const kill = (why: string) => {
    if (killedFor) return;
    killedFor = why;
    child.kill("SIGTERM");
    setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 3000).unref();
  };
  const timer = setTimeout(() => kill(`claude -p gave no answer in ${Math.round(timeoutMs / 60_000)} minutes`), timeoutMs);
  const onAbort = () => kill("cancelled");
  o.signal?.addEventListener("abort", onAbort, { once: true });

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", (e: NodeJS.ErrnoException) =>
      reject(e.code === "ENOENT" ? new ClaudeError(`cannot run "${claudeBin()}": not found. Install Claude Code or set STUDIO_CLAUDE_BIN.`) : e),
    );
    child.on("close", resolve);
    child.stdin.on("error", () => {}); // a child that exits early closes stdin; the exit code tells the story
    child.stdin.end(o.prompt);
  }).finally(() => {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  });

  if (killedFor) throw new ClaudeError(killedFor);
  const cli = parseResult(stdout, stderr, code);
  if (cli.structured_output === undefined) {
    throw new OutputError("Claude answered without structured output", [`no structured_output in the result; it said: ${(cli.result ?? "").slice(0, 300)}`]);
  }
  return { output: cli.structured_output, cli, model, argv };
}
