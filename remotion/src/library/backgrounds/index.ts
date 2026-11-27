import type { BackgroundId } from "@studio/schema";
import type { FC } from "react";
import type { BgProps } from "./common";
import { forest } from "./forest";
import { houseInterior } from "./houseInterior";
import { lighthouseExterior } from "./lighthouseExterior";
import { lighthouseStairs } from "./lighthouseStairs";
import { street } from "./street";
import { office } from "./office";
import { kitchen } from "./kitchen";
import { bedroom } from "./bedroom";
import { classroom } from "./classroom";
import { lab } from "./lab";
import { spaceship } from "./spaceship";
import { cafe } from "./cafe";
import { hospital } from "./hospital";
import { interrogation } from "./interrogation";
import { cave } from "./cave";
import { desert } from "./desert";
import { beach } from "./beach";
import { city } from "./city";
import { park } from "./park";
import { mountain } from "./mountain";
import { rooftop } from "./rooftop";
import { road } from "./road";
import { graveyard } from "./graveyard";

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
  office: office,
  kitchen: kitchen,
  bedroom: bedroom,
  classroom: classroom,
  lab: lab,
  spaceship: spaceship,
  cafe: cafe,
  hospital: hospital,
  interrogation: interrogation,
  cave: cave,
  desert: desert,
  beach: beach,
  city: city,
  park: park,
  mountain: mountain,
  rooftop: rooftop,
  road: road,
  graveyard: graveyard,
};

export type { BgProps };
