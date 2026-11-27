/**
 * Claude usage per call, per project: projects/<id>/usage.jsonl.
 *
 * JSONL rather than SQLite: it is per project by construction (deleting a
 * project deletes its usage), append-only (a crash can at worst cut the last
 * line, which the reader skips), readable with `cat` or `jq`, has no schema
 * migrations, and needs nothing native. Node 24's node:sqlite works but is
 * still marked experimental and prints a warning on every run. The totals
 * Phase 2 needs are sums over a few hundred lines.
 */
import { projectsDir, storyPaths } from "@studio/project";
import { UsageRecord, type StepName } from "@studio/schema";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CliResult } from "./claude";

/**
 * Tokens and searches across every model the run used. Claude Code runs
 * WebSearch/WebFetch through a smaller model, so the top-level `usage` (main
 * model only) undercounts a fact check; `modelUsage` has one entry per model.
 */
function sumModels(cli: CliResult | undefined) {
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const models = Object.values(cli?.modelUsage ?? {}) as Record<string, unknown>[];
  if (!models.length) return undefined;
  return {
    input: models.reduce((s, m) => s + n(m.inputTokens), 0),
    output: models.reduce((s, m) => s + n(m.outputTokens), 0),
    cacheRead: models.reduce((s, m) => s + n(m.cacheReadInputTokens), 0),
    cacheWrite: models.reduce((s, m) => s + n(m.cacheCreationInputTokens), 0),
    searches: models.reduce((s, m) => s + n(m.webSearchRequests), 0),
  };
}

export function usageFrom(cli: CliResult | undefined, base: { project: string; step: StepName; model: string; attempt: number; durationMs: number; ok: boolean; error?: string }): UsageRecord {
  const u = cli?.usage;
  const all = sumModels(cli);
  return {
    at: new Date().toISOString(),
    ...base,
    apiMs: cli?.duration_api_ms ?? 0,
    turns: cli?.num_turns ?? 0,
    inputTokens: all?.input ?? u?.input_tokens ?? 0,
    outputTokens: all?.output ?? u?.output_tokens ?? 0,
    cacheReadTokens: all?.cacheRead ?? u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: all?.cacheWrite ?? u?.cache_creation_input_tokens ?? 0,
    webSearches: Math.max(all?.searches ?? 0, u?.server_tool_use?.web_search_requests ?? 0),
    costUsd: cli?.total_cost_usd ?? null,
    sessionId: cli?.session_id ?? null,
  };
}

export function logUsage(record: UsageRecord): void {
  const file = storyPaths(record.project).usage;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(UsageRecord.parse(record)) + "\n");
}

export function readUsage(project: string): UsageRecord[] {
  const file = storyPaths(project).usage;
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const r = UsageRecord.safeParse(JSON.parse(line));
        return r.success ? [r.data] : [];
      } catch {
        return []; // a line cut short by a crash
      }
    });
}

export type UsageTotals = { calls: number; failed: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; webSearches: number; durationMs: number; costUsd: number };

export function totals(records: readonly UsageRecord[]): UsageTotals {
  const t: UsageTotals = { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, durationMs: 0, costUsd: 0 };
  for (const r of records) {
    t.calls++;
    if (!r.ok) t.failed++;
    t.inputTokens += r.inputTokens;
    t.outputTokens += r.outputTokens;
    t.cacheReadTokens += r.cacheReadTokens;
    t.cacheWriteTokens += r.cacheWriteTokens;
    t.webSearches += r.webSearches;
    t.durationMs += r.durationMs;
    t.costUsd += r.costUsd ?? 0;
  }
  return t;
}

export function byStep(records: readonly UsageRecord[]): Record<string, UsageTotals> {
  const groups: Record<string, UsageRecord[]> = {};
  for (const r of records) (groups[r.step] ??= []).push(r);
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, totals(v)]));
}

/** Median duration of a step's successful calls across all projects: the estimate a progress bar shows. */
export function typicalDurationMs(step: StepName): number | undefined {
  if (!existsSync(projectsDir())) return undefined;
  const all = readdirSync(projectsDir(), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(projectsDir(), d.name, "usage.jsonl")))
    .flatMap((d) => {
      try {
        return readUsage(d.name);
      } catch {
        return [];
      }
    })
    .filter((r) => r.step === step && r.ok && r.model !== "fake")
    .map((r) => r.durationMs)
    .sort((a, b) => a - b);
  return all.length ? all[Math.floor(all.length / 2)] : undefined;
}
