import type { TransitionId } from "@studio/schema";

/**
 * How many frames each transition draws the incoming scene over the outgoing
 * one. The outgoing scene's Sequence runs this many frames past its own end
 * (StoryVideo), so a scene's start never moves. Kept out of StoryVideo.tsx so
 * the segment planner (segments.ts) can read it without React.
 */
export const TRANSITION_FRAMES: Record<TransitionId, number> = {
  cut: 0,
  whoosh_wipe: 10,
  smash_cut: 0,
  dip_to_black: 0,
  crossfade: 14,
  iris: 0,
  glitch: 0,
  page_turn: 18,
};
