import { storyboardPaths } from "@studio/project";
import { SceneFile, StoryboardFile, idsOf } from "@studio/schema";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { lock } from "./review";
import { createProject, generateOptions, pickOption, readNarration, writeStory } from "./story";
import { batchLoops, defaultReveal, lineTimes, revealCameras, revealTransitions, storyboard, type SLoop } from "./storyboard";
import { useFakeClaude } from "./test-env";

const env = useFakeClaude();

beforeEach(() => {
  env.reset();
  delete process.env.FAKE_CLAUDE_MODE;
});

async function locked(format: "youtube" | "reel") {
  const b = createProject(
    format === "reel"
      ? { sentence: "A lighthouse keeper finds his oil disappearing every night.", narrative: "mystery", format: "reel", minutes: 1.25 }
      : { sentence: "A lighthouse keeper finds his oil disappearing every night.", narrative: "mystery", format: "youtube", minutes: 8 },
  );
  await generateOptions(b.id);
  pickOption(b.id, "A");
  await writeStory(b.id);
  lock(b.id, { force: true });
  env.reset();
  return b.id;
}

const read = <T>(file: string, schema: { parse: (v: unknown) => T }) => schema.parse(JSON.parse(readFileSync(file, "utf8")));

describe("storyboard", () => {
  it("storyboards an 8-minute script in batches of whole loops and covers every line once, in order", async () => {
    const id = await locked("youtube");
    const { scenes, report } = await storyboard(id);
    const steps = env.calls().map((c) => c.step);
    expect(steps[0]).toBe("cast");
    expect(steps.filter((s) => s === "storyboard").length).toBe(report.batches.length);
    expect(report.batches.length).toBeGreaterThan(1);
    for (const b of report.batches) expect(b.lines).toBeLessThanOrEqual(40);

    const lines = readNarration(id)!.loops.flatMap((l) => l.lines.map((x) => x.id));
    expect(scenes.scenes.flatMap((s) => s.lineIds)).toEqual(lines);
    expect(scenes.scenes.map((s) => s.id)).toEqual(scenes.scenes.map((_, i) => `S${i + 1}`));

    // the files on disk are what the strict schemas accept
    read(storyboardPaths(id).scenes, SceneFile);
    read(storyboardPaths(id).report, StoryboardFile);
  });

  it("feeds Claude the catalogue generated from catalogue.ts", async () => {
    const id = await locked("reel");
    await storyboard(id);
    const batch = env.calls().find((c) => c.step === "storyboard")!.input as unknown as { library: Record<string, Record<string, string>> };
    expect(Object.keys(batch.library.actions!)).toEqual(idsOf("actions"));
    expect(Object.keys(batch.library.cameras!)).toEqual(idsOf("cameras"));
  });

  it("gives every head fake its own shot with a reveal device, and a reveal word", async () => {
    const id = await locked("youtube");
    const { scenes, report } = await storyboard(id);
    const headfakes = readNarration(id)!.loops.flatMap((l) => l.lines).filter((l) => l.beats.includes("headfake")).map((l) => l.id);
    for (const hf of headfakes) {
      const scene = scenes.scenes.find((s) => s.lineIds.includes(hf))!;
      expect(scene.lineIds[0]).toBe(hf);
      expect(revealCameras().includes(scene.camera) || revealTransitions().includes(scene.transitionIn)).toBe(true);
    }
    expect(report.reveals.map((r) => r.lineId)).toEqual(headfakes);
  });

  it("maps cast hats and music moods to the library and flags them", async () => {
    const id = await locked("reel");
    const { scenes, report } = await storyboard(id);
    expect(scenes.cast.rival!.hat).toBe("beanie"); // fake wrote "beenie"
    expect(report.flags).toContainEqual(expect.objectContaining({ sceneId: "cast", kind: "mapped" }));
    expect(report.music[0]!.mood).toBe("mystery"); // fake wrote "mystry"
  });

  it("maps a misspelt id, regenerates only the broken scenes, folds in a skipped line and fixes repeated cameras", async () => {
    process.env.FAKE_CLAUDE_MODE = "messy";
    const id = await locked("reel");
    const { scenes, report } = await storyboard(id);
    const calls = env.calls().map((c) => c.step);
    expect(calls).toEqual(["cast", "storyboard", "storyboard"]); // one batch, one repair call

    const repair = env.calls()[2]!.input as unknown as { regenerate: { lineIds: string[]; problem: string }[] };
    const problems = repair.regenerate.map((g) => g.problem).join(" | ");
    expect(problems).toMatch(/"teleport" is not a action/);
    expect(problems).toMatch(/no scene covered these lines/);
    expect(report.stats.regenerated).toBe(repair.regenerate.length);

    expect(report.flags).toContainEqual(expect.objectContaining({ kind: "mapped", message: 'unknown action "sneek" → "sneak"' }));
    expect(report.flags.some((f) => f.kind === "repaired" && /lantern/.test(f.message))).toBe(true);
    expect(scenes.scenes.flatMap((s) => s.props ?? []).find((p) => p.id === "lantern")?.attach).toBe("hero.hand_r");

    // every camera repeat the messy draft made (all slow_push) was fixed by code
    expect(report.stats.varietyHits).toBeGreaterThan(0);
    for (let i = 1; i < scenes.scenes.length; i++) {
      const [a, b] = [scenes.scenes[i - 1]!, scenes.scenes[i]!];
      if (a.camera !== "static") expect(b.camera).not.toBe(a.camera);
    }
    expect(scenes.scenes.flatMap((s) => s.lineIds)).toEqual(readNarration(id)!.loops.flatMap((l) => l.lines.map((x) => x.id)));
  });

  it("reuses saved drafts on a rerun, so nothing is asked twice", async () => {
    const id = await locked("reel");
    await storyboard(id);
    env.reset();
    await storyboard(id);
    expect(env.calls()).toEqual([]);
    await storyboard(id, { force: true });
    expect(env.calls().length).toBeGreaterThan(0);
  });

  it("changes the camera of a shot whose combo was used in a recent project", async () => {
    const first = await locked("reel");
    const a = await storyboard(first);
    const second = await locked("reel");
    const b = await storyboard(second);
    const reused = b.report.combos.filter((c) => a.report.combos.includes(c));
    const flagged = b.report.flags.filter((f) => f.kind === "variety" && /recent video/.test(f.message));
    expect(flagged.length).toBeGreaterThan(0);
    // what is left over is only what code could not change, and it says so
    expect(reused.length).toBeLessThanOrEqual(flagged.filter((f) => !f.fixed).length);
  });

  it("refuses a script that is not locked", async () => {
    const b = createProject({ sentence: "A lighthouse keeper finds his oil disappearing every night.", narrative: "mystery", format: "reel", minutes: 1.25 });
    await generateOptions(b.id);
    pickOption(b.id, "A");
    await writeStory(b.id);
    await expect(storyboard(b.id)).rejects.toThrow(/lock/);
  });
});

