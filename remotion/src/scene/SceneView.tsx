import { ACTIONS, BACKGROUNDS, POSITIONS, type CastMember, type CharInScene, type PositionId, type Scene } from "@studio/schema";
import { useId } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ACTION_LIB } from "../library/actions";
import { BACKGROUND_LIB } from "../library/backgrounds";
import { CAMERAS, CameraContext, Layer, WIDE, clamp, type Base, type Cam } from "../library/camera";
import { GRADE_LIB, GradeOverlay } from "../library/grades";
import { InteriorContext } from "../library/prop-kit";
import { PROP_IMPL } from "../library/props";
import { WeatherBack, WeatherFront } from "../library/weather";
import { alive, blink } from "../rig/animate";
import { Figure, type Attachment } from "../rig/Figure";
import { lerpPose, type Pose } from "../rig/pose";
import { bodyOf, sizeOf } from "../rig/look";
import { solve, type Vec } from "../rig/skeleton";
import { arrivalFrame, travelled } from "../rig/stride";
import { H, W, hash01, type TimeOfDay } from "../theme";
import { portraitBase, portraitLayout } from "./portrait";
import { isPortrait, useView } from "./view";

const posX = (id: PositionId) => POSITIONS[id].x * W;
/** Where a named position is on the stage. A tall frame pulls the positions together (scene/portrait.ts). */
export type XOf = (id: PositionId) => number;
const ARRIVE_BLEND = 8; // frames to settle from a travelling action into idle

export type Placed = {
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

/** Seat height for a character at `pos` (chairs, beds, car seats). */
function seatAt(scene: Scene, pos: string): number {
  return scene.props.reduce((h, p) => {
    if (p.pos !== pos || p.attach) return h;
    const impl = PROP_IMPL[p.id];
    return Math.max(h, impl.seat ?? impl.surface ?? 0);
  }, 0);
}

/** Where a character is and what pose it is in at a frame of its scene. */
function place(char: CharInScene, cast: CastMember, scene: Scene, frame: number, groundY: number, inPlace = false, xOf: XOf = posX): Placed {
  const def = ACTION_LIB[char.action];
  const phase = hash01(`${scene.id}-${char.id}`);
  const body = bodyOf(cast);
  const size = sizeOf(cast);
  const startX = xOf(char.pos);
  const travels = ACTIONS[char.action].travels && !inPlace;

  let facing: 1 | -1 = char.facing ? (char.facing === "right" ? 1 : -1) : startX <= W / 2 ? 1 : -1;
  const dir = char.to ? Math.sign(xOf(char.to) - startX) || facing : facing;
  if (travels && !char.facing) facing = dir > 0 ? 1 : -1;
  const dist = char.to ? Math.abs(xOf(char.to) - startX) : Infinity;
  const arrival = travels ? arrivalFrame(def, body, size, dist, phase) : Infinity;

  // Travel distance comes from the legs (rig/stride.ts), so planted feet stay put.
  const at = (f: number) => {
    if (!travels) return { x: startX, arrivedFor: -1 };
    const x = startX + dir * Math.min(dist, travelled(def, body, size, f, phase));
    return { x, arrivedFor: f >= arrival ? f - arrival : -1 };
  };

  const poseAt = (f: number) => {
    const moving = alive(def, f, phase);
    const a = at(f);
    // A driver stays in the car on arrival; walkers settle into idle.
    if (!travels || a.arrivedFor < 0 || def.perch) return moving;
    const rest = alive(ACTION_LIB.idle, f, phase);
    const k = Math.min(1, a.arrivedFor / ARRIVE_BLEND);
    return { pose: lerpPose(moving.pose, rest.pose, k), breath: rest.breath };
  };

  const { pose, breath } = poseAt(frame);
  const prevPose = poseAt(frame - 1).pose;
  const x = at(frame).x;

  let y = groundY;
  if (def.perch) {
    // Hip on the seat, unless that would push long legs through the floor.
    const seat = seatAt(scene, char.pos);
    const j = solve(pose, breath, body);
    y = Math.min(groundY, groundY - seat - size * j.groundOffset);
  } else if (!travels) {
    // Standing, sitting or lying at the same spot as a surface prop (a bed).
    y = groundY - scene.props.reduce((h, p) => (p.pos === char.pos && !p.attach ? Math.max(h, PROP_IMPL[p.id].surface ?? 0) : h), 0);
  }

  return { char, cast, x, groundY: y, facing, pose, prevPose, breath, phase };
}

/** World-space position of a placed character's head and body centre. */
function anchors(p: Placed): { head: Vec; body: Vec } {
  const j = solve(p.pose, p.breath, bodyOf(p.cast));
  const s = sizeOf(p.cast);
  const wx = (v: Vec) => p.x + p.facing * s * v.x;
  const wy = (v: Vec) => p.groundY + s * (v.y + j.groundOffset);
  return {
    head: { x: wx(j.head), y: wy(j.head) },
    body: { x: wx(j.neck), y: (wy(j.head) + p.groundY) / 2 },
  };
}

type StageProps = {
  scene: Scene;
  placed: Placed[];
  groundY: number;
  horizonY: number;
  wallY: number;
  tod: TimeOfDay;
  frame: number;
  xOf?: XOf;
};

/**
 * The characters' plane: ground props, the characters, and props drawn in
 * front of the characters who use them. World coordinates (1920×1080).
 * SceneView puts it inside the camera; galleries draw it on their own.
 */
export function Stage({ scene, placed, groundY, horizonY, wallY, tod, frame, xOf = posX }: StageProps) {
  // A character "uses" a ground prop at its own pos: lies in the bed, sits on the chair, drives the car.
  const userOf = (pos: string | undefined) =>
    pos ? placed.find((p) => p.char.pos === pos && (ACTION_LIB[p.char.action].lying || ACTION_LIB[p.char.action].perch)) : undefined;
  const propArgs = (p: Scene["props"][number]) => {
    const impl = PROP_IMPL[p.id];
    const user = userOf(p.pos);
    let x = p.pos ? xOf(p.pos) : W * 0.72;
    if (user && impl.vehicle) x = user.x;
    else if (user && impl.besideSeat) x = user.x + user.facing * 175;
    return { x, groundY, horizonY, wallY, skyY: Math.min(260, horizonY - 260), tod, frame, flip: user ? user.facing === -1 : x > W / 2 };
  };
  const placedProps = scene.props.filter((p) => !p.attach);
  // In front of the characters: a blanket over a sleeper, a car body round its driver, a desk before a typist.
  const inFront = (p: Scene["props"][number]) => {
    const impl = PROP_IMPL[p.id];
    return !!userOf(p.pos) && (!!impl.front || !!impl.besideSeat);
  };
  return (
    <g>
      {placedProps.map((p, i) => (PROP_IMPL[p.id].besideSeat && inFront(p) ? null : <g key={`b${i}`}>{PROP_IMPL[p.id].placed?.(propArgs(p))}</g>))}
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
        if (!inFront(p)) return null;
        const impl = PROP_IMPL[p.id];
        return <g key={`f${i}`}>{impl.besideSeat ? impl.placed?.(propArgs(p)) : impl.front?.(propArgs(p))}</g>;
      })}
    </g>
  );
}

