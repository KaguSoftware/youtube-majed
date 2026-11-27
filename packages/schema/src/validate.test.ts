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
});
