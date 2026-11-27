import { countWords, type Beat, type LoopMapOutput, type NarrationFile } from "@studio/schema";
import { describe, expect, it } from "vitest";
import { checkStory, openQuestionGaps, timeline } from "./check";
import { formatReport } from "./report";
import { tensionGraph, tensionSvg } from "./tension";

type L = [id: string, text: string, energy: number, beats?: Beat[], plants?: string[], payoffs?: string[]];

/** The lighthouse sample, as three loops with beats. About 75 s. */
const LOOPS: Record<string, L[]> = {
  L1: [
    ["L1.1", "For forty years, Tom has kept this lighthouse burning.", 2, ["stakes"]],
    ["L1.2", "Tonight, a cargo ship is heading straight into a storm,", 3, ["stakes"]],
    ["L1.3", "and the lamp has two hours of oil left.", 4, ["stakes"]],
    ["L1.4", "Yesterday, the tank was full. So who is stealing the oil?", 3, ["question"]],
    ["L1.5", "His boots stand by the bed, caked in mud as always.", 2, ["plant"], ["P1"]],
    ["L1.6", "There's only one other person on this island. Sam, the new assistant.", 3, ["turn"]],
    ["L1.7", "Sam arrived a week ago. The oil started vanishing a week ago.", 4, ["headfake"], [], ["P1"]],
    ["L1.8", "So tonight, Tom spreads flour across the floor and pretends to sleep.", 3, ["rehook"]],
  ],
  L2: [
    ["L2.1", "If he's wrong, the ship goes down with twelve people aboard.", 3, ["stakes"]],
    ["L2.2", "Midnight. Slow footsteps on the stairs. Whose are they?", 2, ["question"]],
    ["L2.3", "Tom keeps his eyes shut, the way he always sleeps, flat on his back.", 1, ["plant"], ["P2"]],
    ["L2.4", "In the morning, there are flour prints everywhere.", 4, ["turn"]],
    ["L2.5", "He follows them, ready to catch Sam in the act.", 4],
    ["L2.6", "They lead straight back to his own bed.", 5, ["headfake"], [], ["P2"]],
    ["L2.7", "Tom has been sleepwalking. But next to his prints, there's a second trail.", 4, ["rehook"]],
  ],
  L3: [
    ["L3.1", "And the oil is still disappearing, faster now.", 3, ["stakes"]],
    ["L3.2", "Smaller prints. Barefoot. So who walks beside him?", 2, ["question"]],
    ["L3.3", "Sam never touched a drop.", 2],
    ["L3.4", "The prints stop at the old cellar door that Tom nailed shut years ago.", 3, ["turn"]],
    ["L3.5", "The nails are on the inside.", 5, ["headfake"], [], ["P3"]],
  ],
};

function story(mutate?: (loops: Record<string, L[]>) => void): { map: LoopMapOutput; narration: Pick<NarrationFile, "loops"> } {
  const loops = structuredClone(LOOPS);
  // the cellar plant goes into L1 so the final twist is fair
  loops.L1![1]![3] = ["stakes", "plant"];
  loops.L1![1]![4] = ["P3"];
  mutate?.(loops);
  const words = (id: string) => loops[id]!.reduce((s, l) => s + countWords(l[1]), 0);
  const map: LoopMapOutput = {
    master: { stakes: { type: "urgent", text: "Two hours of oil" }, question: "Who is stealing the oil?", headFake: { expected: "Sam", actual: "something in the cellar", plantIds: ["P3"] } },
    loops: Object.keys(loops).map((id, i) => ({
      id, level: "micro", title: ["The empty tank", "The flour trap", "The second trail"][i]!, stakes: { type: "urgent", text: "The ship" }, question: ["Who is stealing the oil?", "Whose footsteps are on the stairs?", "Who walks beside him?"][i]!,
      headFake: { expected: "a", actual: "b", plantIds: [["P1"], ["P2"], ["P3"]][i]! }, rehook: "r", wordBudget: words(id),
    })),
    plants: [
      { id: "P1", loopId: "L1", detail: "muddy boots", paysOffIn: "L1" },
      { id: "P2", loopId: "L2", detail: "sleeps flat on his back", paysOffIn: "L2" },
      { id: "P3", loopId: "L1", detail: "the cellar door", paysOffIn: "L3" },
    ],
  };
  const narration = { loops: Object.entries(loops).map(([id, ls]) => ({ id, lines: ls.map(([lid, text, energy, beats = [], plants = [], payoffs = []]) => ({ id: lid, text, energy, delivery: "", beats, plants, payoffs, locked: false, sources: [] })) })) };
  return { map, narration };
}

