import type { AttachPointId, CastMember, ExpressionId, OutfitId, PropId } from "@studio/schema";
import { useId, type ReactNode } from "react";
import { HELD } from "../library/props";
import { ACCENT, FIGURE_SCALE, HALO, INK, PAPER, mix, type TimeOfDay } from "../theme";
import { FACES } from "./faces";
import { HATS, type Paint } from "./hats";
import { Beard, FaceFeatures, HairBack, HairFront, type HairPaint } from "./head";
import { bodyOf, lookOf, sizeOf, type Look } from "./look";
import type { Pose } from "./pose";
import { solve, type Body, type Joints, type Vec } from "./skeleton";

export type Attachment = { point: AttachPointId; prop: PropId };

export type FigureProps = {
  pose: Pose;
  /** Pose one frame earlier: drives the swing of held props and capes. */
  prevPose: Pose;
  breath: number;
  x: number;
  groundY: number;
  facing: 1 | -1;
  cast: CastMember;
  expr: ExpressionId;
  silhouette: boolean;
  blink: number;
  tod: TimeOfDay;
  frame: number;
  attachments: Attachment[];
  fx?: "zzz" | "sweat" | "speed" | "steam";
};

const pts = (...p: Vec[]) => p.map((v, i) => `${i ? "L" : "M"} ${v.x.toFixed(2)} ${v.y.toFixed(2)}`).join(" ");
const poly = (p: Vec[]) => `${pts(...p)} Z`;
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const len = (a: Vec) => Math.hypot(a.x, a.y) || 1;
const unit = (a: Vec) => mul(a, 1 / len(a));

/** Convex hull (monotone chain): keeps cloth shapes from folding over themselves. */
function hull(points: Vec[]): Vec[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [];
  for (const v of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, v) <= 0) lower.pop();
    lower.push(v);
  }
  const upper: Vec[] = [];
  for (const v of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, v) <= 0) upper.pop();
    upper.push(v);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const HALO_COLOR: Record<TimeOfDay, string> = {
  day: "rgba(251,244,230,0.9)",
  dusk: "rgba(255,236,214,0.75)",
  night: "rgba(200,212,255,0.4)",
};

/** Spine frame: u runs up the spine (hip → neck), n points forward (the facing side). */
function spineFrame(j: Joints) {
  const u = unit(sub(j.neck, j.hip));
  const n: Vec = { x: -u.y, y: u.x };
  return { u, n, T: len(sub(j.neck, j.hip)) };
}

