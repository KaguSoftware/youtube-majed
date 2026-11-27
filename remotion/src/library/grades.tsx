import type { GradeId } from "@studio/schema";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { TimeOfDay } from "../theme";

/**
 * Colour grades. The time of day re-lights the scenery itself (theme.tone);
 * the grade adds the final wash and vignette over the whole frame, and some
 * grades also filter the picture (noir is black and white). Captions and
 * overlays sit above the grade, so text stays clean.
 */
export type Grade = {
  tod: TimeOfDay;
  wash: string;
  blend: "soft-light" | "multiply" | "overlay" | "screen";
  vignette: number;
  vignetteColor?: string;
  /** CSS filter for the scene picture (characters and scenery, not captions). */
  filter?: string;
  /** Interiors at night: a lighter wash, so lamplight keeps its warmth. */
  interior?: Partial<Pick<Grade, "wash" | "blend" | "vignette" | "vignetteColor">>;
  grain?: number;
  flicker?: number;
};

export const GRADE_LIB: Record<GradeId, Grade> = {
  day: { tod: "day", wash: "rgba(255, 236, 200, 0.10)", vignette: 0.18, blend: "soft-light" },
  dusk: { tod: "dusk", wash: "rgba(255, 140, 90, 0.22)", vignette: 0.3, blend: "soft-light" },
  night: {
    tod: "night",
    wash: "rgba(30, 50, 120, 0.22)",
    vignette: 0.55,
    blend: "multiply",
    interior: { wash: "rgba(255, 170, 90, 0.10)", blend: "soft-light", vignette: 0.62, vignetteColor: "14, 12, 40" },
  },
  memory: {
    tod: "day",
    wash: "rgba(255, 196, 130, 0.30)",
    blend: "soft-light",
    vignette: 0.55,
    vignetteColor: "92, 58, 30",
    filter: "sepia(0.55) saturate(0.8) contrast(0.92) brightness(1.05)",
    grain: 0.06,
  },
  horror: {
    tod: "night",
    wash: "rgba(70, 150, 80, 0.32)",
    blend: "multiply",
    vignette: 0.8,
    vignetteColor: "4, 18, 8",
    filter: "saturate(0.65) contrast(1.12) hue-rotate(-14deg)",
    interior: { wash: "rgba(90, 170, 90, 0.26)", blend: "multiply", vignette: 0.8, vignetteColor: "4, 18, 8" },
    flicker: 0.35,
    grain: 0.05,
  },
  noir: {
    tod: "dusk",
    wash: "rgba(0, 0, 0, 0)",
    blend: "soft-light",
    vignette: 0.7,
    filter: "grayscale(1) contrast(1.4) brightness(0.98)",
    grain: 0.08,
  },
  neon: {
    tod: "night",
    wash: "linear-gradient(115deg, rgba(255, 60, 200, 0.38), rgba(40, 220, 255, 0.34))",
    blend: "soft-light",
    vignette: 0.6,
    vignetteColor: "20, 4, 40",
    filter: "saturate(1.55) contrast(1.08)",
    interior: { wash: "linear-gradient(115deg, rgba(255, 60, 200, 0.24), rgba(40, 220, 255, 0.22))", blend: "soft-light", vignette: 0.62, vignetteColor: "20, 4, 40" },
  },
};

export function GradeOverlay({ grade, interior = false }: { grade: GradeId; interior?: boolean }) {
  const frame = useCurrentFrame();
  const g = { ...GRADE_LIB[grade], ...(interior ? GRADE_LIB[grade].interior : {}) };
  const flick = g.flicker ? 1 - g.flicker * (0.5 + 0.5 * Math.sin(frame * 0.9) * Math.sin(frame * 0.23)) : 1;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: g.wash, mixBlendMode: g.blend, opacity: flick }} />
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(${g.vignetteColor ?? "8,8,24"},${g.vignette}) 100%)` }}
      />
      {g.grain ? <Grain amount={g.grain} frame={frame} /> : null}
    </AbsoluteFill>
  );
}

/** Film grain: a noise tile that jumps every frame. */
function Grain({ amount, frame }: { amount: number; frame: number }) {
  const seed = frame % 9;
  return (
    <AbsoluteFill style={{ opacity: amount * 4, mixBlendMode: "overlay" }}>
      <svg width="100%" height="100%">
        <filter id={`grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
      </svg>
    </AbsoluteFill>
  );
}
