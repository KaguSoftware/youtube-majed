/**
 * Calls one story step: builds the skill prompt, runs `claude -p`, validates
 * the structured output with zod (and any step-specific check), logs usage,
 * keeps the prompt and raw result under projects/<id>/runs/.
 *
 * An output that fails validation is retried once, with the errors appended
 * to the prompt. A usage limit or sign-in problem is not retried.
 */
import { ENGINE_DIR, storyPaths, writeJson } from "@studio/project";
import { STEP_OUTPUTS, ValidationError, formatIssues, type StepName } from "@studio/schema";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import { ClaudeError, ClaudeGate, OutputError, runClaude, type CliResult } from "./claude";
import { logUsage, usageFrom } from "./usage";

const SKILL: Record<StepName, string> = {
  options: "write-story",
  loopmap: "write-story",
  narration: "write-story",
  rewrite: "write-story",
  factcheck: "fact-check",
  critic: "critic",
  cast: "plan-scenes",
  storyboard: "plan-scenes",
  regenerate: "edit-scenes",
  beat: "edit-scenes",
  fixscenes: "edit-scenes",
};

export type StepOutput<S extends StepName> = z.output<(typeof STEP_OUTPUTS)[S]>;

export type CallOptions<S extends StepName> = {
  project: string;
  step: S;
  input: unknown;
  tools?: string[];
  /** Extra checks zod cannot express (e.g. "returned exactly the requested ids"). Errors trigger the retry. */
  check?: (output: StepOutput<S>) => string[];
  /** Like `check`, but if the problems survive the retry the output is returned anyway (the caller reports them). */
  softCheck?: (output: StepOutput<S>) => string[];
  signal?: AbortSignal;
  /** Called when an attempt starts, for progress. */
  onAttempt?: (attempt: number) => void;
};

/** `/write-story step: narration` + the input. Skills read it as $ARGUMENTS. */
export function promptFor(step: StepName, input: unknown, retryErrors?: string[]): string {
  // write-story, plan-scenes and edit-scenes hold several steps; the others are one step each
  const head = SKILL[step] === "write-story" || SKILL[step] === "plan-scenes" || SKILL[step] === "edit-scenes" ? `/${SKILL[step]} step: ${step}` : `/${SKILL[step]}`;
  let prompt = `${head}\n\nInput:\n${JSON.stringify(input)}`;
  if (retryErrors?.length) {
    prompt += `\n\nYour previous answer to this step was rejected by the validator:\n- ${retryErrors.join("\n- ")}\nFix exactly these problems and return the whole corrected JSON.`;
  }
  return prompt;
}

function reportedModel(cli: CliResult | undefined, requested: string): string {
  const keys = Object.keys(cli?.modelUsage ?? {});
  return keys.length === 1 ? keys[0]! : keys.length > 1 ? keys.join("+") : requested;
}

export async function callStep<S extends StepName>(o: CallOptions<S>): Promise<StepOutput<S>> {
  const schemaText = readFileSync(join(ENGINE_DIR, "schemas", `${o.step}.json`), "utf8");
  const paths = storyPaths(o.project);
  let retryErrors: string[] | undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    o.onAttempt?.(attempt);
    const prompt = promptFor(o.step, o.input, retryErrors);
    const started = Date.now();
    let cli: CliResult | undefined;
    let model = process.env.STUDIO_CLAUDE_MODEL ?? "sonnet";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      const run = await runClaude({ step: o.step, prompt, schema: schemaText, tools: o.tools, signal: o.signal });
      cli = run.cli;
      model = reportedModel(cli, run.model);
      writeJson(join(paths.runsDir, `${stamp}-${o.step}-${attempt}.json`), { step: o.step, attempt, prompt, argv: run.argv.map((a) => (a === schemaText ? `<schemas/${o.step}.json>` : a)), result: cli });

      const parsed = STEP_OUTPUTS[o.step].safeParse(run.output);
      const errors = parsed.success
        ? [...(o.check?.(parsed.data as StepOutput<S>) ?? []), ...(attempt === 1 ? (o.softCheck?.(parsed.data as StepOutput<S>) ?? []) : [])]
        : formatIssues(`${o.step} output`, run.output, parsed.error.issues);
      if (errors.length) throw new OutputError(`the ${o.step} step returned JSON that fails validation`, errors);

      logUsage(usageFrom(cli, { project: o.project, step: o.step, model, attempt, durationMs: Date.now() - started, ok: true }));
      return parsed.data as StepOutput<S>;
    } catch (e) {
      const err = e as Error;
      const detail = e instanceof OutputError ? `: ${e.errors.slice(0, 5).join("; ")}` : "";
      logUsage(usageFrom(cli, { project: o.project, step: o.step, model, attempt, durationMs: Date.now() - started, ok: false, error: `${err.name}: ${err.message}${detail}`.slice(0, 500) }));
      if (e instanceof OutputError && attempt === 1) {
        retryErrors = e.errors.slice(0, 30);
        continue;
      }
      if (e instanceof OutputError) throw new ValidationError(`the ${o.step} step failed validation twice`, e.errors);
      if (e instanceof ClaudeGate || e instanceof ClaudeError) throw e;
      throw err;
    }
  }
  throw new Error("unreachable");
}
