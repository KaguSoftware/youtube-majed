import type { AttachPointId } from "@studio/schema";
import { createContext, use, type ReactNode } from "react";
import type { Vec } from "../rig/skeleton";
import { INK, tone, type TimeOfDay } from "../theme";

/**
 * Shared prop types. Held props draw at a hand in the figure's own space
 * (facing right, y down, the hand at `at`); placed props draw in world space
 * at a position's x, on the ground, the horizon, the wall or in the sky.
 * Props use the figure's ink outline (thinner) so they read as "things",
 * not scenery, and re-light with `tone(color, tod)`; emissive parts (flames,
 * screens, bulbs) skip the tone and glow at dusk/night.
 */

/** `facing` is -1 when the holder faces left (the drawing is mirrored): counter-flip any text with scale(facing, 1). */
export type HeldArgs = { at: Vec; swing: number; tod: TimeOfDay; frame: number; point: AttachPointId; facing: 1 | -1 };
export type PlacedArgs = {
  x: number;
  groundY: number;
  horizonY: number;
  wallY: number;
  /** y for sky props (well above the horizon). */
  skyY: number;
  tod: TimeOfDay;
  frame: number;
  /** Mirror the drawing (it faces left): the prop is on the right half, or the character using it faces left. */
  flip: boolean;
};

export type PropImpl = {
  held?: (a: HeldArgs) => ReactNode;
  placed?: (a: PlacedArgs) => ReactNode;
  /** Drawn in front of a character using the prop (lying in a bed, sitting in a car). */
  front?: (a: PlacedArgs) => ReactNode;
  /** Height of a surface a character standing at the same pos is lifted onto (a bed). */
  surface?: number;
  /** Seat height (px above the ground): perched actions at the same pos sit here. */
  seat?: number;
  /** Travels with a character doing `drive` at the same pos. */
  vehicle?: boolean;
  /** Stands beside a seated character (a desk, a table) instead of under them. */
  besideSeat?: boolean;
};

export const OUT = { stroke: INK, strokeWidth: 4, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

/** True inside an interior scene: props take the lamplight tone at night, like the room. */
export const InteriorContext = createContext(false);

/** The tone function for a prop, aware of indoors/outdoors. Call during render. */
export function propTone(tod: TimeOfDay): (hex: string) => string {
  const interior = use(InteriorContext);
  return (hex) => tone(hex, tod, interior);
}
