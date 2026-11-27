import { createContext, useContext } from "react";

/**
 * The frame a project is drawn into (docs/PLAN.md section 9).
 *
 * The same project data renders into a 16:9 frame (YouTube) or a 9:16 frame
 * (Reels and Shorts). Vertical is a re-layout, not a crop: the world the
 * backgrounds, props and characters are drawn in stays 1920×1080 (plus bleed),
 * and `portrait` changes how a scene is framed in it (scene/portrait.ts), how
 * the camera moves over it (library/camera.tsx), and where text sits.
 */
export type View = { kind: "landscape" | "portrait"; width: number; height: number };

export const LANDSCAPE: View = { kind: "landscape", width: 1920, height: 1080 };
export const PORTRAIT: View = { kind: "portrait", width: 1080, height: 1920 };

export const ViewContext = createContext<View>(LANDSCAPE);
export const useView = (): View => useContext(ViewContext);
export const isPortrait = (v: View): boolean => v.kind === "portrait";

/**
 * Where text may sit in the portrait frame, in px of 1080×1920. The Shorts and
 * Instagram interfaces cover the top (search, camera, "Reels" title), the
 * right edge (like, comment, share, remix buttons) and the bottom (the caption
 * of the post, the account, the audio line, the progress bar). These margins
 * are the conservative union of both, so burned-in captions and overlays stay
 * clear of every one of them.
 */
export const SAFE_PORTRAIT = { top: 250, bottom: 480, left: 90, right: 150 } as const;

/** The centre of the safe box, where centred text sits (a little left of the frame's centre, away from the buttons). */
export const SAFE_CENTER_X = (SAFE_PORTRAIT.left + (PORTRAIT.width - SAFE_PORTRAIT.right)) / 2;
export const SAFE_WIDTH = PORTRAIT.width - SAFE_PORTRAIT.left - SAFE_PORTRAIT.right;