const codes = (r: ReturnType<typeof checkStory>) => r.findings.map((f) => f.code);
const errorsOf = (r: ReturnType<typeof checkStory>) => r.findings.filter((f) => f.level === "error");

describe("checkStory", () => {
  it("passes a story that follows the loop rules", () => {
    const { map, narration } = story();
    const r = checkStory(map, narration);
    expect(errorsOf(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.loops.map((l) => l.words)).toEqual(map.loops.map((l) => l.wordBudget));
  });

  it("flags more than 20 s with no open question, naming loop and lines", () => {
    const { map, narration } = story((loops) => {
      // L1's rehook, L2's question and L2's turn stop opening anything: the gap runs to L2's rehook
      loops.L1![7]![3] = [];
      loops.L2![1]![3] = [];
      loops.L2![3]![3] = [];
    });
    const r = checkStory(map, narration);
    const gap = r.findings.find((f) => f.code === "gap");
    expect(gap?.level).toBe("error");
    expect(gap?.message).toMatch(/^Loop L1\/L2 · L1\.8–L2\.6: \d+ s with no open question/);
    expect(gap?.lineIds).toEqual(["L1.8", "L2.1", "L2.2", "L2.3", "L2.4", "L2.5", "L2.6"]);
  });

  it("flags a loop that never restates its stakes", () => {
    const { map, narration } = story((loops) => (loops.L3![0]![3] = []));
    const f = r(map, narration).find((x) => x.code === "stakes-missing");
    expect(f?.message).toMatch(/^Loop L3 \(L3\.1–L3\.5\) never restates the stakes/);
  });

  it("flags a head fake whose plant comes after it, or is never shown", () => {
    const late = story((loops) => {
      loops.L2![2]![4] = [];
      loops.L2![6]![4] = ["P2"]; // shown in the rehook, after the head fake
    });
    expect(r(late.map, late.narration).filter((f) => f.code === "plant-late").map((f) => f.lineIds)).toContainEqual(["L2.7", "L2.6"]);

    const missing = story((loops) => (loops.L2![2]![4] = []));
    expect(r(missing.map, missing.narration).find((f) => f.code === "plant-not-shown")?.message).toBe("L2.6 pays off P2, but no line shows P2.");
  });

  it("flags a head fake with no plant at all", () => {
    const { map, narration } = story((loops) => (loops.L3![4]![5] = []));
    expect(r(map, narration).find((f) => f.code === "headfake-no-plant")?.lineIds).toEqual(["L3.5"]);
  });

  it("flags a loop map whose head fake relies on a plant from a later loop", () => {
    const { map, narration } = story();
    map.loops[0]!.headFake.plantIds = ["P2"];
    expect(r(map, narration).find((f) => f.code === "plant-late")?.message).toBe("Loop L1: its head fake relies on P2, which is only planted later, in L2. A twist needs its plant first.");
  });

  it("flags word-budget overruns per loop and overall", () => {
    const { map, narration } = story();
    map.loops[1]!.wordBudget = 50;
    const f = r(map, narration).find((x) => x.code === "budget-over");
    expect(f?.message).toMatch(/^Loop L2 is \d+ words; its budget is 50 \(\+\d+%\)\. Cut at least \d+ words?\.$/);
    const total = checkStory(map, narration, { budget: 120 });
    expect(codes(total)).toContain("budget-total");
  });

  it("flags digits and symbols the voice step can't align", () => {
    const { map, narration } = story((loops) => (loops.L1![0]![1] = "For 40 years, Tom has kept this light burning & bright."));
    const f = r(map, narration);
    expect(f.find((x) => x.code === "digits")?.message).toMatch(/^L1\.1 has digits \("40"\)/);
    expect(f.find((x) => x.code === "symbol")?.lineIds).toEqual(["L1.1"]);
  });

  it("warns about yes/no questions and stacked energy-5 lines", () => {
    const { map, narration } = story((loops) => {
      loops.L2![1]![1] = "Midnight. Will he catch the thief?";
      loops.L2![4]![2] = 5;
    });
    map.loops[2]!.question = "Is Sam guilty?";
    const f = r(map, narration);
    expect(f.filter((x) => x.code === "yes-no").map((x) => x.level)).toEqual(["warning", "warning"]);
    expect(f.find((x) => x.code === "energy-5")?.lineIds).toEqual(["L2.5", "L2.6"]);
  });

  it("keeps the ending twist for the last loop", () => {
    const map = story().map;
    map.loops[1]!.headFake.plantIds = ["P2", "P3"];
    expect(r(map, story().narration).find((f) => f.code === "master-plant-early")?.message).toMatch(/^Loop L2: its head fake uses P3, which the ending twist needs/);

    const early = story((loops) => (loops.L2![5]![5] = ["P2", "P3"]));
    expect(r(early.map, early.narration).find((f) => f.code === "master-plant-early" && f.lineIds.length)?.lineIds).toEqual(["L2.6"]);

    const never = story((loops) => (loops.L3![4]![5] = ["P2"]));
    expect(r(never.map, never.narration).map((f) => f.code)).toContain("master-not-last");
  });

  it("needs the stakes in the first 15 s", () => {
    const { map, narration } = story((loops) => {
      for (const l of loops.L1!) l[3] = (l[3] ?? []).filter((b) => b !== "stakes");
      loops.L1![5]![3] = ["turn", "stakes"];
    });
    expect(r(map, narration).find((f) => f.code === "stakes-late")?.message).toMatch(/^The stakes first land at L1\.6, \d+ s in/);
  });
});

function r(map: LoopMapOutput, narration: Pick<NarrationFile, "loops">) {
  return checkStory(map, narration).findings;
}

describe("timeline and gaps", () => {
  it("estimates time from words at the speaking rate (170 wpm unless the brief says otherwise)", () => {
    const n = { loops: [{ id: "L1", lines: [{ id: "L1.1", text: "one two three four five", energy: 3, delivery: "", beats: [], plants: [], payoffs: [], locked: false, sources: [] }] }] };
    expect(timeline(n)[0]!.end).toBeCloseTo((5 / 170) * 60);
    expect(timeline(n, 150)[0]!.end).toBeCloseTo(2);
  });
  it("treats the opening as a gap until the first question", () => {
    const { narration } = story();
    const gaps = openQuestionGaps(timeline(narration));
    expect(gaps[0]!.start).toBe(0);
    expect(gaps[0]!.lineIds).toEqual(["L1.1", "L1.2", "L1.3"]);
  });
});

describe("tension graph and report", () => {
  it("rises to each head fake and drops after it", () => {
    const { map, narration } = story();
    const report = checkStory(map, narration);
    const g = tensionGraph(map, report);
    expect(g.loops.map((l) => l.loopId)).toEqual(["L1", "L2", "L3"]);
    const l2 = g.points.filter((p) => p.loopId === "L2");
    const fake = l2.findIndex((p) => p.headfake);
    expect(l2[fake]!.value).toBe(Math.max(...l2.map((p) => p.value)));
    expect(tensionSvg(g, "Lighthouse")).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(formatReport(report, "lighthouse")).toMatch(/^✓ lighthouse: \d+ \/ \d+ words/);
  });
});
