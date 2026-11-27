"use client";
import { Player } from "@remotion/player";
import { AbsoluteFill, Html5Video } from "remotion";

const FPS = 30;

function Playback({ src }: { src: string }) {
  return (
    <AbsoluteFill>
      <Html5Video src={src} />
    </AbsoluteFill>
  );
}

/** The rendered preview in a Remotion Player: the same player the Phase 4 editor will build on. */
export function PreviewPlayer({ src, seconds, width, height }: { src: string; seconds: number; width: number; height: number }) {
  return (
    <Player
      component={Playback}
      inputProps={{ src }}
      durationInFrames={Math.max(1, Math.floor(seconds * FPS))}
      fps={FPS}
      compositionWidth={width}
      compositionHeight={height}
      controls
      clickToPlay
      acknowledgeRemotionLicense
      style={{ width: "100%", borderRadius: 8, overflow: "hidden", background: "var(--color-raised)" }}
    />
  );
}