describe("helpers", () => {
  const loop = (id: string, n: number): SLoop => ({ id, title: id, question: "", lines: Array.from({ length: n }, (_, i) => ({ id: `${id}.${i + 1}`, text: "one two three", energy: 3, delivery: "", beats: [], plants: [], payoffs: [] })) });

  it("packs whole loops into batches of at most 40 lines", () => {
    const b = batchLoops([loop("L1", 20), loop("L2", 15), loop("L3", 20), loop("L4", 50), loop("L5", 3)], 40);
    expect(b.map((x) => x.map((l) => l.id))).toEqual([["L1", "L2"], ["L3"], ["L4"], ["L5"]]);
  });

  it("estimates line times at the speaking rate when there is no voice", () => {
    const { times, timedBy } = lineTimes(loop("L1", 3).lines, undefined, 170);
    expect(timedBy).toBe("estimate");
    expect(times.get("L1.2")!.start).toBeGreaterThan(times.get("L1.1")!.end);
  });

  it("lands a default reveal on the first content word", () => {
    expect(defaultReveal({ id: "L4.1", text: "They lead straight back to his own bed.", energy: 5, delivery: "", beats: [], plants: [], payoffs: [] })).toEqual({ lineId: "L4.1", at: "L4.1:1", kind: "hit" });
  });
});
