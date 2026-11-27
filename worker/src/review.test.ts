import { storyPaths, writeJson } from "@studio/project";
import { FactCheckOutput, NarrationFile, ScriptFile, allLines } from "@studio/schema";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { check, commentsFrom, decide, fix, flaggedLines, lock, readHistory, review, rewrite, saveNarration, unlock } from "./review";
import { createProject, generateOptions, pickOption, readComments, readNarration, writeStory } from "./story";
import { useFakeClaude } from "./test-env";

const env = useFakeClaude();

beforeEach(() => {
  env.reset();
  delete process.env.FAKE_CLAUDE_MODE;
  delete process.env.FAKE_CLAUDE_FAIL_STEP;
});

async function story(factual: boolean) {
  const b = createProject(
    factual
      ? { sentence: "The night the Eddystone lighthouse keeper swallowed molten lead.", narrative: "true_story", format: "reel", minutes: 1.25 }
      : { sentence: "A lighthouse keeper finds his oil disappearing every night.", narrative: "mystery", format: "youtube", minutes: 8 },
  );
  await generateOptions(b.id);
  pickOption(b.id, "A");
  await writeStory(b.id);
  env.reset();
  return b.id;
}

describe("the fake story", () => {
  it("passes the loop checker, so the fake pipeline is a fair test", async () => {
    const id = await story(false);
    const r = check(id);
    expect(r.findings.filter((f) => f.level === "error")).toEqual([]);
  });
});

