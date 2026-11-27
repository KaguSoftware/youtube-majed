import { sceneStyle, type CastMember, type Scene, type SceneFile } from "@studio/schema";
import { SceneView } from "../scene/SceneView";
import { SceneView3D } from "./SceneView3D";

/**
 * Draws a scene in its art style (packages/schema style.ts): the project's
 * style, or the scene's own, falling back to stick when the low-poly library
 * lacks something the scene uses. The fallback is decided by the same pure
 * function the segment planner and the render scripts use.
 */
export function StyledScene({ file, scene, cast, frames }: { file: Pick<SceneFile, "artStyle">; scene: Scene; cast: Record<string, CastMember>; frames: number }) {
  return sceneStyle(file, scene).drawn === "low_poly" ? <SceneView3D scene={scene} cast={cast} frames={frames} /> : <SceneView scene={scene} cast={cast} frames={frames} />;
}
