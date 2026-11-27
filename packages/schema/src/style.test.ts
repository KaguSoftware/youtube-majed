import { describe, expect, it } from "vitest";
import { SceneFile } from "./scene";
import { lowPolyGaps, sceneStyle, styleReport, withArtStyle } from "./style";

const scene = (over: Record<string, unknown> = {}) => ({
  id: "S1",
  lineIds: ["L1.1"],
  bg: "office",
  grade: "night",
  chars: [{ id: "tom", action: "idle", expr: "neutral", pos: "left" }],
  camera: "static",
  transitionIn: "cut",
  caption: "word_pop",
  ...over,
});

const file = (scenes: unknown[], artStyle?: string) =>
  SceneFile.parse({ version: 1, title: "t", ...(artStyle ? { artStyle } : {}), cast: { tom: { name: "Tom", color: "#336699" } }, scenes });

describe("art style", () => {
  it("defaults to stick and needs no 3D coverage", () => {
    const f = file([scene({ bg: "forest" })]);
    expect(sceneStyle(f, f.scenes[0]!)).toEqual({ chosen: "stick", drawn: "stick", gaps: [] });
  });

  it("draws a covered scene in low poly", () => {
    const f = file([scene()], "low_poly");
    expect(sceneStyle(f, f.scenes[0]!).drawn).toBe("low_poly");
  });

  it("falls back to stick and names every missing item", () => {
    const f = file([scene({ bg: "forest", chars: [{ id: "tom", action: "dance", expr: "happy", pos: "left" }], props: [{ id: "sword", attach: "tom.hand_r" }], weather: "rain" })], "low_poly");
    const s = sceneStyle(f, f.scenes[0]!);
    expect(s.drawn).toBe("stick");
    expect(s.gaps).toEqual(["background:forest", "action:dance", "prop:sword", "weather:rain"]);
  });

  it("lets a scene override the project", () => {
    const f = file([scene({ artStyle: "stick" }), scene({ id: "S2" })], "low_poly");
    expect(f.scenes.map((s) => sceneStyle(f, s).drawn)).toEqual(["stick", "low_poly"]);
    const g = file([scene({ artStyle: "low_poly" })]);
    expect(sceneStyle(g, g.scenes[0]!).drawn).toBe("low_poly");
  });

  it("rejects an unknown style with the known ones", () => {
    const r = SceneFile.safeParse({ version: 1, title: "t", artStyle: "voxel", cast: { tom: { name: "Tom", color: "#336699" } }, scenes: [scene()] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain("stick, low_poly");
  });

  it("reports fallbacks per item", () => {
    const f = file([scene(), scene({ id: "S2", bg: "forest" }), scene({ id: "S3", bg: "forest" })], "low_poly");
    expect(styleReport(f)).toEqual({ lowPoly: 3, drawn3d: 1, fellBack: [{ sceneId: "S2", gaps: ["background:forest"] }, { sceneId: "S3", gaps: ["background:forest"] }], byItem: { "background:forest": 2 } });
  });

  it("overrides a whole file at render time", () => {
    const f = withArtStyle(file([scene({ artStyle: "stick" })]), "low_poly");
    expect(f.artStyle).toBe("low_poly");
    expect(sceneStyle(f, f.scenes[0]!).drawn).toBe("low_poly");
    expect(lowPolyGaps(f.scenes[0]!)).toEqual([]);
  });
});
