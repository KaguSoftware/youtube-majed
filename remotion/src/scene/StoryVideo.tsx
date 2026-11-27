import type { Project, TransitionId } from "@studio/schema";
import { useMemo, type ReactNode } from "react";
import { AbsoluteFill, Html5Audio, Sequence, useCurrentFrame } from "remotion";
import { Captions } from "../library/captions/Captions";
import { Overlays } from "../library/overlays";
import { EASE } from "../rig/pose";
import { INK } from "../theme";
import { SceneView } from "./SceneView";
import { buildTimeline } from "./timeline";
import { TRANSITION_FRAMES } from "./transitions";

/**
 * Plays a project's scenes back to back, with the narration track underneath
 * when the project has been voiced. A scene starts exactly on its own first
 * frame (see timeline.ts: just before its first word), so transitions never shift timing:
 * an overlapping transition (whoosh) draws the incoming scene over the
 * outgoing one, which keeps playing underneath for a few extra frames.
 */

export { TRANSITION_FRAMES };
const DIP = 9; // frames of fade on each side of a dip
const IRIS = 12; // frames of iris on each side
const GLITCH = 10; // frames of glitch at the start of the scene

function Intro({ kind, children }: { kind: TransitionId; children: ReactNode }) {
  const f = useCurrentFrame();
  if (kind === "whoosh_wipe") {
    const p = EASE.inOut(Math.min(1, f / TRANSITION_FRAMES.whoosh_wipe));
    if (p >= 1) return <>{children}</>;
    const edge = -320 + p * (1920 + 640);
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ clipPath: `polygon(0 0, ${edge + 160}px 0, ${edge - 160}px 100%, 0 100%)` }}>{children}</AbsoluteFill>
        <AbsoluteFill
          style={{
            left: edge - 260,
            width: 300,
            transform: "skewX(-16deg)",
            background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 70%, rgba(255,255,255,0.9) 92%, rgba(255,255,255,0) 100%)",
            filter: "blur(6px)",
          }}
        />
      </AbsoluteFill>
    );
  }
  if (kind === "smash_cut") {
    const punch = 1 + 0.09 * (1 - EASE.out(Math.min(1, f / 9)));
    const flash = Math.max(0, 1 - f / 4);
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ transform: `scale(${punch})` }}>{children}</AbsoluteFill>
        {flash > 0 && <AbsoluteFill style={{ background: "#fffaf0", opacity: flash * 0.9 }} />}
      </AbsoluteFill>
    );
  }
  if (kind === "crossfade") {
    const o = Math.min(1, f / TRANSITION_FRAMES.crossfade);
    return <AbsoluteFill style={{ opacity: EASE.inOut(o) }}>{children}</AbsoluteFill>;
  }
  if (kind === "iris") {
    const r = EASE.out(Math.min(1, f / IRIS)) * 1150;
    if (r >= 1150) return <>{children}</>;
    return (
      <AbsoluteFill style={{ background: INK }}>
        <AbsoluteFill style={{ clipPath: `circle(${r}px at 50% 46%)` }}>{children}</AbsoluteFill>
      </AbsoluteFill>
    );
  }
  if (kind === "glitch") {
    if (f >= GLITCH) return <>{children}</>;
    const k = 1 - f / GLITCH;
    const bands = [0, 1, 2, 3, 4].map((i) => {
      const top = (i * 23 + ((f * 37) % 11)) % 100;
      const h = 6 + ((i * 13 + f * 7) % 14);
      const dx = (((i * 97 + f * 61) % 9) - 4) * 30 * k;
      return { top, h, dx };
    });
    return (
      <AbsoluteFill>
        {children}
        <AbsoluteFill style={{ transform: `translateX(${14 * k}px)`, mixBlendMode: "screen", opacity: 0.55 * k, filter: "sepia(1) saturate(6) hue-rotate(-50deg)" }}>{children}</AbsoluteFill>
        <AbsoluteFill style={{ transform: `translateX(${-14 * k}px)`, mixBlendMode: "screen", opacity: 0.55 * k, filter: "sepia(1) saturate(6) hue-rotate(150deg)" }}>{children}</AbsoluteFill>
        {bands.map((b, i) => (
          <AbsoluteFill key={i} style={{ clipPath: `inset(${b.top}% 0 ${Math.max(0, 100 - b.top - b.h)}% 0)`, transform: `translateX(${b.dx}px)` }}>{children}</AbsoluteFill>
        ))}
        <AbsoluteFill style={{ background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 2px, rgba(0,0,0,0) 2px 5px)", opacity: k }} />
      </AbsoluteFill>
    );
  }
  if (kind === "page_turn") {
    const p = EASE.inOut(Math.min(1, f / TRANSITION_FRAMES.page_turn));
    if (p >= 1) return <>{children}</>;
    // The fold sweeps right to left; right of it is the new page, left of it the old page with the curled flap over it.
    const slant = 260;
    const top = 1920 + slant - p * (1920 + 2 * slant);
    const bottom = top - slant;
    const flap = Math.min(340, (1920 - bottom) * 0.42);
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ clipPath: `polygon(${top}px 0, 1920px 0, 1920px 100%, ${bottom}px 100%)` }}>{children}</AbsoluteFill>
        <AbsoluteFill
          style={{
            clipPath: `polygon(${top}px 0, ${top - flap}px 0, ${bottom - flap * 1.15}px 100%, ${bottom}px 100%)`,
            background: "linear-gradient(90deg, #d9ccb2 0%, #fbf4e6 55%, #efe2c8 100%)",
            filter: "drop-shadow(-18px 0 22px rgba(0,0,0,0.45))",
          }}
        />
      </AbsoluteFill>
    );
  }
  if (kind === "dip_to_black") {
    const o = Math.max(0, 1 - f / DIP);
    return (
      <AbsoluteFill>
        {children}
        {o > 0 && <AbsoluteFill style={{ background: INK, opacity: o }} />}
      </AbsoluteFill>
    );
  }
  return <>{children}</>;
}

