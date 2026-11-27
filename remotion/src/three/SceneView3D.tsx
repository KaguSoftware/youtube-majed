import { ACTIONS, BACKGROUNDS, POSITIONS, PROPS, type CastMember, type LowPolyBackgroundId, type LowPolyPropId, type PositionId, type Scene } from "@studio/schema";
import { ThreeCanvas } from "@remotion/three";
import { useId, type ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import * as THREE from "three";
import { ACTION_LIB } from "../library/actions";
import { BACKGROUND_LIB } from "../library/backgrounds";
import { CAMERAS, type Cam } from "../library/camera";
import { GRADE_LIB, GradeOverlay } from "../library/grades";
import { PROP_IMPL } from "../library/props";
import { blink as blinkAt } from "../rig/animate";
import { anchors, baseView, placeAll, type Placed } from "../scene/SceneView";
import { portraitBase, portraitLayout } from "../scene/portrait";
import { isPortrait, useView } from "../scene/view";
import { W } from "../theme";
import { tweakOf } from "./actions3d";
import { CameraRig, camPose } from "./camera3d";
import { Figure3D } from "./Figure3D";
import { G, Ink, flat } from "./kit";
import { Fx3D } from "./fx3d";
import { Lights, lightRig } from "./lighting";
import { look3d } from "./looks3d";
import { PROPS3D } from "./props3d";
import type { Placed3DArgs } from "./props3d/types";
import { jointsOf, rigOf } from "./rig3d";
import { SETS } from "./sets";
import { PX, RAD, wx } from "./world";

/**
 * A scene in the low-poly style (docs/PLAN.md section 6). Same scene JSON as
 * SceneView: where everyone stands, travels and sits is worked out by the
 * stick style's own code (placeAll, the 9:16 re-layout), and so is the
 * camera move, so a scene switched between styles keeps its staging. Only the
 * drawing is new: Three.js figures, props and sets, lit for the grade, with
 * the grade's wash and vignette over the top as in 2D.
 */

type Props = { scene: Scene; cast: Record<string, CastMember>; frames: number };

/** The figure's turn about y: facing right is +x, turned `turn` degrees toward the camera. */
const yawOf = (facing: 1 | -1, turn: number) => facing * (90 - turn) * RAD;

export function SceneView3D({ scene, cast, frames }: Props) {
  const frame = useCurrentFrame();
  const view = useView();
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const bg = BACKGROUND_LIB[scene.bg];
  const set = SETS[scene.bg as LowPolyBackgroundId];
  const grade = GRADE_LIB[scene.grade];
  const tod = grade.tod;
  const interior = BACKGROUNDS[scene.bg].interior;
  const light = lightRig(scene.grade, interior);

  // staging and camera: the stick style's, unchanged
  const portrait = isPortrait(view);
  const layout = portrait ? portraitLayout(scene) : undefined;
  const placed = placeAll(scene, cast, frame, bg.groundY, false, layout?.xOf);
  const marks = placed.map(anchors);
  const chars = marks.length
    ? { x: marks.reduce((s, m) => s + m.body.x, 0) / marks.length, y: marks.reduce((s, m) => s + m.body.y, 0) / marks.length }
    : { x: W / 2, y: bg.groundY - 300 };
  const face = marks[0]?.head ?? chars;
  const base = layout ? portraitBase(scene, cast, layout, placed.map((p) => p.x), bg.groundY) : baseView(scene.framing, placed, bg.groundY);
  const cam: Cam = CAMERAS[scene.camera](frame, frames, { chars, face }, base, view);
  const pose = camPose(cam, view, bg.groundY);

  const xOf = layout?.xOf ?? ((id: PositionId) => POSITIONS[id].x * W);
  const figures = placed.map((p) => figureOf(p, scene, frame, bg.groundY));
  const props = scene.props.map((pr, i) => propOf(pr, i, placed, figures, xOf, { tod, frame, light, set }, bg));

  return (
    <AbsoluteFill style={{ filter: grade.filter }}>
      {cam.blur > 0.5 && (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id={`${gid}-whip`} x="-5%" y="0" width="110%" height="100%">
            <feGaussianBlur stdDeviation={`${cam.blur.toFixed(1)} 0`} />
          </filter>
        </svg>
      )}
      <AbsoluteFill style={{ filter: cam.blur > 0.5 ? `url(#${gid}-whip)` : undefined }}>
        <ThreeCanvas
          width={view.width}
          height={view.height}
          shadows="percentage"
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NeutralToneMapping;
            gl.toneMappingExposure = 1.05;
          }}
        >
          <CameraRig pose={pose} aspect={view.width / view.height} />
          <Lights rig={light} frame={frame} flicker={grade.flicker} />
          <set.Set tod={tod} grade={scene.grade} frame={frame} light={light} />
          {props.map((p) => p.node)}
          {figures.map((f) => f.node)}
        </ThreeCanvas>
      </AbsoluteFill>
      <GradeOverlay grade={scene.grade} interior={interior} />
    </AbsoluteFill>
  );
}

type Figure = { placed: Placed; x: number; y: number; yaw: number; joints: ReturnType<typeof jointsOf>; node: ReactNode; prevHand: THREE.Vector3 };