/** Clothing in the accent colour. `layer` is "back" (behind the body) or "front". */
function Outfit({ outfit, j, prev, look, frame, layer }: { outfit: OutfitId; j: Joints; prev: Joints; look: Look; frame: number; layer: "back" | "front" }): ReactNode {
  if (outfit === "none") return null;
  const { u, n, T } = spineFrame(j);
  const fill = look.silhouette ? INK : look.neon ? look.paper : look.accent;
  const deep = look.silhouette ? INK : look.neon ? look.paper : mix(look.accent, "#000000", 0.25);
  const stroke = { stroke: look.ink, strokeWidth: Math.max(3, look.w * 0.36), strokeLinejoin: "round" as const };
  const speed = Math.max(-1, Math.min(1, (j.hip.x - prev.hip.x) / 6));
  const flutter = Math.sin(frame / 4.3) * 5 + Math.sin(frame / 2.7) * 2;
  const at = (alongSpine: number, forward: number) => add(add(j.neck, mul(u, -alongSpine)), mul(n, forward));

  if (layer === "back") {
    if (outfit === "cape") {
      const top1 = add(j.shoulder, mul(n, 4));
      const top2 = add(j.shoulder, mul(n, -12));
      const drop = mul(u, -(T * 1.05));
      const trail = mul(n, -(26 + 30 * Math.abs(speed) + flutter));
      const b1 = add(add(add(j.shoulder, drop), trail), mul(n, -26));
      const b2 = add(add(j.shoulder, drop), mul(n, -6));
      return <path d={`M ${top1.x} ${top1.y} L ${top2.x} ${top2.y} Q ${b1.x + 10} ${(top2.y + b1.y) / 2} ${b1.x} ${b1.y} L ${b2.x} ${b2.y} Z`} fill={deep} {...stroke} />;
    }
    if (outfit === "backpack") {
      const c = at(T * 0.42, -look.w * 0.5 - 14);
      const hu = mul(u, 30);
      const hn = mul(n, 15);
      const box = [add(add(c, hu), hn), add(sub(c, hn), hu), sub(sub(c, hu), hn), add(sub(c, hu), hn)];
      const pocket = [add(sub(c, mul(n, 15)), mul(u, -4)), add(sub(c, mul(n, 22)), mul(u, -4)), add(sub(c, mul(n, 22)), mul(u, -24)), add(sub(c, mul(n, 15)), mul(u, -24))];
      return (
        <g>
          <path d={poly(box)} fill={fill} {...stroke} />
          <path d={poly(pocket)} fill={deep} {...stroke} strokeWidth={stroke.strokeWidth * 0.8} />
        </g>
      );
    }
    if (outfit === "scarf") {
      const root = at(8, -8);
      const tip = add(add(root, mul(n, -(34 + 26 * Math.abs(speed)))), mul(u, -(26 - flutter)));
      const tip2 = add(tip, mul(u, -12));
      const root2 = add(root, mul(u, -12));
      return <path d={`M ${root.x} ${root.y} Q ${(root.x + tip.x) / 2} ${(root.y + tip.y) / 2 + flutter} ${tip.x} ${tip.y} L ${tip2.x} ${tip2.y} Q ${(root2.x + tip2.x) / 2} ${(root2.y + tip2.y) / 2 + flutter} ${root2.x} ${root2.y} Z`} fill={deep} {...stroke} />;
    }
    return null;
  }

  if (outfit === "tie") {
    const k1 = at(5, -4.5);
    const k2 = at(5, 4.5);
    const k3 = at(14, 3.5);
    const k4 = at(14, -3.5);
    const b1 = at(T * 0.46, 7);
    const tip = at(T * 0.55, 0);
    const b2 = at(T * 0.46, -7);
    return (
      <g>
        <path d={poly([k4, k3, b1, tip, b2])} fill={deep} {...stroke} />
        <path d={poly([k1, k2, k3, k4])} fill={fill} {...stroke} />
      </g>
    );
  }
  if (outfit === "scarf") {
    const band = [at(1, -15), at(1, 15), at(14, 15), at(14, -15)];
    return <path d={poly(band)} fill={fill} {...stroke} />;
  }
  if (outfit === "dress") {
    const waist = at(T * 0.58, 0);
    const hemF = lerp(j.hip, j.kneeF, 0.72);
    const hemB = lerp(j.hip, j.kneeB, 0.72);
    const mid = lerp(hemF, hemB, 0.5);
    const v = unit(sub(mid, j.hip));
    const q: Vec = { x: -v.y, y: v.x };
    const half = Math.max(30, len(sub(hemF, hemB)) / 2 + 16);
    const shape = hull([add(waist, mul(n, 13)), add(waist, mul(n, -13)), add(mid, mul(q, half)), add(mid, mul(q, -half)), add(j.hip, mul(n, 22)), add(j.hip, mul(n, -22))]);
    return (
      <g>
        <path d={poly(shape)} fill={fill} {...stroke} />
        <path d={pts(add(waist, mul(n, 13)), add(waist, mul(n, -13)))} stroke={deep} strokeWidth={6} strokeLinecap="round" />
      </g>
    );
  }
  if (outfit === "backpack") {
    const a = at(2, -6);
    const b = at(T * 0.5, look.w * 0.4);
    return <path d={`M ${a.x} ${a.y} Q ${a.x + n.x * 14} ${a.y + n.y * 14} ${b.x} ${b.y}`} fill="none" stroke={deep} strokeWidth={6} strokeLinecap="round" />;
  }
  return null;
}

