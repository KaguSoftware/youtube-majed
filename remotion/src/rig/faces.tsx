import type { ExpressionId } from "@studio/schema";
import type { ReactNode } from "react";

/**
 * Face sprites, drawn in head space (head centre at 0,0, radius 34, facing
 * right). Features sit toward the facing side (a 3/4 view) and slide with
 * `gaze`. `mouth` (0..1) opens the mouth for talking; `blink` (0..1) closes
 * the eyes. Lines use `currentColor` (the Figure sets it to the cast's line
 * colour); `paper` fills eye whites.
 */
export type FaceState = { gaze: number; blink: number; mouth: number; frame: number; paper: string };

const INK = "currentColor";

const F = 4.2; // feature stroke
const line = { stroke: INK, strokeWidth: F, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

export function layout(gaze: number) {
  const off = 4 + gaze * 8;
  return { e1: off - 7, e2: off + 9, ey: -4, mx: off + 2, my: 13 };
}

function dotEye(x: number, y: number, blink: number, ry = 5.2, rx = 3.8): ReactNode {
  if (blink > 0.55) return <path d={`M ${x - 4.5} ${y} L ${x + 4.5} ${y}`} {...line} />;
  return <ellipse cx={x} cy={y} rx={rx} ry={Math.max(1, ry * (1 - blink))} fill={INK} />;
}

function bigEye(x: number, y: number, r: number, pupil: number, blink: number, look: number, paper: string): ReactNode {
  if (blink > 0.55) return <path d={`M ${x - r} ${y} L ${x + r} ${y}`} {...line} />;
  return (
    <g>
      <ellipse cx={x} cy={y} rx={r} ry={r * (1 - blink * 0.8)} fill={paper} stroke={INK} strokeWidth={3} />
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

  shock: ({ gaze, blink, mouth, paper }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    return (
      <g>
        {bigEye(e1, ey - 1, 7, 2.6, blink, gaze, paper)}
        {bigEye(e2, ey - 1, 7, 2.6, blink, gaze, paper)}
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

  fear: ({ gaze, blink, mouth, frame, paper }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    const jitter = Math.sin(frame * 2.1) * 0.8;
    const sweatY = -12 + ((frame % 40) / 40) * 10;
    return (
      <g>
        {bigEye(e1 + jitter, ey, 6.5, 1.7, blink, 0, paper)}
        {bigEye(e2 + jitter, ey, 6.5, 1.7, blink, 0, paper)}
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

  crying: ({ gaze, mouth, frame }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    const wail = 0.55 + 0.45 * Math.abs(Math.sin(frame / 5)) + mouth * 0.3;
    const tear = (x: number, i: number) => {
      const t = ((frame + i * 9) % 18) / 18;
      return <path key={i} d={`M ${x} ${ey + 4 + t * 26} q -3 5 0 7 q 3 -2 0 -7 Z`} fill="#8fd0f0" stroke={INK} strokeWidth={1.6} opacity={1 - t * 0.6} />;
    };
    return (
      <g>
        <path d={`M ${e1 - 5} ${ey} Q ${e1} ${ey + 4} ${e1 + 5} ${ey}`} {...line} />
        <path d={`M ${e2 - 5} ${ey} Q ${e2} ${ey + 4} ${e2 + 5} ${ey}`} {...line} />
        <path d={`M ${e1 - 6} ${ey - 7} L ${e1 + 5} ${ey - 13}`} {...line} />
        <path d={`M ${e2 - 5} ${ey - 13} L ${e2 + 6} ${ey - 7}`} {...line} />
        <path d={`M ${e1} ${ey + 3} L ${e1 - 1} ${ey + 30}`} stroke="#8fd0f0" strokeWidth={4.5} strokeLinecap="round" opacity={0.85} />
        <path d={`M ${e2} ${ey + 3} L ${e2 + 1} ${ey + 30}`} stroke="#8fd0f0" strokeWidth={4.5} strokeLinecap="round" opacity={0.85} />
        {tear(e1 - 1, 0)}
        {tear(e2 + 1, 1)}
        <path d={`M ${mx - 8} ${my + 3} Q ${mx} ${my - 4 * wail} ${mx + 8} ${my + 3} Q ${mx + 6} ${my + 6 + 7 * wail} ${mx} ${my + 6 + 7 * wail} Q ${mx - 6} ${my + 6 + 7 * wail} ${mx - 8} ${my + 3} Z`} fill={INK} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      </g>
    );
  },

  deadpan: ({ gaze, blink, mouth }) => {
    const { e1, e2, ey, mx, my } = layout(gaze * 0.3);
    return (
      <g>
        {dotEye(e1, ey + 1, blink, 3.4)}
        {dotEye(e2, ey + 1, blink, 3.4)}
        <path d={`M ${e1 - 6} ${ey - 3} L ${e1 + 5} ${ey - 3}`} {...line} />
        <path d={`M ${e2 - 5} ${ey - 3} L ${e2 + 6} ${ey - 3}`} {...line} />
        <path d={`M ${e1 - 5} ${ey - 11} L ${e1 + 4} ${ey - 11}`} {...line} />
        <path d={`M ${e2 - 4} ${ey - 11} L ${e2 + 5} ${ey - 11}`} {...line} />
        {mouth > 0.1 ? openMouth(mx, my, mouth * 0.5, 5) : <path d={`M ${mx - 7} ${my + 1} L ${mx + 7} ${my + 1}`} {...line} />}
      </g>
    );
  },

  laughing: ({ gaze, mouth, frame }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    const open = 0.7 + 0.3 * Math.abs(Math.sin(frame / 3.2)) + mouth * 0.2;
    return (
      <g>
        <path d={`M ${e1 - 5} ${ey + 1} L ${e1 + 3} ${ey - 3} L ${e1 - 5} ${ey - 6}`} {...line} />
        <path d={`M ${e2 + 5} ${ey + 1} L ${e2 - 3} ${ey - 3} L ${e2 + 5} ${ey - 6}`} {...line} />
        <path d={`M ${e1 - 5} ${ey - 15} Q ${e1} ${ey - 19} ${e1 + 5} ${ey - 15}`} {...line} />
        <path d={`M ${e2 - 5} ${ey - 15} Q ${e2} ${ey - 19} ${e2 + 5} ${ey - 15}`} {...line} />
        <path d={`M ${mx - 12} ${my - 4} Q ${mx} ${my + 6 + 12 * open} ${mx + 12} ${my - 4} Z`} fill={INK} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        <ellipse cx={mx} cy={my + 2 + 8 * open} rx={5} ry={2.8} fill="#e8707a" />
      </g>
    );
  },

  disgusted: ({ gaze, blink, mouth }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    return (
      <g>
        <path d={`M ${e1 - 5} ${ey - 1} L ${e1 + 4} ${ey + 1}`} {...line} />
        {dotEye(e2, ey, blink, 3.8)}
        <path d={`M ${e1 - 6} ${ey - 9} L ${e1 + 5} ${ey - 6}`} {...line} />
        <path d={`M ${e2 - 5} ${ey - 9} Q ${e2} ${ey - 13} ${e2 + 6} ${ey - 11}`} {...line} />
        <path d={`M ${mx - 9} ${my + 4} q 3 -5 6 -1 t 6 -1 t 6 3`} {...line} />
        <path d={`M ${mx - 1} ${my + 3} q 3 ${7 + mouth * 3} 7 0`} fill="#e8707a" stroke={INK} strokeWidth={2.5} />
      </g>
    );
  },

  confused: ({ gaze, blink, mouth, frame }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    const bob = Math.sin(frame / 9) * 3;
    return (
      <g>
        {dotEye(e1, ey + 1, blink, 3.8)}
        {dotEye(e2, ey - 1, blink, 5.8, 4.4)}
        <path d={`M ${e1 - 6} ${ey - 8} L ${e1 + 5} ${ey - 7}`} {...line} />
        <path d={`M ${e2 - 5} ${ey - 15} Q ${e2} ${ey - 21} ${e2 + 6} ${ey - 17}`} {...line} />
        {mouth > 0.1 ? openMouth(mx + 2, my + 1, mouth * 0.6, 4.5) : <path d={`M ${mx - 8} ${my + 2} q 4 -4 8 0 t 8 -2`} {...line} />}
        <text x={30} y={-46 + bob} fontFamily="Fredoka, sans-serif" fontWeight={700} fontSize={30} fill={INK} transform={`rotate(14 30 ${-46 + bob})`}>?</text>
      </g>
    );
  },

  embarrassed: ({ gaze, blink, mouth, frame }) => {
    const { e1, e2, ey, mx, my } = layout(gaze * 0.4 - 0.3);
    const sweatY = -16 + ((frame % 48) / 48) * 8;
    return (
      <g>
        {[-8, -2, 4].map((dx) => <path key={dx} d={`M ${e1 - 4 + dx} ${ey + 12} l 3 -5`} stroke="#e8707a" strokeWidth={2.6} strokeLinecap="round" />)}
        {[-4, 2, 8].map((dx) => <path key={dx} d={`M ${e2 + 4 + dx} ${ey + 12} l 3 -5`} stroke="#e8707a" strokeWidth={2.6} strokeLinecap="round" />)}
        {dotEye(e1, ey + 3, blink, 3.6)}
        {dotEye(e2, ey + 3, blink, 3.6)}
        <path d={`M ${e1 - 6} ${ey - 7} L ${e1 + 5} ${ey - 11}`} {...line} />
        <path d={`M ${e2 - 5} ${ey - 11} L ${e2 + 6} ${ey - 7}`} {...line} />
        {mouth > 0.1 ? openMouth(mx, my + 2, mouth * 0.6, 4.5) : <path d={`M ${mx - 6} ${my + 2} q 3 3 6 0 t 6 0`} {...line} />}
        <path d={`M ${-26} ${sweatY - 9} Q ${-31} ${sweatY} ${-26} ${sweatY + 3} Q ${-21} ${sweatY} ${-26} ${sweatY - 9} Z`} fill="#8fd0f0" stroke={INK} strokeWidth={2.5} />
      </g>
    );
  },

  determined: ({ gaze, blink, mouth }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    return (
      <g>
        {dotEye(e1, ey, blink, 4.2)}
        {dotEye(e2, ey, blink, 4.2)}
        <path d={`M ${e1 - 6} ${ey - 13} L ${e1 + 5} ${ey - 9}`} {...line} strokeWidth={5} />
        <path d={`M ${e2 - 5} ${ey - 9} L ${e2 + 6} ${ey - 13}`} {...line} strokeWidth={5} />
        {mouth > 0.1 ? (
          <path d={`M ${mx - 8} ${my} L ${mx + 9} ${my - 1} L ${mx + 7} ${my + 3 + mouth * 7} L ${mx - 6} ${my + 3 + mouth * 7} Z`} fill={INK} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        ) : (
          <path d={`M ${mx - 7} ${my + 1} Q ${mx + 2} ${my + 3} ${mx + 9} ${my - 3}`} {...line} />
        )}
      </g>
    );
  },

  in_love: ({ gaze, mouth, frame }) => {
    const { e1, e2, ey, mx, my } = layout(gaze);
    const beat = 1 + 0.18 * Math.max(0, Math.sin(frame / 4));
    const heart = (x: number) => (
      <path transform={`translate(${x} ${ey}) scale(${beat})`} d="M 0 5 C -9 -1, -7 -9, -2 -8 C 0 -7.5, 0 -6, 0 -5 C 0 -6, 0 -7.5, 2 -8 C 7 -9, 9 -1, 0 5 Z" fill="#e5484d" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
    );
    return (
      <g>
        {heart(e1)}
        {heart(e2)}
        <ellipse cx={e1 - 4} cy={ey + 12} rx={5} ry={2.6} fill="#f2a0a8" opacity={0.8} />
        <ellipse cx={e2 + 5} cy={ey + 12} rx={5} ry={2.6} fill="#f2a0a8" opacity={0.8} />
        {mouth > 0.1 ? openMouth(mx, my + 1, mouth * 0.7, 5) : <path d={`M ${mx - 8} ${my - 1} Q ${mx} ${my + 8} ${mx + 8} ${my - 1}`} {...line} />}
      </g>
    );
  },
};
