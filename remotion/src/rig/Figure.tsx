import type { AttachPointId, CastMember, ExpressionId, PropId } from "@studio/schema";
import { useId } from "react";
import { HELD } from "../library/props";
import { ACCENT, FIGURE_SCALE, HALO, INK, LINE, PAPER, mix, type TimeOfDay } from "../theme";
import { FACES } from "./faces";
import { Beard, HATS } from "./hats";
import type { Pose } from "./pose";
import { DIM, solve, type Vec } from "./skeleton";

export type Attachment = { point: AttachPointId; prop: PropId };

export type FigureProps = {
  pose: Pose;
  /** Pose one frame earlier: drives the swing of held props. */
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
  fx?: "zzz" | "sweat" | "speed";
};

const pts = (...p: Vec[]) => p.map((v, i) => `${i ? "L" : "M"} ${v.x.toFixed(2)} ${v.y.toFixed(2)}`).join(" ");

const HALO_COLOR: Record<TimeOfDay, string> = {
  day: "rgba(251,244,230,0.9)",
  dusk: "rgba(255,236,214,0.75)",
  night: "rgba(200,212,255,0.4)",
};

export function Figure(props: FigureProps) {
  const { pose, prevPose, breath, x, groundY, facing, cast, expr, silhouette, blink, tod, frame, attachments, fx } = props;
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const j = solve(pose, breath);
  const prev = solve(prevPose, breath);
  const s = cast.scale * FIGURE_SCALE;
  const w = (LINE * FIGURE_SCALE) / s;
  const sx = 1 - pose.squash * 0.5;
  const sy = 1 + pose.squash;
  const skin = silhouette ? INK : tod === "night" ? mix(PAPER, "#b9c4ea", 0.3) : PAPER;
  const backInk = silhouette ? INK : mix(INK, "#9a96ad", 0.38);

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
    const p = at(a.point);
    const v = p.x - was(a.point).x;
    const swing = Math.max(-35, Math.min(35, -v * 2.2 + Math.sin(frame / 9) * 3));
    return <g key={`${a.point}-${a.prop}`}>{draw({ at: p, swing, tod, frame, point: a.point })}</g>;
  };
  const glows = attachments.filter((a) => a.prop === "lantern" && tod !== "day");

  const offX = 4 + pose.gaze * 8;
  const face = FACES[expr];

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

        {/* halo: one wide light stroke under everything, for a clean silhouette on any background */}
        <g stroke={HALO_COLOR[tod]} strokeWidth={w + (HALO * 2 * FIGURE_SCALE) / s} {...limb}>
          <path d={armB} />
          <path d={legB} />
          <path d={spine} />
          <path d={legF} />
          <path d={armF} />
          <circle cx={j.head.x} cy={j.head.y} r={DIM.headR} />
        </g>

        {attachments.filter((a) => a.point === "hand_l").map(held)}
        <path d={armB} stroke={backInk} strokeWidth={w} {...limb} />
        <path d={legB} stroke={backInk} strokeWidth={w} {...limb} />
        <path d={spine} stroke={INK} strokeWidth={w} {...limb} />
        <path d={legF} stroke={INK} strokeWidth={w} {...limb} />

        <g transform={`translate(${j.head.x.toFixed(2)} ${j.head.y.toFixed(2)}) rotate(${j.headAngle.toFixed(2)})`}>
          <circle r={DIM.headR} fill={skin} stroke={INK} strokeWidth={w * 0.9} />
          {cast.beard && <Beard offX={offX} silhouette={silhouette} />}
          {!silhouette && face({ gaze: pose.gaze, blink, mouth: pose.mouth, frame })}
          {HATS[cast.hat](cast.color, silhouette)}
        </g>

        {attachments.filter((a) => a.point !== "hand_l").map(held)}
        <path d={armF} stroke={INK} strokeWidth={w} {...limb} />

        {fx === "zzz" && <Zzz head={j.head} frame={frame} />}
        {fx === "sweat" && <Sweat head={j.head} frame={frame} />}
        {fx === "speed" && <Speed hip={j.hip} frame={frame} />}
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
