"use client";
import { Player } from "@remotion/player";
import { CastMember } from "@studio/schema";
import { ScenePreview } from "@studio/remotion/src/gallery/Preview";
import { useMemo } from "react";

const FRAMES = 90;
export type PreviewGrade = "day" | "night" | "neon";
export type PreviewMood = "neutral" | "happy" | "shock";

/** One character, drawn by the real animation library (the same code the render uses), idling in a medium shot. */
export function CastPreview({ look, grade, expr, bg }: { look: CastMember; grade: PreviewGrade; expr: PreviewMood; bg: string }) {
  const inputProps = useMemo(
    () => ({
      scene: { bg, grade, framing: "medium", chars: [{ id: "c", action: "idle", expr, pos: "center" }] } as never,
      cast: { c: look },
    }),
    [look, grade, expr, bg],
  );
  return (
    <Player
      component={ScenePreview}
      inputProps={inputProps}
      durationInFrames={FRAMES}
      fps={30}
      compositionWidth={1920}
      compositionHeight={1080}
      loop
      autoPlay
      acknowledgeRemotionLicense
      style={{ width: "100%", borderRadius: 8, overflow: "hidden", background: "var(--color-raised)" }}
    />
  );
}
