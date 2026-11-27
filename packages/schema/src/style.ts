import { LOW_POLY, type ArtStyleId } from "./catalogue";
import type { Scene, SceneFile } from "./scene";

/**
 * Art style per scene (docs/PLAN.md section 6, "one scene format"). A project
 * picks a style (scene file `artStyle`, default stick); a scene may override
 * it. A scene in `low_poly` that uses an action, background, prop or weather
 * with no 3D version yet (catalogue LOW_POLY) is drawn as `stick` instead and
 * flagged, so a render never fails for a missing 3D item.
 *
 * Pure: the renderer, the segment planner and the scripts all call this, so
 * they agree on what each scene is drawn in.
 */

const has = (list: readonly string[], id: string) => list.includes(id);

/** The style asked for: the scene's own, else the project's, else stick. */
export function chosenStyle(file: Pick<SceneFile, "artStyle">, scene: Pick<Scene, "artStyle">): ArtStyleId {
  return scene.artStyle ?? file.artStyle ?? "stick";
}

/** What keeps a scene out of low poly, one item per missing 3D version ([] = it can be drawn in 3D). */
export function lowPolyGaps(scene: Pick<Scene, "bg" | "chars" | "props" | "weather">): string[] {
  const gaps: string[] = [];
  if (!has(LOW_POLY.backgrounds, scene.bg)) gaps.push(`background:${scene.bg}`);
  for (const c of scene.chars) if (!has(LOW_POLY.actions, c.action)) gaps.push(`action:${c.action}`);
  for (const p of scene.props) if (!has(LOW_POLY.props, p.id)) gaps.push(`prop:${p.id}`);
  if (scene.weather && !has(LOW_POLY.weather, scene.weather)) gaps.push(`weather:${scene.weather}`);
  return [...new Set(gaps)];
}

export type SceneStyle = { chosen: ArtStyleId; drawn: ArtStyleId; gaps: string[] };

/** The style a scene is actually drawn in, after the fallback, and why it fell back. */
export function sceneStyle(file: Pick<SceneFile, "artStyle">, scene: Scene): SceneStyle {
  const chosen = chosenStyle(file, scene);
  if (chosen !== "low_poly") return { chosen, drawn: chosen, gaps: [] };
  const gaps = lowPolyGaps(scene);
  return { chosen, drawn: gaps.length ? "stick" : "low_poly", gaps };
}

export type StyleReport = {
  /** scenes asked to be low poly */
  lowPoly: number;
  /** of those, drawn in 3D */
  drawn3d: number;
  /** scenes that fell back to stick, with what is missing */
  fellBack: { sceneId: string; gaps: string[] }[];
  /** missing item → how many scenes it sent back to stick */
  byItem: Record<string, number>;
};

export function styleReport(file: Pick<SceneFile, "artStyle" | "scenes">): StyleReport {
  const fellBack: StyleReport["fellBack"] = [];
  const byItem: Record<string, number> = {};
  let lowPoly = 0;
  for (const scene of file.scenes) {
    const s = sceneStyle(file, scene);
    if (s.chosen !== "low_poly") continue;
    lowPoly++;
    if (!s.gaps.length) continue;
    fellBack.push({ sceneId: scene.id, gaps: s.gaps });
    for (const g of s.gaps) byItem[g] = (byItem[g] ?? 0) + 1;
  }
  return { lowPoly, drawn3d: lowPoly - fellBack.length, fellBack, byItem };
}

/** The same scene file drawn in another style (a render-time override): sets the project's style and clears scene overrides. */
export function withArtStyle<F extends Pick<SceneFile, "artStyle" | "scenes">>(file: F, style: ArtStyleId): F {
  return { ...file, artStyle: style, scenes: file.scenes.map(({ artStyle: _drop, ...s }) => s) };
}
