import type { GradeId } from "@studio/schema";
import { AbsoluteFill } from "remotion";
import type { TimeOfDay } from "../theme";

/**
 * Colour grades. The time of day re-lights the scenery itself (theme.tone);
 * the grade adds the final wash and vignette over the whole frame.
 */
export const GRADE_LIB: Record<GradeId, { tod: TimeOfDay; wash: string; vignette: number; blend: "soft-light" | "multiply" }> = {
  day: { tod: "day", wash: "rgba(255, 236, 200, 0.10)", vignette: 0.18, blend: "soft-light" },
  dusk: { tod: "dusk", wash: "rgba(255, 140, 90, 0.22)", vignette: 0.3, blend: "soft-light" },
  night: { tod: "night", wash: "rgba(30, 50, 120, 0.22)", vignette: 0.55, blend: "multiply" },
};

export function GradeOverlay({ grade }: { grade: GradeId }) {
  const g = GRADE_LIB[grade];
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: g.wash, mixBlendMode: g.blend }} />
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(8,8,24,${g.vignette}) 100%)` }}
      />
    </AbsoluteFill>
  );
}
