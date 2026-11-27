import { NarrationFile, REEL_SECONDS, SceneFile, validateProject, type ReelCutOutput } from "@studio/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { callStep } from "./call";
import { loadDraft } from "./edit";
import { checkCut, childId, cutDraft, estimate, newLineSeconds, reelInput } from "./reel-cut";
import { editable } from "./test-edit-fixture";
import { useFakeClaude } from "./test-env";
import { ensureVersions } from "./versions";

const env = useFakeClaude();
beforeEach(() => {
  env.reset();
  delete process.env.FAKE_CLAUDE_MODE;
  delete process.env.FAKE_CLAUDE_NO_HOOK;
});

async function setup() {
  const id = await editable(env);
  const draft = loadDraft(id, ensureVersions(id));
  return { id, draft };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const ask = (s: Setup) => callStep({ project: s.id, step: "reelcut", input: reelInput(s.id, s.draft), check: (out) => checkCut(out, { draft: s.draft, wpm: 170 }) });

describe("the Reel cut", () => {
  it("gives Claude the loop map, the critic's scores, every line with its seconds and the scenes", async () => {
    const { id, draft } = await setup();
    const input = reelInput(id, draft);
    expect(input.seconds).toEqual(REEL_SECONDS);
    expect(input.loops.length).toBeGreaterThan(1);
    expect(input.lines).toHaveLength(draft.script.lines.length);
    expect(input.lines.every((l) => l.seconds > 0)).toBe(true);
    expect(input.scenes.map((s) => s.id)).toEqual(draft.scenes.scenes.map((s) => s.id));
    // a line's seconds are the distance to the next line's start, so they add up to the track
    expect(input.lines.reduce((t, l) => t + l.seconds, 0) + draft.voice.lines[0]!.offset).toBeCloseTo(draft.voice.track.duration, 1);
  });

  it("runs the reel-cut step through the usual call: zod, the cut checks, usage logged under the long video", async () => {
    const s = await setup();
    const out = await ask(s);
    expect(out.loopId).toMatch(/^L\d+$/);
    expect(out.lineIds.length).toBeGreaterThanOrEqual(4);
    expect(out.hook?.text).toBe("Nobody believed him at first.");
    expect(env.calls().map((c) => c.step)).toEqual(["reel-cut"]);
    const span = new Map(reelInput(s.id, s.draft).lines.map((l) => [l.id, l.seconds]));
    expect(estimate(out, span, 170)).toBeGreaterThanOrEqual(REEL_SECONDS.min);
    expect(estimate(out, span, 170)).toBeLessThanOrEqual(REEL_SECONDS.max);
  });

  it("rejects a cut that is out of order, too short, or has a bad new line, and says why", async () => {
    const s = await setup();
    const good = await ask(s);
    const bad = (o: Partial<ReelCutOutput>) => checkCut({ ...good, ...o }, { draft: s.draft, wpm: 170 });
    expect(bad({ lineIds: [...good.lineIds].reverse() }).join()).toMatch(/script order/);
    expect(bad({ lineIds: good.lineIds.slice(0, 4), hook: null }).join()).toMatch(/must be 60–90 s/);
    expect(bad({ lineIds: ["L9.9", ...good.lineIds] }).join()).toMatch(/do not exist/);
    expect(bad({ hook: { ...good.hook!, text: "He lost 5 minutes." } }).join()).toMatch(/digits or symbols/);
    expect(bad({ hook: { ...good.hook!, showScene: "S999" } }).join()).toMatch(/not a scene/);
    expect(bad({ hook: { ...good.hook!, text: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen" } }).join()).toMatch(/at most 16/);
    expect(bad({ loopId: "L99" }).join()).toMatch(/not a loop/);
  });

  it("sends a failing cut back once with the errors", async () => {
    const s = await setup();
    process.env.FAKE_CLAUDE_MODE = "invalid-once";
    await ask(s);
    const calls = env.calls();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.isRetry).toBe(true);
  });

  it("cuts the long video's files down to the kept lines: ids, scenes and narration stay consistent", async () => {
    const s = await setup();
    const out = await ask(s);
    const keep = new Set(out.lineIds);
    const d = cutDraft(s.draft, keep);
    expect(d.script.lines.map((l) => l.id)).toEqual(s.draft.script.lines.filter((l) => keep.has(l.id)).map((l) => l.id));
    expect(NarrationFile.safeParse(d.narration).success).toBe(true);
    expect(SceneFile.safeParse(d.scenes).success).toBe(true);
    expect(d.scenes.scenes.flatMap((x) => x.lineIds)).toEqual(d.script.lines.map((l) => l.id));
    expect(d.scenes.scenes[0]!.transitionIn).toBe("cut");
    // scene ids are the long video's (an id seeds a scene's idle motion), so no scene is renumbered
    expect(d.scenes.scenes.every((x) => s.draft.scenes.scenes.some((y) => y.id === x.id))).toBe(true);
    // a loop with no kept line is gone; the others keep their ids
    expect(d.narration!.loops.every((l) => l.lines.length > 0)).toBe(true);
    const voice = { ...s.draft.voice, lines: s.draft.voice.lines.filter((l) => keep.has(l.id)) };
    expect(validateProject({ scenes: d.scenes, script: d.script, voice }).ok).toBe(true);
  });

  it("names the child <id>-reel and counts the seconds of a new line from its words", async () => {
    const { id } = await setup();
    expect(childId(id)).toBe(`${id}-reel`);
    expect(newLineSeconds("Nobody believed him at first.", 170)).toBeGreaterThan(1.5);
  });
});
