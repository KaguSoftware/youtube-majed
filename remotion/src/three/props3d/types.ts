import type { ActionId, AttachPointId } from "@studio/schema";
import type { ReactNode } from "react";
import type { TimeOfDay } from "../../theme";
import type { LightRig } from "../lighting";
import type { SetDef } from "../sets/common";

/**
 * Low-poly props. Placed props are drawn at a stage x on the ground (z a
 * little behind the characters), on the set's back wall, on its sea horizon
 * or in its sky; a prop a character uses (a bed, a chair, a car) takes that
 * character's spot and turn. Held props are drawn at a hand, upright in the
 * holder's own space (+z is where the holder faces).
 *
 * Seat and surface heights are the stick style's (props-placed.tsx), in
 * metres, because the shared placement code lifts perched characters to them.
 */
/** Placed props draw at their own origin (on the ground, the wall, the horizon), modelled facing +x; the scene places, turns and mirrors them. */
export type Placed3DArgs = {
  /** mirrored: the prop faces left (text on it must counter-flip) */
  flip: boolean;
  /** the prop is in use by a character at its spot */
  used: boolean;
  tod: TimeOfDay;
  frame: number;
  light: LightRig;
  set: SetDef;
};

export type Held3DArgs = {
  point: AttachPointId;
  action: ActionId;
  tod: TimeOfDay;
  frame: number;
  light: LightRig;
  /** the holder's hand moved this much (m) since the last frame: lanterns swing */
  swing: number;
};

export type Prop3D = {
  placed?: (a: Placed3DArgs) => ReactNode;
  held?: (a: Held3DArgs) => ReactNode;
  /** depth on the stage when nobody uses the prop (default: a little behind the characters) */
  z?: number;
};