describe("review", () => {
  it("runs fact-check and critic as two sessions and pins findings to lines", async () => {
    const id = await story(false);
    const r = await review(id);
    expect(env.calls().map((c) => c.step).sort()).toEqual(["critic", "fact-check"]);
    const factArgv = env.calls().find((c) => c.step === "fact-check")!.argv;
    expect(factArgv[factArgv.indexOf("--tools") + 1]).toBe(""); // fiction: no web search
    expect(r.round).toMatchObject({ round: 1, factual: false, blockers: 1, passed: false, facts: { issues: 1 } });
    const comments = readComments(id).comments;
    expect(comments.map((c) => [c.id, c.source, c.severity])).toEqual([
      ["r1-K1", "consistency", "blocker"],
      ["r1-W1", "critic", "suggestion"],
      ["r1-W2", "critic", "suggestion"],
      ["r1-W3", "critic", "suggestion"],
    ]);
    expect(comments[0]!.proposal[0]!.before).toBe(allLines(readNarration(id)!).find((l) => l.id === "L1.2")!.text);
  });

  it("gives the true-story fact-checker web search and keeps sources", async () => {
    const id = await story(true);
    await review(id);
    const argv = env.calls().find((c) => c.step === "fact-check")!.argv;
    expect(argv[argv.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
    const wrong = readComments(id).comments.find((c) => c.title.startsWith("Wrong:"))!;
    expect(wrong.severity).toBe("blocker");
    decide(id, wrong.id, "accept");
    const line = allLines(readNarration(id)!).find((l) => l.id === wrong.lineIds[0])!;
    expect(line.text).toBe("The lighthouse went up in eighteen seventy-two.");
    expect(line.sources).toEqual([{ url: "https://example.org/history", title: "History of the light" }]);
  });

  it("does not redo a review of an unchanged script, and redoes only the reviewer that failed", async () => {
    const id = await story(false);
    process.env.FAKE_CLAUDE_FAIL_STEP = "critic";
    await expect(review(id)).rejects.toThrow(/usage limit/);
    delete process.env.FAKE_CLAUDE_FAIL_STEP;
    env.reset();
    await review(id);
    expect(env.calls().map((c) => c.step)).toEqual(["critic"]);
    env.reset();
    const again = await review(id);
    expect(again.skipped).toBe(true);
    expect(env.calls()).toEqual([]);
    expect(readHistory(id).rounds).toHaveLength(1);
  });

  it("sends only the flagged lines back to be rewritten when the review fails", async () => {
    const id = await story(false);
    await review(id);
    const flagged = flaggedLines(id);
    // the consistency blocker, plus the critic's moments because loop L2 scored 2
    expect(flagged.length).toBeGreaterThan(0);
    env.reset();
    const fixes = await fix(id);
    const [call] = env.calls();
    expect(call!.step).toBe("rewrite");
    expect([...call!.input.lineIds].sort()).toEqual([...flagged].sort());
    expect(call!.input.direction).toMatch(/^Fix these reviewer findings/);
    expect(fixes.every((c) => c.source === "rewrite" && c.answers.length >= 1)).toBe(true);

    // accepting a fix applies it and settles the finding it answers
    const first = fixes[0]!;
    decide(id, first.id, "accept");
    const comments = readComments(id).comments;
    expect(comments.find((c) => c.id === first.answers[0])!.status).toBe("superseded");
    expect(allLines(readNarration(id)!).find((l) => l.id === first.lineIds[0])!.text).toMatch(/rewritten\.$/);
    // a second fix pass has nothing new to send for what is already answered
    env.reset();
    await fix(id);
    expect(env.calls().every((c) => !c.input.lineIds.includes(first.lineIds[0]!))).toBe(true);
  });
});

describe("a second review round", () => {
  it("replaces old findings and their fix suggestions, but keeps directed rewrites", async () => {
    const id = await story(false);
    await review(id);
    await fix(id);
    const directed = await rewrite(id, ["L3.2"], "shorter");
    const n = readNarration(id)!;
    saveNarration(id, { ...n, loops: n.loops.map((l) => ({ ...l, lines: l.lines.map((x) => (x.id === "L6.3" ? { ...x, text: "A changed line." } : x)) })) });
    await review(id);
    const open = readComments(id).comments.filter((c) => c.status === "open");
    expect(open.every((c) => c.round === 2 || c.id === directed.id)).toBe(true);
    expect(open.some((c) => c.id === directed.id)).toBe(true);
  });
});

describe("consistency severity", () => {
  it("lets only major issues block the lock", async () => {
    const id = await story(false);
    const n = readNarration(id)!;
    const issue = (k: string, severity: "major" | "minor") => ({ id: k, lineIds: ["L1.2"], kind: "other" as const, severity, issue: "x", proposal: [{ id: "L1.2", text: "y" }] });
    const fact = FactCheckOutput.parse({ mode: "consistency", claims: [], issues: [issue("K1", "minor"), issue("K2", "major")], summary: "s" });
    const critic = { loops: [], weakest: [], verdict: "v" } as unknown as Parameters<typeof commentsFrom>[2];
    expect(commentsFrom(n, fact, critic, 1).map((c) => [c.id, c.severity, c.title])).toEqual([
      ["r1-K1", "suggestion", "Minor: inconsistent other"],
      ["r1-K2", "blocker", "Inconsistent other"],
    ]);
  });
});

describe("rewrite with direction", () => {
  it("rewrites only the chosen lines, keeps their ids, and waits for accept", async () => {
    const id = await story(false);
    const before = readNarration(id)!;
    const c = await rewrite(id, ["L2.3", "L2.2"], "make this the shocking reveal");
    expect(env.calls()[0]!.input.lineIds).toEqual(["L2.2", "L2.3"]);
    expect(c.proposal.map((p) => p.id)).toEqual(["L2.2", "L2.3"]);
    expect(readNarration(id)).toEqual(before);
    decide(id, c.id, "accept");
    expect(allLines(readNarration(id)!).find((l) => l.id === "L2.2")!.text).toMatch(/rewritten\.$/);
  });

  it("sends a rewrite back once when it breaks a loop rule, and warns if it still does", async () => {
    const id = await story(false);
    process.env.FAKE_CLAUDE_MODE = "break-once";
    const ok = await rewrite(id, ["L2.3"], "punchier");
    expect(env.calls().map((c) => c.isRetry)).toEqual([false, true]);
    expect(ok.message).not.toMatch(/Breaks a loop check/);
    env.reset();
    process.env.FAKE_CLAUDE_MODE = "break";
    const bad = await rewrite(id, ["L2.4"], "punchier");
    expect(env.calls()).toHaveLength(2);
    expect(bad.message).toMatch(/^Breaks a loop check if accepted: L2\.4 is a head fake that pays off no plant/);
  });

  it("tells the rewrite which facts the fact-checker rejected", async () => {
    const id = await story(true);
    await review(id);
    env.reset();
    await rewrite(id, ["L2.2"], "shorter");
    const facts = env.calls()[0]!.input.factcheck as { doNotState: { verdict: string }[]; confirmed: string[] };
    expect(facts.doNotState.map((c) => c.verdict).sort()).toEqual(["unverifiable", "wrong"]);
    expect(facts.confirmed).toEqual(["The lamp burned whale oil."]);
  });

  it("never rewrites a locked line", async () => {
    const id = await story(false);
    const n = readNarration(id)!;
    saveNarration(id, { ...n, loops: n.loops.map((l) => ({ ...l, lines: l.lines.map((x) => (x.id === "L1.1" ? { ...x, locked: true } : x)) })) });
    await expect(rewrite(id, ["L1.1", "L1.2"], "shorter")).rejects.toThrow(/L1\.1 is locked/);
    expect(env.calls()).toEqual([]);
    const locked = readNarration(id)!;
    expect(() => saveNarration(id, { ...locked, loops: locked.loops.map((l) => ({ ...l, lines: l.lines.map((x) => (x.id === "L1.1" ? { ...x, text: "Changed." } : x)) })) })).toThrow(/L1\.1 is locked/);
  });
});

describe("lock", () => {
  it("refuses while a blocker is open, then writes script.json in the voice step's format", async () => {
    const id = await story(false);
    await review(id);
    expect(() => lock(id)).toThrow(/open review finding r1-K1/);
    decide(id, "r1-K1", "reject");
    const { scriptJson } = lock(id);
    expect(scriptJson).toBe(storyPaths(id).scriptJson);
    const script = ScriptFile.parse(JSON.parse(readFileSync(scriptJson, "utf8")));
    expect(script.lines).toHaveLength(allLines(readNarration(id)!).length);
    expect(Object.keys(script.lines[0]!)).toEqual(["id", "text", "energy", "delivery"]);
    // locked: nothing changes it
    await expect(rewrite(id, ["L1.2"], "shorter")).rejects.toThrow(/locked/);
    expect(() => decide(id, "r1-W1", "accept")).toThrow(/locked/);
    unlock(id);
    expect(readNarration(id)!.lockedAt).toBeNull();
  });

  it("refuses a script with checker errors unless forced", async () => {
    const id = await story(false);
    const n = readNarration(id)!;
    writeJson(storyPaths(id).narration, NarrationFile.parse({ ...n, loops: n.loops.map((l) => ({ ...l, lines: l.lines.map((x) => (x.id === "L1.1" ? { ...x, text: "In 1912 the light went out." } : x)) })) }));
    expect(() => lock(id)).toThrow(/\[digits\] L1\.1 has digits/);
    expect(lock(id, { force: true }).narration.lockedAt).not.toBeNull();
  });
});
