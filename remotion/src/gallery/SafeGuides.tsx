import { AbsoluteFill } from "remotion";
import { PORTRAIT, SAFE_PORTRAIT } from "../scene/view";

/**
 * The 9:16 safe zone drawn over a frame, for the Library galleries: red where
 * the Shorts and Instagram interfaces cover the picture (top, bottom, the
 * buttons on the right), so text and faces can be judged against it.
 */
export function SafeGuides() {
  const tint = "rgba(255, 40, 80, 0.20)";
  const edge = "2px dashed rgba(255, 40, 80, 0.9)";
  const s = SAFE_PORTRAIT;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: PORTRAIT.width, height: s.top, background: tint, borderBottom: edge }} />
      <div style={{ position: "absolute", left: 0, top: PORTRAIT.height - s.bottom, width: PORTRAIT.width, height: s.bottom, background: tint, borderTop: edge }} />
      <div style={{ position: "absolute", left: PORTRAIT.width - s.right, top: s.top, width: s.right, height: PORTRAIT.height - s.top - s.bottom, background: tint, borderLeft: edge }} />
    </AbsoluteFill>
  );
}
