import type { BackgroundId } from "@studio/schema";
import type { FC } from "react";
import type { BgProps } from "./common";
import { forest } from "./forest";
import { houseInterior } from "./houseInterior";
import { lighthouseExterior } from "./lighthouseExterior";
import { lighthouseStairs } from "./lighthouseStairs";
import { street } from "./street";

export type BgDef = {
  /** y where characters' feet touch the ground. */
  groundY: number;
  /** y of the horizon line (ships sit here). */
  horizonY: number;
  /** y where wall props hang. */
  wallY: number;
  /** Drawn behind characters. */
  Back: FC<BgProps>;
  /** Optional foreground drawn over characters. */
  Front?: FC<BgProps>;
};

export const BACKGROUND_LIB: Record<BackgroundId, BgDef> = {
  house_interior: houseInterior,
  street,
  forest,
  lighthouse_exterior: lighthouseExterior,
  lighthouse_stairs: lighthouseStairs,
};

export type { BgProps };
