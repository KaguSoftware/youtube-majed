import { describe, expect, it } from "vitest";
import { validateProject } from "./validate";

const scene = (over: Record<string, unknown> = {}) => ({
  id: "S1",
  lineIds: ["L1.1"],
  bg: "street",
  grade: "day",
  chars: [{ id: "tom", action: "walk", expr: "neutral", pos: "left", to: "right" }],
  props: [],
  camera: "static",
  transitionIn: "cut",
  sfx: [],
  caption: "word_pop",
  ...over,
});

const project = (scenes: unknown[]) => ({
  scenes: { version: 1, title: "t", cast: { tom: { name: "Tom", hat: "none", color: "#336699" } }, scenes },
  script: { version: 1, lines: [{ id: "L1.1", text: "Hello there.", energy: 2, delivery: "calm" }] },
  timing: { version: 1, fps: 30, seconds: Object.fromEntries(scenes.map((s) => [(s as { id: string }).id, 2])) },
});

describe("validateProject", () => {
  it("accepts a valid project", () => {
    const r = validateProject(project([scene()]));
    expect(r.ok).toBe(true);
  });

  it("names the scene id, the field and the closest id", () => {
    const r = validateProject(project([scene(), scene({ id: "S2", chars: [{ id: "tom", action: "sneek", expr: "neutral", pos: "left" }] })]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("Scene S2 → chars[0].action: unknown action \"sneek\" (did you mean \"sneak\"?)");
  });

  it("rejects unknown fields, missing cast and bad cross references", () => {
    const r = validateProject(
      project([scene({ id: "S3", chars: [{ id: "sam", action: "idle", expr: "happy", pos: "center", to: "left" }], props: [{ id: "lantern", attach: "tom.hand_r" }] })]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const all = r.errors.join("\n");
    expect(all).toContain('Scene S3 → chars[0].id: "sam" is not in the cast');
    expect(all).toContain('Scene S3 → chars[0].to: "to" only works with travelling actions');
    expect(all).toContain('Scene S3 → props[0].attach: "tom" is not a character in this scene');
  });

  it("catches typos in field names", () => {
    const r = validateProject(project([{ ...scene(), expresion: "x" }]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/Scene S1 → \(scene\): Unrecognized key/);
  });

  it("checks lines and timing against scenes", () => {
    const p = project([scene({ lineIds: ["L9.9"] })]);
    p.timing.seconds = { S2: 3 } as never;
    const r = validateProject(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      'scenes.json → Scene S1 → lineIds[0]: line "L9.9" is not in script.json',
      "timing.json → seconds: no duration for Scene S1",
      "timing.json → seconds.S2: there is no Scene S2 in scenes.json",
    ]);
  });

  it("perched and driving actions need a seat or a car at their pos", () => {
    const r = validateProject(
      project([
        scene({ chars: [{ id: "tom", action: "sit_chair", expr: "neutral", pos: "left" }], props: [{ id: "chair", pos: "right" }] }),
        scene({ id: "S2", chars: [{ id: "tom", action: "drive", expr: "happy", pos: "left", to: "right" }], props: [{ id: "car", pos: "left" }] }),
      ]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('Scene S1 → chars[0].action: "sit_chair" needs a seat at pos "left"');
  });

  it("horizon props need a sea, sky props need the outdoors", () => {
    const r = validateProject(project([scene({ chars: [], props: [{ id: "ship", pos: "right" }] }), scene({ id: "S2", bg: "office", chars: [], props: [{ id: "plane", pos: "left" }] })]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join("\n")).toContain('"street" has no sea');
    expect(r.errors.join("\n")).toContain('"plane" flies in the sky; "office" is indoors');
  });

  it("fills cast look defaults and rejects bad looks", () => {
    const ok = validateProject(project([scene()]));
    expect(ok.ok && ok.data.scenes.cast.tom).toMatchObject({ style: "ink", hair: "none", beard: "none", build: "average", height: 1, face: [] });
    const p = project([scene()]);
    (p.scenes.cast.tom as Record<string, unknown>).face = ["glasses", "sunglasses"];
    (p.scenes.cast.tom as Record<string, unknown>).height = 2;
    const r = validateProject(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join("\n")).toContain("pick glasses or sunglasses");
    expect(r.errors.join("\n")).toContain("height is 0.8–1.25");
  });

  it("checks overlays, weather and framing", () => {
    const good = validateProject(
      project([
        scene({
          weather: "rain",
          framing: "medium",
          overlays: [
            { style: "time_card", text: "3 hours later" },
            { style: "counter", to: 1000000, prefix: "$", label: "stolen", at: "L1.1:1" },
          ],
        }),
      ]),
    );
    expect(good.ok).toBe(true);
    const r = validateProject(
      project([
        scene({ overlays: [{ style: "map_pinn", text: "Paris" }, { style: "lower_third", text: "x".repeat(40) }] }),
      ]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const all = r.errors.join("\n");
    expect(all).toContain('unknown overlay style "map_pinn"');
    expect(all).toContain("overlays[1].text: at most 28 characters");
    const w = validateProject(project([scene({ bg: "office", weather: "snow", overlays: [{ style: "map_pin", text: "Paris", at: "L9.1:0" }] })]));
    expect(w.ok).toBe(false);
    if (w.ok) return;
    expect(w.errors.join("\n")).toContain('weather needs an outdoor background; "office" is indoors');
    expect(w.errors.join("\n")).toContain('overlays[0].at: line "L9.1" is not one of this scene\'s lineIds');
  });
});
