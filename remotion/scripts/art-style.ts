/**
 * Art style for the render scripts (docs/PLAN.md section 6; packages/schema style.ts).
 *
 * - `--style stick|low_poly` draws a project in another style than its scene file asks for, without editing it:
 *   the override is applied to the scene file the composition reads (public/projects/<id>/scenes.json) and to the
 *   project the segment planner keys, so the cache keeps the two styles apart.
 * - The GL backend: `angle` (Remotion's recommendation for Three.js on a desktop Mac) as soon as one scene is drawn
 *   in low poly; stick-only projects keep Chrome's default, exactly as before.
 * - The fallback report: which low-poly scenes were drawn as stick, and what was missing.
 */
import { ART_STYLES, sceneStyle, styleReport, withArtStyle, type ArtStyleId, type Project, type SceneFile } from "@studio/schema";
import { rmSync, writeFileSync } from "node:fs";

export function styleArg(args: string[]): ArtStyleId | undefined {
  const i = args.indexOf("--style");
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (!v || !(v in ART_STYLES)) throw new Error(`--style must be one of ${Object.keys(ART_STYLES).join(", ")}, got ${JSON.stringify(v)}`);
  return v as ArtStyleId;
}

/** The raw scene file JSON with the override applied (unchanged without one). */
export function styledRaw<T>(raw: T, style: ArtStyleId | undefined): T {
  if (!style || !raw || typeof raw !== "object") return raw;
  const file = raw as unknown as Pick<SceneFile, "artStyle" | "scenes">;
  if (!Array.isArray(file.scenes)) return raw;
  return withArtStyle(file, style) as unknown as T;
}

/** Writes the (styled) scene file where the composition reads it. */
export function stageScenes(raw: unknown, to: string) {
  writeFileSync(to, `${JSON.stringify(raw, null, 2)}\n`);
}

export function glFor(project: Project): "angle" | null {
  return project.scenes.scenes.some((s) => sceneStyle(project.scenes, s).drawn === "low_poly") ? "angle" : null;
}

/** One line for people, one JSON event for the worker. Nothing when the project is all stick. */
export function reportStyle(project: Project, say: (m: string) => void, emit: (e: Record<string, unknown>) => void) {
  const r = styleReport(project.scenes);
  if (!r.lowPoly) return;
  emit({ event: "style", ...r });
  const items = Object.entries(r.byItem).map(([k, n]) => `${k} (${n})`).join(", ");
  say(`  low poly: ${r.drawn3d} of ${r.lowPoly} scenes in 3D${r.fellBack.length ? `; ${r.fellBack.length} fell back to stick: ${items}` : ""}`);
}

/** Bundles copy remotion/public (~300 MB with the voiced projects) into the temp folder; remove it when the script ends. */
export function removeOnExit(dir: string) {
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
}

/**
 * Parallel frames when nothing else says: 8 for stick (remotion/README.md), 5 when a scene is drawn in 3D. Measured
 * on the M3 Pro, 900 frames of elevator-13-reel at the 1080p profile: low poly 38.1 / 45.1 / 47.4 / 45.8 frames/s at
 * 3 / 4 / 5 / 6 (the GPU is shared by every tab), stick 51.5 at 8.
 */
export function defaultConcurrency(gl: "angle" | null, cpuCount: number): number {
  return gl ? 5 : Math.max(2, Math.min(8, Math.floor(cpuCount * 0.67)));
}
