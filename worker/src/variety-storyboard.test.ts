import { projectPaths, storyboardPaths, writeJson } from "@studio/project";
import { VarietyFile, idsOf } from "@studio/schema";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { lock } from "./review";
import { createProject, generateOptions, pickOption } from "./story";
import { writeStory } from "./story";
import { avoidOverused, storyboard, type Slot } from "./storyboard";
import { useFakeClaude } from "./test-env";

const env = useFakeClaude();
beforeEach(() => {
  process.env.STUDIO_PROJECTS_DIR = mkdtempSync(join(tmpdir(), "studio-variety-sb-"));
  env.reset();
  delete process.env.FAKE_CLAUDE_MODE;
});

async function locked() {
  const b = createProject({ sentence: "A lighthouse keeper finds his oil disappearing every night.", narrative: "mystery", format: "reel", minutes: 1.25 });
  await generateOptions(b.id);
  pickOption(b.id, "A");
  await writeStory(b.id);
  lock(b.id, { force: true });
  env.reset();
  return b.id;
}

/** An earlier storyboarded video that leaned hard on one camera, one place and one grade. */
function earlier(id: string, at: string, camera: string) {
  const scenes = Array.from({ length: 10 }, (_, i) => ({ id: `S${i + 1}`, lineIds: [`L1.${i + 1}`], bg: "office", grade: "night", camera, transitionIn: "cut", caption: "word_pop", chars: [{ id: "x", action: i % 2 ? "think" : "peek" }], overlays: [] }));
  writeJson(storyboardPaths(id).scenes, { version: 1, title: id, cast: {}, scenes });
  writeJson(storyboardPaths(id).report, { version: 1, createdAt: at, music: [{ loopId: "L1", mood: "tense" }], reveals: [] });
  writeJson(join(projectPaths(id).dir, "brief.json"), { version: 1, id, format: "youtube", createdAt: at });
}

const camerasIn = (id: string) => (JSON.parse(readFileSync(storyboardPaths(id).scenes, "utf8")) as { scenes: { camera: string }[] }).scenes.map((s) => s.camera);

describe("storyboard and the variety guard", () => {
  it("sends no avoid-list for a first video, and still records its variety file", async () => {
    const id = await locked();
    await storyboard(id);
    const calls = env.calls();
    expect(calls.some((c) => "avoid" in c.input)).toBe(false);
    const v = VarietyFile.parse(JSON.parse(readFileSync(join(storyboardPaths(id).dir, "variety.json"), "utf8")));
    expect(v.against).toEqual([]);
    expect(v.avoid).toBeNull();
    expect(v.previous).toBeNull();
    expect(v.final.verdict).toBe("first");
  });

  it("puts what the last videos overused in the cast, storyboard and repair inputs, and swaps the overused camera by code", async () => {
    const cam = idsOf("cameras").find((c) => c !== "static")!;
    earlier("old-1", "2026-01-01T00:00:00.000Z", cam);
    earlier("old-2", "2026-01-02T00:00:00.000Z", cam);
    const id = await locked();
    await storyboard(id);

    const withAvoid = env.calls().filter((c) => c.step === "cast" || c.step === "storyboard");
    expect(withAvoid.length).toBeGreaterThan(1);
    for (const c of withAvoid) {
      const avoid = c.input.avoid as { against: string[]; backgrounds: string[]; cameras: string[]; grades: string[]; note: string };
      expect(avoid.against).toEqual(["old-2", "old-1"]);
      expect(avoid.backgrounds).toContain("office");
      expect(avoid.cameras).toEqual([cam]);
      expect(avoid.grades).toContain("night");
      expect(avoid.note).toMatch(/strong preference/);
    }

    const v = VarietyFile.parse(JSON.parse(readFileSync(join(storyboardPaths(id).dir, "variety.json"), "utf8")));
    expect(v.against).toEqual(["old-2", "old-1"]);
    expect(v.avoid?.cameras).toEqual([cam]);
    // the fake cycles through every camera, so the avoided one appears in Claude's draft; code moves every other use of it
    const was = v.firstPass.features.cameras[cam] ?? 0;
    const now = v.final.features.cameras[cam] ?? 0;
    expect(was).toBeGreaterThanOrEqual(1);
    expect(now).toBeLessThan(was);
    expect(v.swaps.some((s) => s.what.startsWith("avoid-list:"))).toBe(true);
    expect(camerasIn(id).filter((c) => c === cam).length).toBe(now);
  });

  it("records the project's previous storyboard on a rerun", async () => {
    const cam = idsOf("cameras").find((c) => c !== "static")!;
    earlier("old-1", "2026-01-01T00:00:00.000Z", cam);
    const id = await locked();
    await storyboard(id);
    await storyboard(id, { force: true });
    const v = VarietyFile.parse(JSON.parse(readFileSync(join(storyboardPaths(id).dir, "variety.json"), "utf8")));
    expect(v.previous?.project).toBe(id);
    expect(v.previous?.against).toEqual(["old-1"]);
  });
});

describe("avoidOverused", () => {
  const slot = (i: number, camera: string): Slot => ({ lineIds: [`L1.${i + 1}`], problems: [], flags: [], why: "", shot: { lineIds: [`L1.${i + 1}`], bg: "office", grade: "night", chars: [], props: [], camera, transitionIn: "cut", caption: "word_pop", sfx: [], overlays: [] } as never });

  it("keeps every other use of an avoided camera and leaves a video with no avoid-list alone", () => {
    const moving = idsOf("cameras").filter((c) => c !== "static");
    const cam = moving[0]!;
    const startOf = (s: Slot) => Number(s.lineIds[0]!.split(".")[1]) * 40; // far apart: the 30-second rule never bites
    const slots = [0, 1, 2, 3].map((i) => slot(i, cam));
    avoidOverused(slots, null, new Set(), startOf);
    expect(slots.map((s) => s.shot!.camera)).toEqual([cam, cam, cam, cam]);
    avoidOverused(slots, { against: ["a"], backgrounds: [], actionPairs: [], cameras: [cam], grades: [], captions: [], musicMoods: [], openings: [], endings: [], thumbnails: [] }, new Set(), startOf);
    expect(slots.map((s) => s.shot!.camera === cam)).toEqual([false, true, false, true]);
    expect(slots[0]!.flags[0]!.message).toMatch(/^avoid-list: camera/);
  });
});
