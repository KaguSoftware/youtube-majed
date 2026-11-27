import { ENGINE_DIR, storyPaths, writeJson } from "@studio/project";
import { NarrationFile, ValidationError } from "@studio/schema";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { callStep } from "./call";
import { ClaudeError, ClaudeGate, childEnv, runClaude } from "./claude";
import { BusyError, acquire } from "./lock";
import { createProject, generateOptions, pickOption, readNarration, writeStory } from "./story";
import { useFakeClaude } from "./test-env";
import { readUsage } from "./usage";

const env = useFakeClaude();
const schema = readFileSync(`${ENGINE_DIR}/schemas/options.json`, "utf8");
const optionsPrompt = `/write-story step: options\n\nInput:\n${JSON.stringify({ brief: { wordBudget: 1200 } })}`;

beforeEach(() => {
  env.reset();
  delete process.env.FAKE_CLAUDE_MODE;
});

describe("childEnv", () => {
  it("drops the API key and parent-session markers but keeps the subscription token and PATH", () => {
    const out = childEnv({ PATH: "/bin", ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_AUTH_TOKEN: "t", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_OAUTH_TOKEN: "o", HOME: "/h" });
    expect(out).toEqual({ PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "o", HOME: "/h" });
  });
});

describe("runClaude", () => {
  it("runs inside engine/ with the schema inline, sonnet, no tools, and no API key in the child", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-must-not-leak";
    try {
      const r = await runClaude({ step: "options", prompt: optionsPrompt, schema });
      expect((r.output as { options: unknown[] }).options).toHaveLength(3);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
    const [call] = env.calls();
    expect(call!.cwd).toBe(ENGINE_DIR);
    expect(call!.envKeys).not.toContain("ANTHROPIC_API_KEY");
    const argv = call!.argv;
    expect(argv.slice(0, 3)).toEqual(["-p", "--model", "sonnet"]);
    expect(argv[argv.indexOf("--json-schema") + 1]).toBe(schema);
    expect(argv[argv.indexOf("--output-format") + 1]).toBe("json");
    expect(argv[argv.indexOf("--tools") + 1]).toBe("");
    expect(JSON.parse(argv[argv.indexOf("--settings") + 1]!).claudeMdExcludes).toHaveLength(2);
  });

  it("uses STUDIO_CLAUDE_MODEL and per-step overrides", async () => {
    process.env.STUDIO_CLAUDE_MODEL = "opus";
    process.env.STUDIO_CLAUDE_MODEL_OPTIONS = "haiku";
    try {
      await runClaude({ step: "options", prompt: optionsPrompt, schema });
    } finally {
      delete process.env.STUDIO_CLAUDE_MODEL;
      delete process.env.STUDIO_CLAUDE_MODEL_OPTIONS;
    }
    expect(env.calls()[0]!.argv[2]).toBe("haiku");
  });

  it("passes no --effort by default, and the per-step effort when set", async () => {
    await runClaude({ step: "options", prompt: optionsPrompt, schema });
    expect(env.calls()[0]!.argv).not.toContain("--effort");
    process.env.STUDIO_CLAUDE_EFFORT = "high";
    process.env.STUDIO_CLAUDE_EFFORT_OPTIONS = "medium";
    try {
      await runClaude({ step: "options", prompt: optionsPrompt, schema });
    } finally {
      delete process.env.STUDIO_CLAUDE_EFFORT;
      delete process.env.STUDIO_CLAUDE_EFFORT_OPTIONS;
    }
    const argv = env.calls()[1]!.argv;
    expect(argv[argv.indexOf("--effort") + 1]).toBe("medium");
  });

  it("allows only the tools asked for", async () => {
    await runClaude({ step: "options", prompt: optionsPrompt, schema, tools: ["WebSearch", "WebFetch"] });
    const argv = env.calls()[0]!.argv;
    expect(argv[argv.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
    expect(argv.slice(argv.indexOf("--allowedTools") + 1)).toEqual(["WebSearch", "WebFetch"]);
  });

  it("reports a usage limit as a ClaudeGate", async () => {
    process.env.FAKE_CLAUDE_MODE = "limit";
    await expect(runClaude({ step: "options", prompt: optionsPrompt, schema })).rejects.toThrow(ClaudeGate);
  });

  it("reports garbage and crashes as ClaudeError", async () => {
    process.env.FAKE_CLAUDE_MODE = "garbage";
    await expect(runClaude({ step: "options", prompt: optionsPrompt, schema })).rejects.toThrow(/without a result: I could not write this story/);
    process.env.FAKE_CLAUDE_MODE = "crash";
    await expect(runClaude({ step: "options", prompt: optionsPrompt, schema })).rejects.toThrow(ClaudeError);
  });

  it("kills a run that takes too long", async () => {
    process.env.FAKE_CLAUDE_MODE = "slow";
    process.env.FAKE_CLAUDE_DELAY = "5";
    await expect(runClaude({ step: "options", prompt: optionsPrompt, schema, timeoutMs: 300 })).rejects.toThrow(/gave no answer/);
  });

  it("can be cancelled", async () => {
    process.env.FAKE_CLAUDE_MODE = "slow";
    process.env.FAKE_CLAUDE_DELAY = "5";
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    await expect(runClaude({ step: "options", prompt: optionsPrompt, schema, signal: ac.signal })).rejects.toThrow(/cancelled/);
  });
});

describe("callStep", () => {
  const brief = () => createProject({ sentence: "A lighthouse keeper finds his oil disappearing every night.", narrative: "mystery", format: "youtube", minutes: 8 });

  it("retries once with the validator's errors, and logs both attempts", async () => {
    const b = brief();
    process.env.FAKE_CLAUDE_MODE = "invalid-once";
    const out = await callStep({ project: b.id, step: "options", input: { brief: {} } });
    expect(out.options).toHaveLength(3);
    expect(env.calls().map((c) => c.isRetry)).toEqual([false, true]);
    const usage = readUsage(b.id);
    expect(usage.map((u) => [u.step, u.ok, u.attempt])).toEqual([["options", false, 1], ["options", true, 2]]);
    expect(usage[1]).toMatchObject({ model: "fake", outputTokens: 500, cacheReadTokens: 4000, costUsd: 0 });
    expect(usage[0]!.error).toMatch(/unexpected/);
  });

  it("gives up after a second invalid answer with the errors", async () => {
    const b = brief();
    process.env.FAKE_CLAUDE_MODE = "invalid";
    await expect(callStep({ project: b.id, step: "options", input: {} })).rejects.toThrow(ValidationError);
    expect(env.calls()).toHaveLength(2);
  });

  it("does not retry a usage limit", async () => {
    const b = brief();
    process.env.FAKE_CLAUDE_MODE = "limit";
    await expect(callStep({ project: b.id, step: "options", input: {} })).rejects.toThrow(/usage limit/);
    expect(env.calls()).toHaveLength(1);
  });
});

describe("story steps", () => {
  it("brief → options → pick → loop map → narration, then a rerun redoes nothing", async () => {
    const b = createProject({ sentence: "A lighthouse keeper finds his oil disappearing every night.", narrative: "mystery", format: "youtube", minutes: 8 });
    expect(b.factual).toBe(false);
    await generateOptions(b.id);
    pickOption(b.id, "2");
    const n = await writeStory(b.id);
    expect(n.loops).toHaveLength(6);
    expect(env.calls().map((c) => c.step)).toEqual(["options", "loopmap", "narration"]);

    const map = JSON.parse(readFileSync(storyPaths(b.id).loopmap, "utf8"));
    expect(map.loops.reduce((s: number, l: { wordBudget: number }) => s + l.wordBudget, 0)).toBe(1360); // 8 min at 170 wpm

    env.reset();
    await generateOptions(b.id);
    await writeStory(b.id);
    expect(env.calls()).toEqual([]);

    await writeStory(b.id, { force: true });
    expect(env.calls().map((c) => c.step)).toEqual(["loopmap", "narration"]);
  });

  it("sends a loop map back once when it gives the ending away", async () => {
    const b = createProject({ sentence: "A keeper's oil vanishes every night.", narrative: "mystery", format: "reel", minutes: 1.25 });
    await generateOptions(b.id);
    pickOption(b.id, "A");
    env.reset();
    process.env.FAKE_CLAUDE_MODE = "leak-once";
    await writeStory(b.id);
    const steps = env.calls().map((c) => [c.step, c.isRetry]);
    expect(steps).toEqual([["loopmap", false], ["loopmap", true], ["narration", false]]);
    expect(readUsage(b.id).find((u) => u.step === "loopmap" && !u.ok)?.error).toMatch(/Loop L1: its head fake uses P3, which the ending twist needs/);
  });

  it("will not overwrite an edited narration with a new pick unless forced", async () => {
    const b = createProject({ sentence: "Two sisters inherit a clock that runs backwards.", narrative: "fable", format: "reel", minutes: 1.25 });
    await generateOptions(b.id);
    pickOption(b.id, "A");
    const n = await writeStory(b.id);
    writeJson(storyPaths(b.id).narration, NarrationFile.parse({ ...n, updatedAt: new Date(Date.now() + 1000).toISOString() }));
    expect(() => pickOption(b.id, "B")).toThrow(/already written up/);
    pickOption(b.id, "B", { force: true });
    await expect(writeStory(b.id)).rejects.toThrow(/edited since/);
    await writeStory(b.id, { force: true });
    expect(readNarration(b.id)!.loops).toHaveLength(3);
  });
});

describe("usageFrom", () => {
  it("sums tokens and searches over every model (web tools run on a smaller one)", async () => {
    const { usageFrom } = await import("./usage");
    const cli = { type: "result", subtype: "success", is_error: false, num_turns: 5, duration_ms: 1, duration_api_ms: 1, usage: { input_tokens: 6, output_tokens: 4900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 0 } }, modelUsage: { "claude-sonnet-5-5": { inputTokens: 6, outputTokens: 4926, cacheReadInputTokens: 34000, cacheCreationInputTokens: 19000, webSearchRequests: 0 }, "claude-haiku-5-5": { inputTokens: 900, outputTokens: 3959, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 1 } } } as Parameters<typeof usageFrom>[0];
    const r = usageFrom(cli, { project: "p", step: "factcheck", model: "m", attempt: 1, durationMs: 1, ok: true });
    expect([r.inputTokens, r.outputTokens, r.cacheReadTokens, r.webSearches]).toEqual([906, 8885, 34000, 1]);
  });
});

describe("job lock", () => {
  it("lets one job run at a time", () => {
    const release = acquire("story review x");
    expect(() => acquire("story pick y")).toThrow(BusyError);
    release();
    acquire("story pick y")();
  });
});
