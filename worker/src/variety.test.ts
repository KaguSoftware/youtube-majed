import { projectPaths, storyboardPaths, writeJson } from "@studio/project";
import { VARIETY_BANDS, VarietyReport } from "@studio/schema";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { useFakeClaude } from "./test-env";
import { allFeatures, allTable, avoidFrom, avoidInput, featuresFromScenes, historyOf, loadFeatures, scoreFeatures, varietyAll, varietyReport, type LooseScene } from "./variety";

useFakeClaude();
// every test gets an empty projects folder: history is whatever the test wrote
beforeEach(() => {
  process.env.STUDIO_PROJECTS_DIR = mkdtempSync(join(tmpdir(), "studio-variety-"));
});

type Spec = { bg: string; action?: string; camera?: string; grade?: string; transitionIn?: string; framing?: string; overlays?: string[] };
const scene = (i: number, s: Spec): LooseScene => ({
  id: `S${i + 1}`,
  lineIds: [`L1.${i + 1}`],
  bg: s.bg,
  grade: s.grade ?? "night",
  camera: s.camera ?? "static",
  transitionIn: s.transitionIn ?? "cut",
  caption: "word_pop",
  framing: s.framing,
  chars: s.action ? [{ id: "ines", action: s.action }] : [],
  overlays: (s.overlays ?? []).map((style) => ({ style })),
});

/** A storyboarded project on disk: scenes.json (loose), storyboard.json (createdAt, moods, reveals), brief.json. */
function make(id: string, at: string, specs: Spec[], o: { moods?: string[]; reveal?: string; parent?: string } = {}) {
  const sb = storyboardPaths(id);
  writeJson(sb.scenes, { version: 1, title: id, cast: {}, scenes: specs.map((s, i) => scene(i, s)) });
  writeJson(sb.report, { version: 1, createdAt: at, music: (o.moods ?? ["mystery"]).map((mood, i) => ({ loopId: `L${i + 1}`, mood })), reveals: o.reveal ? [{ lineId: o.reveal }] : [] });
  writeJson(join(projectPaths(id).dir, "brief.json"), { version: 1, id, format: "youtube", createdAt: at });
  if (o.parent) writeJson(join(projectPaths(id).dir, "reel.json"), { parent: o.parent });
}

const A: Spec[] = [
  { bg: "lighthouse_stairs", action: "sneak", camera: "slow_push" },
  { bg: "lighthouse_stairs", action: "think", camera: "zoom_face" },
  { bg: "lighthouse_exterior", action: "run", camera: "pan_left", transitionIn: "whoosh_wipe" },
  { bg: "lighthouse_stairs", action: "panic", camera: "shake", transitionIn: "smash_cut", framing: "medium" },
];
const B: Spec[] = [
  { bg: "desert", action: "walk", camera: "dolly_out", grade: "day" },
  { bg: "market", action: "argue", camera: "handheld", grade: "day" },
  { bg: "market", action: "shrug", camera: "whip_pan", grade: "dusk", overlays: ["title_card"] },
  { bg: "desert", action: "celebrate", camera: "zoom_face", grade: "dusk" },
];

