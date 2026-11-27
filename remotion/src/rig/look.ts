import type { BuildId, CastMember } from "@studio/schema";
import { FIGURE_SCALE, INK, LINE, PAPER, mix, type TimeOfDay } from "../theme";
import { DIM, type Body } from "./skeleton";

/**
 * A cast member's resolved look: body proportions and colours. Everything the
 * Figure needs to draw one character, worked out once from the cast entry.
 */

type BuildSpec = { torso: number; arm: number; leg: number; head: number; line: number; belly: boolean };

export const BUILD: Record<BuildId, BuildSpec> = {
  average: { torso: 1, arm: 1, leg: 1, head: 1, line: 1, belly: false },
  slim: { torso: 1.03, arm: 1.05, leg: 1.07, head: 0.96, line: 0.74, belly: false },
  broad: { torso: 1.06, arm: 1.03, leg: 0.97, head: 1.04, line: 1.45, belly: false },
  round: { torso: 0.94, arm: 0.95, leg: 0.86, head: 1.02, line: 1.12, belly: true },
};

/** Bone lengths for a cast member: `height` stretches the body, not the head. */
export function bodyOf(cast: Pick<CastMember, "build" | "height">): Body {
  const b = BUILD[cast.build];
  const h = cast.height;
  return {
    ...DIM,
    headR: DIM.headR * b.head,
    torso: DIM.torso * h * b.torso,
    upperArm: DIM.upperArm * (0.4 + 0.6 * h) * b.arm,
    foreArm: DIM.foreArm * (0.4 + 0.6 * h) * b.arm,
    thigh: DIM.thigh * h * b.leg,
    shin: DIM.shin * h * b.leg,
  };
}

/** Screen-space size multiplier of a cast member. */
export const sizeOf = (cast: Pick<CastMember, "scale">) => cast.scale * FIGURE_SCALE;

export type Look = {
  /** Front line colour. */
  ink: string;
  /** Back limbs: a step lighter so the front limbs read on top. */
  back: string;
  /** Head and hand fill. */
  paper: string;
  /** Hat bands, outfits, neon glow. */
  accent: string;
  /** "Black" parts of hats (brims, top hats): ink normally, dark fill for neon. */
  dark: string;
  hair: string;
  neon: boolean;
  silhouette: boolean;
  /** Line width in figure units (constant on screen whatever the cast scale). */
  w: number;
  belly: boolean;
};

const NEON_FILL = "#15122a";

export function lookOf(cast: CastMember, tod: TimeOfDay, silhouette: boolean): Look {
  const s = sizeOf(cast);
  const b = BUILD[cast.build];
  const w = ((LINE * FIGURE_SCALE) / s) * b.line;
  const neon = cast.style === "neon" && !silhouette;
  if (silhouette) {
    return { ink: INK, back: INK, paper: INK, accent: INK, dark: INK, hair: INK, neon: false, silhouette: true, w, belly: b.belly };
  }
  if (neon) {
    const glow = cast.line ?? cast.color;
    return { ink: glow, back: mix(glow, NEON_FILL, 0.38), paper: cast.fill ?? NEON_FILL, accent: cast.color, dark: NEON_FILL, hair: cast.hairColor, neon: true, silhouette: false, w, belly: b.belly };
  }
  const ink = cast.line ?? INK;
  const paperBase = cast.fill ?? PAPER;
  const paper = tod === "night" ? mix(paperBase, "#b9c4ea", 0.3) : paperBase;
  return { ink, back: mix(ink, "#9a96ad", 0.38), paper, accent: cast.color, dark: ink, hair: cast.hairColor, neon: false, silhouette: false, w, belly: b.belly };
}