/** Places every character of a scene at a frame. `inPlace` keeps travellers on their spot (galleries). */
export function placeAll(scene: Scene, cast: Record<string, CastMember>, frame: number, groundY: number, inPlace = false, xOf: XOf = posX): Placed[] {
  return scene.chars.map((c) => place(inPlace ? { ...c, to: undefined } : c, cast[c.id]!, scene, frame, groundY, inPlace, xOf));
}

/**
 * The base view before the camera move: the whole frame (wide), or a
 * waist-up medium shot that fits every character (it follows them if they move).
 */
function baseView(framing: Scene["framing"], placed: Placed[], groundY: number): Base {
  if (framing !== "medium" || placed.length === 0) return WIDE;
  const xs = placed.map((p) => p.x);
  const tops = placed.map((p) => p.groundY - sizeOf(p.cast) * 300 * p.cast.height - 70);
  const bottoms = placed.map((p) => p.groundY - sizeOf(p.cast) * 185);
  const top = Math.min(...tops);
  const bottom = Math.max(...bottoms, top + 300);
  const spread = Math.max(...xs) - Math.min(...xs) + 440;
  const zoom = Math.max(1.25, Math.min(2.1, H / (bottom - top), W / spread));
  void groundY;
  return { zoom, f: clamp({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (top + bottom) / 2 }, zoom) };
}

export function SceneView({ scene, cast, frames }: { scene: Scene; cast: Record<string, CastMember>; frames: number }) {
  const frame = useCurrentFrame();
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const bg = BACKGROUND_LIB[scene.bg];
  const grade = GRADE_LIB[scene.grade];
  const tod = grade.tod;
  const interior = BACKGROUNDS[scene.bg].interior;

  const view = useView();
  const portrait = isPortrait(view);
  const layout = portrait ? portraitLayout(scene) : undefined;
  const placed = placeAll(scene, cast, frame, bg.groundY, false, layout?.xOf);
  const marks = placed.map(anchors);
  const chars: Vec = marks.length
    ? { x: marks.reduce((s, m) => s + m.body.x, 0) / marks.length, y: marks.reduce((s, m) => s + m.body.y, 0) / marks.length }
    : { x: W / 2, y: H / 2 };
  const face = marks[0]?.head ?? chars;
  const base = layout ? portraitBase(scene, cast, layout, placed.map((p) => p.x), bg.groundY) : baseView(scene.framing, placed, bg.groundY);
  const move = CAMERAS[scene.camera](frame, frames, { chars, face }, base, view);
  const cam: Cam = portrait ? { ...move, base, view } : move;

  return (
    <AbsoluteFill style={{ filter: grade.filter }}>
      <svg viewBox={`0 0 ${view.width} ${view.height}`} width={view.width} height={view.height} style={{ position: "absolute", inset: 0 }}>
        {cam.blur > 0.5 && (
          <defs>
            <filter id={`${gid}-whip`} x="-5%" y="0" width="110%" height="100%">
              <feGaussianBlur stdDeviation={`${cam.blur.toFixed(1)} 0`} />
            </filter>
          </defs>
        )}
        <g filter={cam.blur > 0.5 ? `url(#${gid}-whip)` : undefined}>
          <CameraContext.Provider value={cam}>
            <InteriorContext.Provider value={interior}>
              <bg.Back tod={tod} frame={frame} />
              {scene.weather && <WeatherBack kind={scene.weather} frame={frame} tod={tod} groundY={bg.groundY} />}
              <Layer depth={1}>
                <Stage scene={scene} placed={placed} groundY={bg.groundY} horizonY={bg.horizonY} wallY={bg.wallY} tod={tod} frame={frame} xOf={layout?.xOf} />
              </Layer>
              {bg.Front && <bg.Front tod={tod} frame={frame} />}
              {scene.weather && <WeatherFront kind={scene.weather} frame={frame} tod={tod} groundY={bg.groundY} />}
            </InteriorContext.Provider>
          </CameraContext.Provider>
        </g>
      </svg>
      <GradeOverlay grade={scene.grade} interior={interior} />
    </AbsoluteFill>
  );
}