export function Figure(props: FigureProps) {
  const { pose, prevPose, breath, x, groundY, facing, cast, expr, silhouette, blink, tod, frame, attachments, fx } = props;
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const body: Body = bodyOf(cast);
  const j = solve(pose, breath, body);
  const prev = solve(prevPose, breath, body);
  const look = lookOf(cast, tod, silhouette);
  const s = sizeOf(cast);
  const w = look.w;
  const sx = 1 - pose.squash * 0.5;
  const sy = 1 + pose.squash;
  const handR = (5 * FIGURE_SCALE) / s + w * 0.62;

  const paint: Paint = { ink: look.ink, dark: look.dark, accent: look.accent, sil: look.silhouette, neon: look.neon };
  const hairPaint: HairPaint = { ...paint, hair: look.hair };

  const limb = { fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const armB = pts(j.shoulder, j.elbowB, j.handB);
  const legB = pts(j.hip, j.kneeB, j.ankleB, j.toeB);
  const spine = pts(j.hip, j.neck);
  const legF = pts(j.hip, j.kneeF, j.ankleF, j.toeF);
  const armF = pts(j.shoulder, j.elbowF, j.handF);

  const at = (point: AttachPointId) => (point === "hand_r" ? j.handF : point === "hand_l" ? j.handB : j.head);
  const was = (point: AttachPointId) => (point === "hand_r" ? prev.handF : point === "hand_l" ? prev.handB : prev.head);
  const held = (a: Attachment) => {
    const draw = HELD[a.prop];
    if (!draw) return null;
    const p = a.point === "head" ? add(j.head, { x: 0, y: -body.headR }) : at(a.point);
    const v = p.x - was(a.point).x;
    const swing = Math.max(-35, Math.min(35, -v * 2.2 + Math.sin(frame / 9) * 3));
    return <g key={`${a.point}-${a.prop}`}>{draw({ at: p, swing, tod, frame, point: a.point, facing })}</g>;
  };
  const glows = attachments.filter((a) => a.prop === "lantern" && tod !== "day");

  const { u, n, T } = spineFrame(j);
  const bellyC = add(add(j.hip, mul(u, T * 0.4)), mul(n, 9));
  const bellyAngle = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  const belly = look.belly ? (
    <ellipse cx={bellyC.x} cy={bellyC.y} rx={T * 0.37} ry={31} transform={`rotate(${bellyAngle.toFixed(2)} ${bellyC.x.toFixed(2)} ${bellyC.y.toFixed(2)})`} fill={look.silhouette ? INK : look.neon ? look.paper : look.accent} stroke={look.ink} strokeWidth={w * 0.85} />
  ) : null;
  const bellyOutline = look.belly ? <ellipse cx={bellyC.x} cy={bellyC.y} rx={T * 0.37} ry={31} transform={`rotate(${bellyAngle.toFixed(2)} ${bellyC.x.toFixed(2)} ${bellyC.y.toFixed(2)})`} /> : null;

  /** Hands: solid round fists a little wider than the arm line (hollow rings read as loops). */
  const hand = (v: Vec, back: boolean) =>
    look.neon ? (
      <circle cx={v.x} cy={v.y} r={handR * 0.9} fill={look.paper} stroke={back ? look.back : look.ink} strokeWidth={Math.max(3, w * 0.55)} />
    ) : (
      <circle cx={v.x} cy={v.y} r={handR} fill={back ? look.back : look.ink} />
    );

  const headScale = body.headR / 34;
  const face = FACES[expr];
  const core = mix(look.ink, "#ffffff", 0.62);

  return (
    <g transform={`translate(${x.toFixed(2)} ${groundY}) scale(${(facing * s * sx).toFixed(4)} ${(s * sy).toFixed(4)})`}>
      <g transform={`translate(0 ${j.groundOffset.toFixed(2)})`}>
        {glows.map((a) => {
          const p = at(a.point);
          return (
            <g key={`glow-${a.point}`}>
              <defs>
                <radialGradient id={`${gid}-glow`}>
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={tod === "night" ? 0.42 : 0.28} />
                  <stop offset="45%" stopColor={ACCENT} stopOpacity={tod === "night" ? 0.16 : 0.1} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                </radialGradient>
              </defs>
              <circle cx={p.x} cy={p.y + 40} r={260 + Math.sin(frame * 0.7) * 6} fill={`url(#${gid}-glow)`} />
            </g>
          );
        })}

        {look.neon ? (
          /* neon: a blurred glow in the line colour instead of the paper halo */
          <g>
            <defs>
              <filter id={`${gid}-neon`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation={9} />
              </filter>
            </defs>
            <g stroke={look.ink} strokeWidth={w * 2.4} opacity={0.9} filter={`url(#${gid}-neon)`} {...limb}>
              <path d={armB} />
              <path d={legB} />
              <path d={spine} />
              <path d={legF} />
              <path d={armF} />
              <circle cx={j.head.x} cy={j.head.y} r={body.headR} />
              {bellyOutline}
            </g>
          </g>
        ) : (
          /* halo: one wide light stroke under everything, for a clean silhouette on any background */
          <g stroke={HALO_COLOR[tod]} strokeWidth={w + (HALO * 2 * FIGURE_SCALE) / s} {...limb}>
            <path d={armB} />
            <path d={legB} />
            <path d={spine} />
            <path d={legF} />
            <path d={armF} />
            <circle cx={j.head.x} cy={j.head.y} r={body.headR} />
            <circle cx={j.handF.x} cy={j.handF.y} r={handR} />
            <circle cx={j.handB.x} cy={j.handB.y} r={handR} />
            {bellyOutline}
          </g>
        )}

        <Outfit outfit={cast.outfit} j={j} prev={prev} look={look} frame={frame} layer="back" />
        {attachments.filter((a) => a.point === "hand_l").map(held)}
        <path d={armB} stroke={look.back} strokeWidth={w} {...limb} />
        {hand(j.handB, true)}
        <path d={legB} stroke={look.back} strokeWidth={w} {...limb} />
        <path d={spine} stroke={look.ink} strokeWidth={w} {...limb} />
        <path d={legF} stroke={look.ink} strokeWidth={w} {...limb} />
        {belly}
        <Outfit outfit={cast.outfit} j={j} prev={prev} look={look} frame={frame} layer="front" />

        <g transform={`translate(${j.head.x.toFixed(2)} ${j.head.y.toFixed(2)}) rotate(${j.headAngle.toFixed(2)}) scale(${headScale.toFixed(4)})`} color={look.ink}>
          <HairBack hair={cast.hair} p={hairPaint} frame={frame} />
          <circle r={34} fill={look.paper} stroke={look.ink} strokeWidth={(w * 0.9) / headScale} />
          {cast.beard !== "none" && <Beard beard={cast.beard} gaze={pose.gaze} p={hairPaint} />}
          {!look.silhouette && face({ gaze: pose.gaze, blink, mouth: pose.mouth, frame, paper: look.neon ? look.paper : PAPER })}
          <FaceFeatures features={cast.face} gaze={pose.gaze} p={paint} />
          <HairFront hair={cast.hair} p={hairPaint} />
          {HATS[cast.hat](paint)}
        </g>

        {attachments.filter((a) => a.point !== "hand_l").map(held)}
        <path d={armF} stroke={look.ink} strokeWidth={w} {...limb} />
        {hand(j.handF, false)}

        {look.neon && (
          <g stroke={core} strokeWidth={Math.max(2, w * 0.3)} opacity={0.85} {...limb}>
            <path d={legB} opacity={0.5} />
            <path d={spine} />
            <path d={legF} />
            <path d={armF} />
          </g>
        )}

        {fx === "zzz" && <Zzz head={j.head} frame={frame} />}
        {fx === "sweat" && <Sweat head={j.head} frame={frame} />}
        {fx === "speed" && <Speed hip={j.hip} frame={frame} />}
        {fx === "steam" && <Steam head={j.head} frame={frame} />}
      </g>
    </g>
  );
}

function Zzz({ head, frame }: { head: Vec; frame: number }) {
  return (
    <g fontFamily="Fredoka, sans-serif" fontWeight={700} fill={PAPER} stroke={INK} strokeWidth={3} paintOrder="stroke">
      {[0, 1, 2].map((i) => {
        const t = ((frame + i * 25) % 75) / 75;
        return (
          <text key={i} x={head.x + 20 + t * 50} y={head.y - 40 - t * 110} fontSize={22 + t * 26} opacity={Math.sin(t * Math.PI)}>
            Z
          </text>
        );
      })}
    </g>
  );
}

function Sweat({ head, frame }: { head: Vec; frame: number }) {
  return (
    <g>
      {[0, 1, 2, 3].map((i) => {
        const t = ((frame + i * 6) % 24) / 24;
        const dir = i % 2 ? 1 : -1;
        const dx = head.x + dir * (40 + t * 50);
        const dy = head.y - 30 - Math.sin(t * Math.PI) * 40 + t * 30;
        return <path key={i} d={`M ${dx} ${dy - 8} Q ${dx - 5} ${dy + 1} ${dx} ${dy + 4} Q ${dx + 5} ${dy + 1} ${dx} ${dy - 8} Z`} fill="#8fd0f0" stroke={INK} strokeWidth={2.5} opacity={1 - t} />;
      })}
    </g>
  );
}

/** Anger: puffs of steam shooting from both sides of the head. */
function Steam({ head, frame }: { head: Vec; frame: number }) {
  return (
    <g fill="#ffffff" stroke={INK} strokeWidth={3}>
      {[0, 1, 2, 3].map((i) => {
        const t = ((frame + i * 5) % 20) / 20;
        const side = i % 2 ? 1 : -1;
        const x = head.x + side * (34 + t * 46);
        const y = head.y - 26 - t * 40;
        return <circle key={i} cx={x} cy={y} r={6 + t * 12} opacity={1 - t} />;
      })}
    </g>
  );
}

function Speed({ hip, frame }: { hip: Vec; frame: number }) {
  return (
    <g stroke={INK} strokeWidth={5} strokeLinecap="round" opacity={0.35}>
      {[-90, -40, 10].map((dy, i) => {
        const o = ((frame * 23 + i * 37) % 60) - 30;
        return <path key={i} d={`M ${-90 + o} ${hip.y + dy} L ${-170 + o} ${hip.y + dy}`} />;
      })}
    </g>
  );
}
