import { POSITIONS, type PositionId } from "@studio/schema";
import { W } from "../theme";

/**
 * The low-poly world (docs/PLAN.md section 6, "Low poly").
 *
 * Units are metres. x runs left to right, y up, z toward the camera. The
 * characters stand on the stage plane z = 0, at the same x as their 2D
 * position, so a scene laid out for the stick style lands in the same place:
 * 1920 px of the 2D stage are PX px per metre, and the 2D ground line (the
 * background's `groundY`) is y = 0.
 *
 * Everything that moves reads the frame (no clocks, no `useFrame`), so any
 * frame renders the same on its own: the segment cache and partial re-render
 * work as for the stick style.
 */

/** 2D px per metre. The default figure (340 px × FIGURE_SCALE) stands about 1.75 m tall. */
export const PX = 215;

/** Vertical field of view of the camera, degrees. Narrow enough to keep the 2D framing, wide enough to feel 3D. */
export const FOV = 30;
/** The camera looks down at the stage by this much, degrees. */
export const PITCH = 8;

/** 2D stage x (px) → world x (m). */
export const wx = (px: number) => (px - W / 2) / PX;
/** 2D height above the ground line (px) → world y (m). */
export const wy = (pxAboveGround: number) => pxAboveGround / PX;
export const posX = (id: PositionId) => wx(POSITIONS[id].x * W);

export const RAD = Math.PI / 180;

/** Deterministic noise in [0, 1) from integers (jittered rocks, window lights). */
export function rand(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= Math.floor(v * 1000) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return ((h >>> 0) % 100000) / 100000;
}