describe("features", () => {
  it("counts what a video used and leaves a lone idle out of the action pairs", () => {
    const f = featuresFromScenes("x", [...A.map((s, i) => scene(i, s)), scene(4, { bg: "house", action: "idle" })], { at: "2026-01-01T00:00:00.000Z", moods: ["tense", "tense", "sad"], reveals: ["L1.4"] });
    expect(f.backgrounds).toEqual({ lighthouse_stairs: 3, lighthouse_exterior: 1, house: 1 });
    expect(f.actionPairs).toEqual({ sneak: 1, think: 1, run: 1, panic: 1 });
    expect(f.musicMoods).toEqual({ tense: 2, sad: 1 });
    expect(f.shotTypes).toMatchObject({ "transition:whoosh_wipe": 1, "transition:smash_cut": 1, "framing:medium": 1 });
    expect(f.opening).toHaveLength(3);
    expect(f.ending.at(-1)).toBe("out:cut");
    expect(f.thumbnails[0]).toBe("lighthouse_stairs|medium|shake|chars:1");
  });

  it("reads a project from disk, tolerating a missing mix, brief and custom shots", () => {
    make("feat-a", "2026-01-01T00:00:00.000Z", A);
    const f = loadFeatures("feat-a")!;
    expect(f.scenes).toBe(4);
    expect(f.musicBeds).toEqual([]);
    expect(f.customShots).toEqual([]);
    expect(loadFeatures("no-such-project")).toBeUndefined();
  });

  it("counts only live custom shots, by the slug of their title", () => {
    make("feat-c", "2026-01-02T00:00:00.000Z", A);
    const at = "2026-01-02T00:00:00.000Z";
    const shot = (id: string, status: string, sceneId: string, title: string) => ({ id, sceneId, status, title, idea: "x", note: "", source: "0123456789abcdef", model: "sonnet", origin: "claude", createdAt: at, updatedAt: at, reason: "", history: [], timing: [] });
    writeJson(join(projectPaths("feat-c").dir, "custom", "shots.json"), { version: 1, shots: [shot("C1", "accepted", "S2", "The light stutters"), shot("C2", "failed", "S3", "Broken one")] });
    const f = loadFeatures("feat-c")!;
    expect(f.customShots).toEqual([{ id: "C1", type: "the_light_stutters", title: "The light stutters", sceneId: "S2", at: expect.closeTo(1 / 3, 5) }]);
  });
});

describe("score", () => {
  const at = (n: number) => `2026-02-0${n}T00:00:00.000Z`;
  const f = (id: string, n: number, specs: Spec[], moods = ["mystery"]) => featuresFromScenes(id, specs.map((s, i) => scene(i, s)), { at: at(n), moods, reveals: ["L1.4"] });

  it("scores a copy of the last video near zero and a different one high, and the bands separate them", () => {
    const same = scoreFeatures("copy", f("copy", 2, A), [f("a", 1, A)]);
    const other = scoreFeatures("other", f("other", 2, B), [f("a", 1, A)]);
    expect(same.score!).toBeLessThan(VARIETY_BANDS.similar);
    expect(same.verdict).toBe("too_similar");
    expect(other.score!).toBeGreaterThan(VARIETY_BANDS.distinct);
    expect(other.verdict).toBe("distinct");
    // the report parses with its own strict schema
    VarietyReport.parse(same);
  });

  it("lists the specific repeats and leaves out a library default like the static camera", () => {
    const r = scoreFeatures("copy", f("copy", 3, A), [f("a", 1, A), f("b", 2, A)]);
    const msgs = r.repeats.map((x) => x.message);
    expect(msgs.some((m) => /^lighthouse_stairs: 75%.*in 2 of the last 2 videos \(a, b\)/.test(m))).toBe(true);
    expect(msgs.some((m) => /identical ending pattern as/.test(m))).toBe(true);
    expect(msgs.some((m) => /opens on the same picture as/.test(m))).toBe(true);
    expect(r.repeats.some((x) => x.item === "static")).toBe(false);
  });

  it("is null and 'first' with nothing to compare with, and skips a dimension with no data", () => {
    const first = scoreFeatures("solo", f("solo", 1, A), []);
    expect(first.score).toBeNull();
    expect(first.verdict).toBe("first");
    const r = scoreFeatures("x", f("x", 2, A), [f("a", 1, B)]);
    expect(r.dimensions.find((d) => d.dimension === "musicBeds")!.distinct).toBeNull(); // nobody has been mixed
    expect(r.dimensions.find((d) => d.dimension === "customShots")!.distinct).toBeNull(); // this video has none
  });

  it("scores a custom shot type nobody used as fully new, and the same type as a repeat", () => {
    const withShot = (id: string, n: number, type: string) => ({ ...f(id, n, A), customShots: [{ id: "C1", type, title: type, sceneId: "S2", at: 0.3 }] });
    const novel = scoreFeatures("x", withShot("x", 2, "head_fake"), [f("a", 1, A)]);
    expect(novel.dimensions.find((d) => d.dimension === "customShots")!.distinct).toBe(100);
    const same = scoreFeatures("x", withShot("x", 3, "head_fake"), [withShot("a", 1, "head_fake")]);
    expect(same.dimensions.find((d) => d.dimension === "customShots")!.distinct).toBe(0);
    expect(same.repeats.some((r) => r.dimension === "customShots")).toBe(true);
  });
});

