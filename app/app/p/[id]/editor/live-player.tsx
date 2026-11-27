"use client";
import { Player, type PlayerRef } from "@remotion/player";
import type { Project } from "@studio/schema";
import { StoryVideo } from "@studio/remotion/src/scene/StoryVideo";
import { buildTimeline } from "@studio/remotion/src/scene/timeline";
import { PORTRAIT } from "@studio/remotion/src/scene/view";
import { useEffect, useMemo, type Ref } from "react";
import { AbsoluteFill, Html5Video } from "remotion";

const FPS = 30;
const FONT = "/fonts/Fredoka-700.woff2";
let fontLoaded = false;

/** The render entries load Fredoka through staticFile(), which only resolves in a Remotion bundle; here it comes from app/public. */
function useFredoka() {
  useEffect(() => {
    if (fontLoaded) return;
    fontLoaded = true;
    new FontFace("Fredoka", `url(${FONT})`, { weight: "700" }).load().then(
      (f) => document.fonts.add(f),
      () => (fontLoaded = false),
    );
  }, []);
}

/** The draft: the same StoryVideo a render draws, from the project as it is now, with the current mix underneath. */
function Draft({ project, audioSrc, portrait }: { project: Project; audioSrc?: string; portrait?: boolean }) {
  // a Reel is the same project re-laid out in the 9:16 frame (scene/view.ts), as the ProjectVertical composition draws it
  return <StoryVideo project={project} audioSrc={audioSrc} view={portrait ? PORTRAIT : undefined} />;
}

function Rendered({ src }: { src: string }) {
  return (
    <AbsoluteFill>
      <Html5Video src={src} />
    </AbsoluteFill>
  );
}

const style = { width: "100%", borderRadius: 8, overflow: "hidden", background: "var(--color-raised)" } as const;

export type Source = { kind: "draft"; project: Project; audioSrc?: string } | { kind: "render"; src: string; seconds: number };

/**
 * The editor's Player. `draft` plays the live composition (changes show
 * before anything is drawn); `render` plays the last preview MP4. Both run on
 * the same frame clock, so the timeline follows either.
 */
export function LivePlayer({ source, portrait, playerRef }: { source: Source; portrait: boolean; playerRef: Ref<PlayerRef> }) {
  useFredoka();
  const frames = useMemo(() => (source.kind === "draft" ? buildTimeline(source.project).total : Math.max(1, Math.floor(source.seconds * FPS))), [source]);
  const [w, h] = portrait ? [1080, 1920] : [1920, 1080];
  const common = { ref: playerRef, durationInFrames: frames, fps: FPS, compositionWidth: w, compositionHeight: h, controls: true, clickToPlay: true, acknowledgeRemotionLicense: true, spaceKeyToPlayOrPause: false, style: portrait ? { ...style, maxHeight: "70vh", aspectRatio: "9 / 16" } : style } as const;
  return source.kind === "draft" ? (
    <Player {...common} component={Draft} inputProps={{ project: source.project, audioSrc: source.audioSrc, portrait }} />
  ) : (
    <Player {...common} component={Rendered} inputProps={{ src: source.src }} />
  );
}
