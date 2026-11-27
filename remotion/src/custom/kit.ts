/**
 * The one module a custom shot imports from (besides `remotion` and `react`):
 * the theme, easing, the frame, and library pieces to compose with. Keeping it
 * to one file keeps the import rule (packages/project/src/shot-lint.ts) one
 * short allowlist, and keeps the skill's API list (engine/.claude/skills/
 * custom-shot) checkable against it (worker/src/custom-shots.test.ts).
 */
export { ACCENT, C, FPS, H, INK, PAPER, W, hash01, mix, tone } from "../theme";
/** the channel font, already loaded in every render */
export const FONT = "Fredoka, system-ui, sans-serif";
export { EASE } from "../rig/pose";
export { SAFE_PORTRAIT, isPortrait, useView } from "../scene/view";
export { Actor, Backdrop, LibraryScene } from "./parts";
export type { ActorProps, LibrarySceneProps } from "./parts";
export { ShotContext, useShot, wordFrame } from "./types";
export type { ShotProps } from "./types";
