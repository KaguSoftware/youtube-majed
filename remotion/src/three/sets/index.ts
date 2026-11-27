import type { LowPolyBackgroundId } from "@studio/schema";
import { city } from "./city";
import type { SetDef } from "./common";
import { hospital } from "./hospital";
import { houseInterior } from "./houseInterior";
import { lighthouseExterior } from "./lighthouseExterior";
import { lighthouseStairs } from "./lighthouseStairs";
import { office } from "./office";
import { street } from "./street";

/** The low-poly sets, one per background id in catalogue LOW_POLY.backgrounds (TypeScript checks the Record). */
export const SETS: Record<LowPolyBackgroundId, SetDef> = {
  office,
  city,
  house_interior: houseInterior,
  lighthouse_exterior: lighthouseExterior,
  lighthouse_stairs: lighthouseStairs,
  street,
  hospital,
};
