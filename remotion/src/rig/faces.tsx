import type { ExpressionId } from "@studio/schema";
import type { ReactNode } from "react";
import { INK, PAPER } from "../theme";

/**
 * Face sprites, drawn in head space (head centre at 0,0, radius 34, facing
 * right). Features sit toward the facing side (a 3/4 view) and slide with
 * `gaze`. `mouth` (0..1) opens the mouth for talking; `blink` (0..1) closes
 * the eyes.
 */
export type FaceState = { gaze: number; blink: number; mouth: number; frame: number };

const F = 4.2; // feature stroke
const line = { stroke: INK, strokeWidth: F, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

function layout(gaze: number) {
  const off = 4 + gaze * 8;
  return { e1: off - 7, e2: off + 9, ey: -4, mx: off + 2, my: 13 };
}

function dotEye(x: number, y: number, blink: number, ry = 5.2, rx = 3.8): ReactNode {
  if (blink > 0.55) return <path d={`M ${x - 4.5} ${y} L ${x + 4.5} ${y}`} {...line} />;
  return <ellipse cx={x} cy={y} rx={rx} ry={Math.max(1, ry * (1 - blink))} fill={INK} />;
}

function bigEye(x: number, y: number, r: number, pupil: number, blink: number, look: number): ReactNode {
  if (blink > 0.55) return <path d={`M ${x - r} ${y} L ${x + r} ${y}`} {...line} />;
  return (
    <g>
      <ellipse cx={x} cy={y} rx={r} ry={r * (1 - blink * 0.8)} fill={PAPER} stroke={INK} strokeWidth={3} />
      <circle cx={x + look} cy={y} r={pupil} fill={INK} />
    </g>
  );
}

function openMouth(x: number, y: number, open: number, w = 6.5): ReactNode {
  return <ellipse cx={x} cy={y + 1} rx={w} ry={1.8 + open * 7} fill={INK} />;
}

type Draw = (s: FaceState) => ReactNode;

export const FACES: Record<ExpressionId, Draw> = {
  neutral: ({ gaze, blink, mouth }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    return (
      <g>
        {dotEye(e1, ey, blink)}
        {dotEye(e2, ey, blink)}
        <path d={`M ${e1 - 5} ${ey - 13} L ${e1 + 4} ${ey - 14}`} {...line} />
        <path d={`M ${e2 - 4} ${ey - 14} L ${e2 + 5} ${ey - 13}`} {...line} />
        {mouth > 0.08 ? openMouth(mx, my, mouth) : <path d={`M ${mx - 7} ${my} Q ${mx} ${my + 4} ${mx + 7} ${my - 1}`} {...line} />}
      </g>
    );
  },

  happy: ({ gaze, mouth }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    const h = 11 + mouth * 6;
    return (
      <g>
        <path d={`M ${e1 - 5} ${ey + 2} Q ${e1} ${ey - 6} ${e1 + 5} ${ey + 2}`} {...line} />
        <path d={`M ${e2 - 5} ${ey + 2} Q ${e2} ${ey - 6} ${e2 + 5} ${ey + 2}`} {...line} />
        <path d={`M ${mx - 11} ${my - 3} Q ${mx} ${my + h} ${mx + 11} ${my - 3} Z`} fill={INK} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      </g>
    );
  },

  shock: ({ gaze, blink, mouth }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    return (
      <g>
        {bigEye(e1, ey - 1, 7, 2.6, blink, gaze)}
        {bigEye(e2, ey - 1, 7, 2.6, blink, gaze)}
        <path d={`M ${e1 - 6} ${ey - 15} Q ${e1} ${ey - 21} ${e1 + 5} ${ey - 16}`} {...line} />
        <path d={`M ${e2 - 5} ${ey - 16} Q ${e2} ${ey - 21} ${e2 + 6} ${ey - 15}`} {...line} />
        <ellipse cx={mx} cy={my + 3} rx={5.5 + mouth * 1.5} ry={7.5 + mouth * 3} fill={INK} />
      </g>
    );
  },

  smirk: ({ gaze, blink, mouth }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    return (
      <g>
        {dotEye(e1, ey + 1, blink, 3)}
        <path d={`M ${e1 - 5} ${ey - 3} L ${e1 + 5} ${ey - 3}`} {...line} />
        {dotEye(e2, ey, blink)}
        <path d={`M ${e1 - 5} ${ey - 11} L ${e1 + 4} ${ey - 11}`} {...line} />
        <path d={`M ${e2 - 4} ${ey - 15} Q ${e2} ${ey - 19} ${e2 + 6} ${ey - 16}`} {...line} />
        {mouth > 0.1 ? openMouth(mx + 2, my, mouth * 0.7, 5) : <path d={`M ${mx - 7} ${my + 2} Q ${mx + 3} ${my + 4} ${mx + 9} ${my - 5}`} {...line} />}
      </g>
    );
  },

  fear: ({ gaze, blink, mouth, frame }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    const jitter = Math.sin(frame * 2.1) * 0.8;
    const sweatY = -12 + ((frame % 40) / 40) * 10;
    return (
      <g>
        {bigEye(e1 + jitter, ey, 6.5, 1.7, blink, 0)}
        {bigEye(e2 + jitter, ey, 6.5, 1.7, blink, 0)}
        <path d={`M ${e1 - 6} ${ey - 11} L ${e1 + 5} ${ey - 17}`} {...line} />
        <path d={`M ${e2 - 5} ${ey - 17} L ${e2 + 6} ${ey - 11}`} {...line} />
        {mouth > 0.1 ? (
          openMouth(mx, my + 1, mouth, 5.5)
        ) : (
          <path d={`M ${mx - 8} ${my + 3} q 2.7 -4 5.3 0 t 5.3 0 t 5.3 0`} {...line} strokeWidth={3.6} />
        )}
        <path
          d={`M ${mx + 22} ${sweatY - 9} Q ${mx + 17} ${sweatY} ${mx + 22} ${sweatY + 3} Q ${mx + 27} ${sweatY} ${mx + 22} ${sweatY - 9} Z`}
          fill="#8fd0f0"
          stroke={INK}
          strokeWidth={2.5}
        />
      </g>
    );
  },

  sad: ({ gaze, blink, mouth }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    return (
      <g>
        {dotEye(e1, ey + 2, blink, 4.6)}
        {dotEye(e2, ey + 2, blink, 4.6)}
        <path d={`M ${e1 - 6} ${ey - 8} L ${e1 + 5} ${ey - 13}`} {...line} />
        <path d={`M ${e2 - 5} ${ey - 13} L ${e2 + 6} ${ey - 8}`} {...line} />
        {mouth > 0.1 ? openMouth(mx, my + 2, mouth * 0.8, 5) : <path d={`M ${mx - 8} ${my + 5} Q ${mx} ${my - 3} ${mx + 8} ${my + 5}`} {...line} />}
      </g>
    );
  },

  angry: ({ gaze, blink, mouth }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    return (
      <g>
        {dotEye(e1, ey, blink, 3.6)}
        {dotEye(e2, ey, blink, 3.6)}
        <path d={`M ${e1 - 6} ${ey - 15} L ${e1 + 5} ${ey - 8}`} {...line} strokeWidth={5} />
        <path d={`M ${e2 - 5} ${ey - 8} L ${e2 + 6} ${ey - 15}`} {...line} strokeWidth={5} />
        {mouth > 0.1 ? (
          <path d={`M ${mx - 9} ${my} L ${mx + 9} ${my} L ${mx + 6} ${my + 4 + mouth * 9} L ${mx - 6} ${my + 4 + mouth * 9} Z`} fill={INK} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        ) : (
          <path d={`M ${mx - 8} ${my + 4} Q ${mx} ${my - 2} ${mx + 8} ${my + 4}`} {...line} />
        )}
      </g>
    );
  },

  suspicious: ({ gaze, blink, mouth }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    return (
      <g>
        {dotEye(e1, ey + 1, blink, 2.6, 4)}
        {dotEye(e2, ey + 1, blink, 2.6, 4)}
        <path d={`M ${e1 - 6} ${ey - 7} L ${e1 + 5} ${ey - 6}`} {...line} />
        <path d={`M ${e2 - 5} ${ey - 8} L ${e2 + 6} ${ey - 9}`} {...line} />
        {mouth > 0.1 ? openMouth(mx + 4, my, mouth * 0.7, 4.5) : <path d={`M ${mx - 2} ${my + 2} L ${mx + 9} ${my}`} {...line} />}
      </g>
    );
  },

  sleepy: ({ gaze, mouth }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    return (
      <g>
        <path d={`M ${e1 - 5} ${ey} Q ${e1} ${ey + 4} ${e1 + 5} ${ey}`} {...line} />
        <path d={`M ${e2 - 5} ${ey} Q ${e2} ${ey + 4} ${e2 + 5} ${ey}`} {...line} />
        <ellipse cx={mx} cy={my + 2} rx={3} ry={3 + mouth * 3} fill="none" stroke={INK} strokeWidth={3.4} />
      </g>
    );
  },
};
