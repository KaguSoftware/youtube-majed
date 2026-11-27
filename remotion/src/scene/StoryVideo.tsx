import type { Project, TransitionId } from "@studio/schema";
import { useMemo, type ReactNode } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { WordPop } from "../library/captions/WordPop";
import { EASE } from "../rig/pose";
import { INK } from "../theme";
import { SceneView } from "./SceneView";
import { buildTimeline } from "./timeline";

/**
 * Plays a project's scenes back to back. A scene starts exactly on its own
 * first frame (later: its first word), so transitions never shift timing:
 * an overlapping transition (whoosh) draws the incoming scene over the
 * outgoing one, which keeps playing underneath for a few extra frames.
 */

export const TRANSITION_FRAMES: Record<TransitionId, number> = {
  cut: 0,
  whoosh_wipe: 10,
  smash_cut: 0,
  dip_to_black: 0,
};
const DIP = 9; // frames of fade on each side of a dip

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

/** Fades the end of a scene to black when the next one dips in. */
function Outro({ frames, dip, children }: { frames: number; dip: boolean; children: ReactNode }) {
  const f = useCurrentFrame();
  const o = dip ? Math.max(0, Math.min(1, (f - (frames - DIP)) / DIP)) : 0;
  return (
    <AbsoluteFill>
      {children}
      {o > 0 && <AbsoluteFill style={{ background: INK, opacity: o }} />}
    </AbsoluteFill>
  );
}

/** Pushes the outgoing scene sideways while a whoosh wipes over it. */
function Pushed({ from, children }: { from: number; children: ReactNode }) {
  const f = useCurrentFrame();
  const p = f < from ? 0 : EASE.inOut(Math.min(1, (f - from) / TRANSITION_FRAMES.whoosh_wipe));
  return <AbsoluteFill style={{ transform: `translateX(${-p * 180}px)` }}>{children}</AbsoluteFill>;
}

export type StoryVideoProps = { project: Project };

export function StoryVideo({ project }: StoryVideoProps) {
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
            <Outro frames={t.frames} dip={next?.transitionIn === "dip_to_black"}>
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
      <WordPop chunks={timeline.chunks} />
    </AbsoluteFill>
  );
}