/** Ends a scene for the next one's transition: fades to black for a dip, closes an iris. */
function Outro({ frames, next, children }: { frames: number; next?: TransitionId; children: ReactNode }) {
  const f = useCurrentFrame();
  if (next === "iris") {
    const k = Math.max(0, Math.min(1, (f - (frames - IRIS)) / IRIS));
    if (k <= 0) return <>{children}</>;
    return (
      <AbsoluteFill style={{ background: INK }}>
        <AbsoluteFill style={{ clipPath: `circle(${(1 - EASE.in(k)) * 1150}px at 50% 46%)` }}>{children}</AbsoluteFill>
      </AbsoluteFill>
    );
  }
  const o = next === "dip_to_black" ? Math.max(0, Math.min(1, (f - (frames - DIP)) / DIP)) : 0;
  return (
    <AbsoluteFill>
      {children}
      {o > 0 && <AbsoluteFill style={{ background: INK, opacity: o }} />}
    </AbsoluteFill>
  );
}

/** Pushes the outgoing scene away from the wipe (rightward), so the side it uncovers is already under the incoming scene. */
function Pushed({ from, children }: { from: number; children: ReactNode }) {
  const f = useCurrentFrame();
  const p = f < from ? 0 : EASE.inOut(Math.min(1, (f - from) / TRANSITION_FRAMES.whoosh_wipe));
  return <AbsoluteFill style={{ transform: `translateX(${p * 180}px)` }}>{children}</AbsoluteFill>;
}

export type StoryVideoProps = { project: Project; audioSrc?: string; /** false for thumbnail stills: the picture without its burned-in captions */ captions?: boolean };

export function StoryVideo({ project, audioSrc, captions = true }: StoryVideoProps) {
  const timeline = useMemo(() => buildTimeline(project), [project]);
  const scenes = project.scenes.scenes;

  return (
    <AbsoluteFill style={{ background: INK }}>
      {timeline.scenes.map((t, i) => {
        const scene = scenes[i]!;
        const next = scenes[i + 1];
        const overlap = next ? TRANSITION_FRAMES[next.transitionIn] : 0;
        const body = (
          <Intro kind={scene.transitionIn}>
            <Outro frames={t.frames} next={next?.transitionIn}>
              <SceneView scene={scene} cast={project.scenes.cast} frames={t.frames} />
            </Outro>
          </Intro>
        );
        return (
          <Sequence key={scene.id} from={t.start} durationInFrames={t.frames + overlap} name={`${scene.id} · ${scene.bg}`}>
            {next?.transitionIn === "whoosh_wipe" ? <Pushed from={t.frames}>{body}</Pushed> : body}
          </Sequence>
        );
      })}
      <Overlays overlays={timeline.overlays} />
      {captions && <Captions chunks={timeline.chunks} />}
      {audioSrc && <Html5Audio src={audioSrc} />}
    </AbsoluteFill>
  );
}
