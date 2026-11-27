import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ScriptFile } from "./script";
import { STEP_OUTPUTS, stepJsonSchema } from "./step-schemas";
import { Brief, budgetOf, FactCheckOutput, LoopMapOutput, MasterOptionsOutput, NarrationFile, NarrationOutput, StepName, countWords, narrationToScript, wordBudget } from "./story";

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.error?.issues ?? []).map((i) => i.message);

const line = (id: string, text = "He follows the trail.", over: Record<string, unknown> = {}) => ({ id, text, energy: 2, delivery: "hushed", beats: [], plants: [], payoffs: [], ...over });

describe("Brief", () => {
  const brief = (over: Record<string, unknown> = {}) => ({ version: 1, id: "oil-thief", sentence: "A lighthouse keeper finds his oil disappearing.", narrative: "mystery", factual: false, format: "youtube", minutes: 8, createdAt: "2026-11-27T10:00:00.000Z", ...over });

  it("accepts a brief and defaults the notes", () => {
    const r = Brief.safeParse(brief());
    expect(r.success).toBe(true);
    expect(r.data?.notes).toBe("");
  });
  it("keeps Reels between 30 s and 3 min", () => {
    expect(Brief.safeParse(brief({ format: "reel", minutes: 1.25 })).success).toBe(true);
    expect(messages(Brief.safeParse(brief({ format: "reel", minutes: 8 })))).toContain("a reel story is 0.5–3 minutes; got 8");
  });
  it("names the known narratives when one is wrong", () => {
    expect(messages(Brief.safeParse(brief({ narrative: "romcom" })))[0]).toMatch(/unknown narrative "romcom". Known: true_story, history/);
  });
});

describe("word budget", () => {
  it("is the brief's speaking rate times its length, 170 wpm by default", () => {
    expect(wordBudget(8)).toBe(1360);
    expect(wordBudget(8, 150)).toBe(1200);
    expect(wordBudget(1.25, 150)).toBe(188);
  });
  it("reads briefs from before the rate was stored at 150 wpm", () => {
    const old = Brief.parse({ version: 1, id: "x", sentence: "A keeper and his oil.", narrative: "mystery", factual: false, format: "reel", minutes: 1.25, createdAt: "2026-11-27T10:00:00.000Z" });
    expect(old.wpm).toBe(150);
    expect(budgetOf(old)).toBe(188);
  });
  it("counts spoken words, not punctuation", () => expect(countWords("Midnight. Slow footsteps — on the stairs…")).toBe(6));
});

describe("MasterOptionsOutput", () => {
  const option = (id: string) => ({ id, title: "t", logline: "l", stakes: { type: "at_risk", text: "s" }, question: "q", endingTwist: { expected: "a", actual: "b" }, hook: "h", whyItWorks: "w" });
  it("needs A, B and C", () => {
    expect(MasterOptionsOutput.safeParse({ options: ["A", "B", "C"].map(option) }).success).toBe(true);
    expect(messages(MasterOptionsOutput.safeParse({ options: ["A", "A", "C"].map(option) }))[0]).toMatch(/A, B and C once each/);
  });
});

describe("LoopMapOutput", () => {
  const loop = (id: string) => ({ id, level: "chapter", title: "t", stakes: { type: "urgent", text: "s" }, question: "Who took it?", headFake: { expected: "a", actual: "b", plantIds: ["P1"] }, rehook: "r", wordBudget: 150 });
  const map = (over: Record<string, unknown> = {}) => ({ master: { stakes: { type: "at_risk", text: "s" }, question: "q", headFake: { expected: "a", actual: "b", plantIds: ["P1"] } }, loops: [loop("L1"), loop("L2")], plants: [{ id: "P1", loopId: "L1", detail: "d", paysOffIn: "L2" }], ...over });

  it("accepts a map", () => expect(LoopMapOutput.safeParse(map()).success).toBe(true));
  it("numbers loops in order and checks plant loops exist", () => {
    expect(messages(LoopMapOutput.safeParse(map({ loops: [loop("L1"), loop("L3")] })))).toContain('loops are numbered in order from L1; loop #2 is "L3"');
    expect(messages(LoopMapOutput.safeParse(map({ plants: [{ id: "P1", loopId: "L1", detail: "d", paysOffIn: "L9" }] })))).toContain('plant P1: there is no loop "L9"');
  });
  it("rejects a head fake with no plant at the schema level", () => {
    const bad = map({ loops: [loop("L1"), { ...loop("L2"), headFake: { expected: "a", actual: "b", plantIds: [] } }] });
    expect(LoopMapOutput.safeParse(bad).success).toBe(false);
  });
});

describe("NarrationOutput", () => {
  it("needs line ids that match their loop, used once", () => {
    const r = NarrationOutput.safeParse({ loops: [{ id: "L1", lines: [line("L1.1"), line("L2.1"), line("L1.1")] }] });
    expect(messages(r)).toEqual(['line "L2.1" sits in loop L1; its id must start with "L1."', 'line id "L1.1" is used twice']);
  });
});

describe("FactCheckOutput", () => {
  const claim = (over: Record<string, unknown> = {}) => ({ id: "C1", lineIds: ["L1.1"], claim: "c", verdict: "wrong", correction: "", proposal: [], sources: [], note: "", ...over });
  it("needs a correction, a source and a rewrite for a wrong fact", () => {
    const m = messages(FactCheckOutput.safeParse({ mode: "facts", claims: [claim()], issues: [], summary: "s" }));
    expect(m).toEqual(["claim C1 is marked wrong but has no correction", "claim C1 is marked wrong but has no source URL", "claim C1 is marked wrong but proposes no rewrite"]);
  });
  it("reads consistency issues from before severity existed as major", () => {
    const r = FactCheckOutput.parse({ mode: "consistency", claims: [], issues: [{ id: "K1", lineIds: ["L1.1"], kind: "name", issue: "i", proposal: [{ id: "L1.1", text: "t" }] }], summary: "s" });
    expect(r.issues[0]!.severity).toBe("major");
  });

  it("accepts a sourced correction", () => {
    const ok = claim({ correction: "It was 1912.", sources: [{ url: "https://example.org/a", title: "A" }], proposal: [{ id: "L1.1", text: "In 1912, …" }] });
    expect(FactCheckOutput.safeParse({ mode: "facts", claims: [ok], issues: [], summary: "s" }).success).toBe(true);
  });
});

describe("narrationToScript", () => {
  it("turns the narration into a script.json the voice step accepts", () => {
    const narration = NarrationFile.parse({ version: 1, updatedAt: "2026-11-27T10:00:00.000Z", loops: [{ id: "L1", lines: [line("L1.1", "Tom has kept this lighthouse burning.", { locked: true, beats: ["stakes"] }), line("L1.2")] }] });
    const script = narrationToScript(narration);
    expect(ScriptFile.safeParse(script).success).toBe(true);
    expect(script.lines[0]).toEqual({ id: "L1.1", text: "Tom has kept this lighthouse burning.", energy: 2, delivery: "hushed" });
  });
});

describe("engine/schemas", () => {
  const dir = resolve(fileURLToPath(import.meta.url), "../../../../engine/schemas");
  it.each(StepName.options)("%s.json is generated from zod and up to date (run `pnpm schemas`)", (step) => {
    const file = join(dir, `${step}.json`);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(stepJsonSchema(step));
  });
  it("has a zod schema for every step", () => expect(Object.keys(STEP_OUTPUTS).sort()).toEqual([...StepName.options].sort()));
});