function figureOf(p: Placed, scene: Scene, frame: number, groundY: number): Figure {
  const t = tweakOf(p.char.action);
  const def = ACTION_LIB[p.char.action];
  const camSide = (p.facing === 1 ? -1 : 1) as 1 | -1;
  const rig = rigOf(p.pose, p.breath, p.cast, camSide, t);
  const prevRig = rigOf(p.prevPose, p.breath, p.cast, camSide, t);
  const x = wx(p.x);
  const y = (groundY - p.groundY) / PX;
  const yaw = yawOf(p.facing, t.turn);
  const look = look3d(p.cast, p.char.look === "silhouette");
  const joints = jointsOf(rig);
  const prevHand = jointsOf(prevRig).handF;
  const speed = ACTIONS[p.char.action].travels ? (def.speed ?? 200) / PX : 0;
  const node = (
    <group key={p.char.id}>
      {/* a soft contact shadow on the floor under the figure, whatever it stands, sits or lies on */}
      <mesh geometry={G.circle(0.5, 18)} material={flat("#0b0a14", { opacity: 0.22 })} position={[x, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[def.lying ? 1.8 : 0.85 * p.cast.scale, (def.lying ? 0.9 : 0.55) * p.cast.scale, 1]} renderOrder={1} />
      <group position={[x, y, 0]} rotation={[0, yaw, 0]}>
        <Ink style={look.neon ? { width: 0.01, color: look.accent } : { width: 0.013 * p.cast.scale, color: "#15131f" }}>
          <Figure3D rig={rig} cast={p.cast} look={look} expr={def.face ?? p.char.expr} blink={blinkAt(frame, p.phase)} frame={frame} speed={speed} />
        </Ink>
        {def.fx && <Fx3D kind={def.fx} head={joints.head} frame={frame} phase={p.phase} />}
      </group>
    </group>
  );
  return { placed: p, x, y, yaw, joints, node, prevHand };
}

/** Props take a thinner ink line than characters, as in the stick style. */
const PROP_INK = { width: 0.009, color: "#15131f" };

type Ctx = { tod: Placed3DArgs["tod"]; frame: number; light: Placed3DArgs["light"]; set: Placed3DArgs["set"] };

/** Far props (a ship on the horizon, a plane in the sky) keep their 2D screen x: x grows with distance. */
const farX = (x: number, z: number) => x * ((9.4 - z) / 9.4);

function propOf(pr: Scene["props"][number], i: number, placed: Placed[], figures: Figure[], xOf: (id: PositionId) => number, ctx: Ctx, bg: { groundY: number; wallY: number }): { node: ReactNode } {
  const impl = PROPS3D[pr.id as LowPolyPropId];
  const key = `${pr.id}-${i}`;
  if (pr.attach) {
    const [owner, point] = pr.attach.split(".") as [string, "hand_r" | "hand_l" | "head"];
    const f = figures.find((g) => g.placed.char.id === owner);
    if (!f || !impl.held) return { node: null };
    const at = point === "hand_r" ? f.joints.handF : point === "hand_l" ? f.joints.handB : f.joints.head.clone().add(new THREE.Vector3(0, f.placed.cast.scale * 0.2, 0));
    const swing = point === "hand_r" ? at.x - f.prevHand.x : 0;
    return {
      node: (
        <group key={key} position={[f.x, f.y, 0]} rotation={[0, f.yaw, 0]}>
          <group position={at}>
            <Ink style={PROP_INK}>{impl.held({ point, action: f.placed.char.action, swing, ...ctx })}</Ink>
          </group>
        </group>
      ),
    };
  }
  if (!impl.placed) return { node: null };
  // a ground prop a character uses at its spot (lies in the bed, sits on the chair, drives the car) takes their place and turn
  const userIdx = placed.findIndex((p) => p.char.pos === pr.pos && (ACTION_LIB[p.char.action].lying || ACTION_LIB[p.char.action].perch));
  const user = userIdx >= 0 ? figures[userIdx] : undefined;
  const p2d = PROP_IMPL[pr.id];
  let x = pr.pos ? wx(xOf(pr.pos)) : wx(W * 0.72);
  // props are modelled facing +x (a seat's sitter, a car's front); a used prop turns to face where its user faces
  let yaw = 0;
  let flip = x > 0;
  if (user) {
    yaw = user.yaw - Math.PI / 2;
    flip = false;
    if (p2d.vehicle) x = user.x;
    else if (p2d.besideSeat) {
      x = user.x + (user.placed.facing * 175) / PX;
      yaw = 0;
      flip = user.placed.facing === -1;
    }
  }
  const placement = PROPS[pr.id].placement;
  let at: [number, number, number] = [x, 0, user ? 0 : (impl.z ?? -0.55)];
  if (placement === "wall") at = [x, (bg.groundY - bg.wallY) / PX, ctx.set.wallZ];
  else if (placement === "horizon") at = [farX(x, ctx.set.horizon?.z ?? -40), ctx.set.horizon?.y ?? 0, ctx.set.horizon?.z ?? -40];
  else if (placement === "sky") at = [farX(x, -30), ctx.set.skyY ?? 14, -30];
  return {
    node: (
      <group key={key} position={at} rotation={[0, yaw, 0]} scale={[flip ? -1 : 1, 1, 1]}>
        <Ink style={placement === "horizon" || placement === "sky" ? null : PROP_INK}>{impl.placed({ used: !!user, flip, ...ctx })}</Ink>
      </group>
    ),
  };
}
