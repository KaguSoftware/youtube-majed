import { ACTIONS, POSITIONS, type CastMember, type CharInScene, type Scene } from "@studio/schema";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ACTION_LIB } from "../library/actions";
import { BACKGROUND_LIB } from "../library/backgrounds";
import { CAMERAS, CameraContext, Layer, type Cam } from "../library/camera";
import { GRADE_LIB, GradeOverlay } from "../library/grades";
import { PROP_IMPL } from "../library/props";
import { alive, blink } from "../rig/animate";
import { Figure, type Attachment } from "../rig/Figure";
import { lerpPose, type Pose } from "../rig/pose";
import { solve, type Vec } from "../rig/skeleton";
import { FIGURE_SCALE, FPS, H, W, hash01 } from "../theme";

const posX = (id: keyof typeof POSITIONS) => POSITIONS[id].x * W;
const ARRIVE_BLEND = 8; // frames to settle from a travelling action into idle

type Placed = {
  char: CharInScene;
  cast: CastMember;
  x: number;
  groundY: number;
  facing: 1 | -1;
  pose: Pose;
  prevPose: Pose;
  breath: number;
  phase: number;
};

/** Where a character is and what pose it is in at a frame of its scene. */
function place(char: CharInScene, cast: CastMember, scene: Scene, frame: number, groundY: number): Placed {
  const def = ACTION_LIB[char.action];
  const phase = hash01(`${scene.id}-${char.id}`);
  const startX = posX(char.pos);
  const travels = ACTIONS[char.action].travels;

  let x = startX;
  let facing: 1 | -1 = char.facing ? (char.facing === "right" ? 1 : -1) : startX <= W / 2 ? 1 : -1;

  const at = (f: number) => {
    if (!travels) return { x: startX, arrivedFor: -1 };
    const speed = def.speed ?? 200;
    const dir = char.to ? Math.sign(posX(char.to) - startX) || facing : facing;
    const dist = char.to ? Math.abs(posX(char.to) - startX) : Infinity;
    const travelled = Math.min(dist, (Math.max(0, f) / FPS) * speed);
    const arrivalFrame = (dist / speed) * FPS;
    return { x: startX + dir * travelled, arrivedFor: f >= arrivalFrame ? f - arrivalFrame : -1, dir };
  };

  if (travels) {
    const now = at(frame);
    x = now.x;
    if (!char.facing && now.dir) facing = now.dir > 0 ? 1 : -1;
  }

  const poseAt = (f: number) => {
    const moving = alive(def, f, phase);
    const a = at(f);
    if (!travels || a.arrivedFor < 0) return moving;
    const rest = alive(ACTION_LIB.idle, f, phase);
    const k = Math.min(1, a.arrivedFor / ARRIVE_BLEND);
    return { pose: lerpPose(moving.pose, rest.pose, k), breath: rest.breath };
  };

  const { pose, breath } = poseAt(frame);
  const prevPose = poseAt(frame - 1).pose;

  // Standing at the same spot as a surface prop (a bed): stand, sit or lie on it.
  const surface = scene.props.reduce((h, p) => (p.pos === char.pos && !travels ? Math.max(h, PROP_IMPL[p.id].surface ?? 0) : h), 0);

  return { char, cast, x, groundY: groundY - surface, facing, pose, prevPose, breath, phase };
}

/** World-space position of a placed character's head and body centre. */
function anchors(p: Placed): { head: Vec; body: Vec } {
  const j = solve(p.pose, p.breath);
  const s = p.cast.scale * FIGURE_SCALE;
  const wx = (v: Vec) => p.x + p.facing * s * v.x;
  const wy = (v: Vec) => p.groundY + s * (v.y + j.groundOffset);
  return {
    head: { x: wx(j.head), y: wy(j.head) },
    body: { x: wx(j.neck), y: (wy(j.head) + p.groundY) / 2 },
  };
}

export function SceneView({ scene, cast, frames }: { scene: Scene; cast: Record<string, CastMember>; frames: number }) {
  const frame = useCurrentFrame();
  const bg = BACKGROUND_LIB[scene.bg];
  const tod = GRADE_LIB[scene.grade].tod;

  const placed = scene.chars.map((c) => place(c, cast[c.id]!, scene, frame, bg.groundY));
  const marks = placed.map(anchors);
  const chars: Vec = marks.length
    ? { x: marks.reduce((s, m) => s + m.body.x, 0) / marks.length, y: marks.reduce((s, m) => s + m.body.y, 0) / marks.length }
    : { x: W / 2, y: H / 2 };
  const face = marks[0]?.head ?? chars;
  const cam: Cam = CAMERAS[scene.camera](frame, frames, { chars, face });

  const lyingOn = (pos: string) => placed.find((p) => p.char.pos === pos && ACTION_LIB[p.char.action].lying);
  const propArgs = (p: Scene["props"][number]) => {
    const sleeper = p.pos ? lyingOn(p.pos) : undefined;
    const x = p.pos ? posX(p.pos) : W * 0.72;
    return { x, groundY: bg.groundY, horizonY: bg.horizonY, wallY: bg.wallY, tod, frame, flip: sleeper ? sleeper.facing === -1 : x > W / 2 };
  };
  const placedProps = scene.props.filter((p) => !p.attach);

  return (
    <AbsoluteFill>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <CameraContext.Provider value={cam}>
          <bg.Back tod={tod} frame={frame} />
          <Layer depth={1}>
            {placedProps.map((p, i) => <g key={`b${i}`}>{PROP_IMPL[p.id].placed?.(propArgs(p))}</g>)}
            {placed.map((p) => {
              const def = ACTION_LIB[p.char.action];
              const attachments: Attachment[] = scene.props
                .filter((pr) => pr.attach?.startsWith(`${p.char.id}.`))
                .map((pr) => ({ point: pr.attach!.split(".")[1] as Attachment["point"], prop: pr.id }));
              return (
                <Figure
                  key={p.char.id}
                  pose={p.pose}
                  prevPose={p.prevPose}
                  breath={p.breath}
                  x={p.x}
                  groundY={p.groundY}
                  facing={p.facing}
                  cast={p.cast}
                  expr={def.face ?? p.char.expr}
                  silhouette={p.char.look === "silhouette"}
                  blink={blink(frame, p.phase)}
                  tod={tod}
                  frame={frame}
                  attachments={attachments}
                  fx={def.fx}
                />
              );
            })}
            {placedProps.map((p, i) => {
              const front = PROP_IMPL[p.id].front;
              return front && p.pos && lyingOn(p.pos) ? <g key={`f${i}`}>{front(propArgs(p))}</g> : null;
            })}
          </Layer>
          {bg.Front && <bg.Front tod={tod} frame={frame} />}
        </CameraContext.Provider>
      </svg>
      <GradeOverlay grade={scene.grade} />
    </AbsoluteFill>
  );
}