describe("history and avoid-lists", () => {
  it("compares with the earlier videos only, newest first, never a Reel cut with its own long video", () => {
    make("h-1", "2026-03-01T00:00:00.000Z", A);
    make("h-2", "2026-03-02T00:00:00.000Z", B);
    make("h-3", "2026-03-03T00:00:00.000Z", A);
    make("h-3-reel", "2026-03-03T00:00:00.000Z", A, { parent: "h-3" });
    const r = varietyReport("h-3")!;
    expect(r.against).toEqual(["h-2", "h-1"]);
    expect(varietyReport("h-3-reel")!.against).toEqual(["h-2", "h-1"]);
    expect(historyOf("h-3", { against: 1, before: "2026-03-03T00:00:00.000Z" }).map((x) => x.id)).toEqual(["h-2"]);
    expect(varietyReport("h-1")!.verdict).toBe("first");
  });

  it("counts a Reel cut and its long video as one story in the history", () => {
    make("r-1", "2026-03-01T00:00:00.000Z", B);
    make("r-2", "2026-03-02T00:00:00.000Z", A);
    make("r-2-reel", "2026-03-02T00:00:01.000Z", A, { parent: "r-2" });
    make("r-3", "2026-03-03T00:00:00.000Z", B);
    expect(historyOf("r-3").map((x) => x.id)).toEqual(["r-2", "r-1"]);
    // with the long video gone from the pool the Reel stands in for it
    expect(historyOf("r-3", { pool: allFeatures().filter((x) => x.id !== "r-2") }).map((x) => x.id)).toEqual(["r-2-reel", "r-1"]);
  });

  it("avoids what at least two recent videos leaned on, and nothing when there is no history", () => {
    const f = (id: string, specs: Spec[]) => featuresFromScenes(id, specs.map((s, i) => scene(i, s)), { at: `2026-04-0${id.length}T00:00:00.000Z`, moods: ["tense"], reveals: ["L1.4"] });
    expect(avoidFrom([])).toBeNull();
    const a = avoidFrom([f("a", A), f("bb", A), f("ccc", B)])!;
    expect(a.against).toEqual(["a", "bb", "ccc"]);
    expect(a.backgrounds).toContain("lighthouse_stairs");
    expect(a.backgrounds).not.toContain("desert"); // only one of the three
    expect(a.cameras).not.toContain("static");
    // ... even when it is the video's most used camera, in every earlier video
    const allStatic = (id: string) => featuresFromScenes(id, [0, 1, 2].map((i) => scene(i, { bg: "office", action: "think" })), { at: `2026-04-0${id.length}T00:00:00.000Z` });
    expect(avoidFrom([allStatic("a"), allStatic("bb")])!.cameras).toEqual([]);
    expect(a.captions).toEqual([]); // the caption style is the series identity
    expect(a.openings.length).toBeGreaterThan(0);
    expect(avoidInput(null)).toBeUndefined();
    expect(avoidInput(a)!.note).toMatch(/strong preference/);
  });
});

describe("all projects", () => {
  it("scores every storyboarded project against the videos before it and lists the rest as left out", () => {
    make("all-1", "2026-05-01T00:00:00.000Z", A);
    make("all-2", "2026-05-02T00:00:00.000Z", A);
    mkdirSync(join(projectPaths("all-3").dir, "story"), { recursive: true });
    const all = varietyAll({ against: 3 });
    const mine = all.reports.filter((r) => r.project.startsWith("all-"));
    expect(mine.map((r) => r.project)).toEqual(["all-1", "all-2"]);
    expect(mine[0]!.verdict).toBe("first");
    expect(mine[1]!.verdict).toBe("too_similar");
    expect(all.skipped).toContainEqual({ id: "all-3", reason: "no storyboard yet" });
    expect(allTable(all)).toContain("all-2");
  });
});
