import type { ActionId, BackgroundId, CastMember, CharInScene, ExpressionId, GradeId, PropInScene, Scene } from "@studio/schema";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ACTION_LIB } from "../library/actions";
import { BACKGROUND_LIB } from "../library/backgrounds";
import { GRADE_LIB, GradeOverlay } from "../library/grades";
import { Figure } from "../rig/Figure";
import { alive, blink } from "../rig/animate";
import { H, W, hash01 } from "../theme";
import { SceneView } from "../scene/SceneView";
import { useView } from "../scene/view";
import { useShot } from "./types";

/**
 * A library scene inside a custom shot: the scenery, characters and props the
 * storyboard step uses, drawn by the same code. Draw your own layers over it
 * (it is transparent above the scenery) or hide parts of it behind your own.
 */
export type LibrarySceneProps = {
  bg: BackgroundId;
  grade?: GradeId;
  chars?: CharInScene[];
  props?: PropInScene[];
  camera?: Scene["camera"];
  weather?: Scene["weather"];
  framing?: Scene["framing"];
};

export function LibraryScene({ bg, grade = "day", chars = [], props = [], camera = "static", weather, framing }: LibrarySceneProps) {
  const shot = useShot();
  const scene: Scene = {
    id: shot.scene.id,
    lineIds: shot.scene.lineIds,
    bg,
    grade,
    chars,
    props,
    camera,
    transitionIn: "cut",
    sfx: [],
    caption: "none",
    weather,
    framing,
    overlays: [],
  };
  return <SceneView scene={scene} cast={shot.cast} frames={shot.frames} />;
}

/** Just a library background and its colour grade, no characters. Fills the frame (cropped in the tall one). */
export function Backdrop({ bg, grade = "day" }: { bg: BackgroundId; grade?: GradeId }) {
  const frame = useCurrentFrame();
  const view = useView();
  const def = BACKGROUND_LIB[bg];
  const g = GRADE_LIB[grade];
  return (
    <AbsoluteFill style={{ filter: g.filter }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" width={view.width} height={view.height} style={{ position: "absolute", inset: 0 }}>
        <def.Back tod={g.tod} frame={frame} />
      </svg>
      <GradeOverlay grade={grade} />
    </AbsoluteFill>
  );
}

export type ActorProps = {
  /** a character id from `useShot().cast` */
  id: string;
  action: ActionId;
  expr?: ExpressionId;
  /** where the feet are, in px of the frame (not the 1920×1080 world) */
  x: number;
  y: number;
  /** 1 = the size characters have in a wide library scene */
  size?: number;
  facing?: "left" | "right";
  tod?: "day" | "dusk" | "night";
};

/** One library character, drawn at a place of your choice with an action of the library, on top of whatever is behind it. */
export function Actor({ id, action, expr = "neutral", x, y, size = 1, facing = "right", tod = "day" }: ActorProps) {
  const frame = useCurrentFrame();
  const shot = useShot();
  const view = useView();
  const cast: CastMember | undefined = shot.cast[id];
  if (!cast) throw new Error(`Actor: "${id}" is not in the cast (${Object.keys(shot.cast).join(", ")})`);
  const def = ACTION_LIB[action];
  const phase = hash01(`${shot.sceneId}-${id}`);
  const now = alive(def, frame, phase);
  const prev = alive(def, frame - 1, phase);
  return (
    <svg viewBox={`0 0 ${view.width} ${view.height}`} width={view.width} height={view.height} style={{ position: "absolute", inset: 0 }}>
      <g transform={`translate(${x} ${y}) scale(${size}) translate(${-x} ${-y})`}>
        <Figure
          pose={now.pose}
          prevPose={prev.pose}
          breath={now.breath}
          x={x}
          groundY={y}
          facing={facing === "right" ? 1 : -1}
          cast={cast}
          expr={def.face ?? expr}
          silhouette={false}
          blink={blink(frame, phase)}
          tod={tod}
          frame={frame}
          attachments={[]}
          fx={def.fx}
        />
      </g>
    </svg>
  );
}
