import { SAFE_PORTRAIT, SAFE_WIDTH } from "../../scene/view";
import { SAFE_BOTTOM } from "../../theme";

/**
 * Where a caption sits. The wide frame keeps its words above SAFE_BOTTOM. The tall frame keeps them inside the safe
 * box (scene/view.ts): clear of the top, the buttons on the right and the post's own caption at the bottom, wrapping
 * to a second line when a chunk is wider than the box.
 */
export function captionBox(portrait: boolean, extra = 0): React.CSSProperties {
  return portrait
    ? { justifyContent: "flex-end", alignItems: "center", paddingBottom: SAFE_PORTRAIT.bottom + extra, paddingLeft: SAFE_PORTRAIT.left, paddingRight: SAFE_PORTRAIT.right, pointerEvents: "none" }
    : { justifyContent: "flex-end", alignItems: "center", paddingBottom: SAFE_BOTTOM + extra, pointerEvents: "none" };
}
/** A row of words that wraps inside the safe box in the tall frame. */
export const wordRow = (portrait: boolean, gap: number): React.CSSProperties => (portrait ? { display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline", columnGap: gap, rowGap: 14, maxWidth: SAFE_WIDTH } : { display: "flex", gap, alignItems: "baseline" });

