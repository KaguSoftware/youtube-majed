import type { CastMember, Scene, ShotLine, ShotWord } from "@studio/schema";
import { createContext, useContext } from "react";

/**
 * What a custom shot (docs/PLAN.md section 6) is given. Frames are relative to
 * the shot's own first frame, which is what `useCurrentFrame()` returns inside
 * it: a word with `start: 40` is spoken when `useCurrentFrame() === 40`.
 */
export type ShotProps = {
  sceneId: string;
  /** the library scene this shot stands in for: its background, grade, characters, props */
  scene: Scene;
  /** the looks of the characters the scene shows */
  cast: Record<string, CastMember>;
  /** the scene's length in frames: the shot must hold a picture for all of them */
  frames: number;
  fps: number;
  words: ShotWord[];
  lines: ShotLine[];
};

export const ShotContext = createContext<ShotProps | null>(null);

/** The same props as the component receives, for helpers that live outside it. */
export function useShot(): ShotProps {
  const shot = useContext(ShotContext);
  if (!shot) throw new Error("useShot() is only available inside a custom shot");
  return shot;
}

/** The frame a word is spoken at ("L3.4:2" = the third word of line L3.4), or undefined if the scene has no such word. */
export function wordFrame(shot: Pick<ShotProps, "words">, ref: string): number | undefined {
  const [lineId, i] = ref.split(":");
  return shot.words.find((w) => w.lineId === lineId && w.index === Number(i))?.start;
}
