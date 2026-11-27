import { random } from "remotion";
import { ACCENT, C, mix } from "../../theme";
import { Layer } from "../camera";
import { Glow, OutdoorSky, X0, X1, Y1, t, type BgProps } from "./common";

const GROUND = 890;
const HORIZON = 600;

function Pine({ x, base, h, color, trunk }: { x: number; base: number; h: number; color: string; trunk: string }) {
  const w = h * 0.42;
  return (
    <g>
      <rect x={x - h * 0.03} y={base - h * 0.2} width={h * 0.06} height={h * 0.2} fill={trunk} />
      {[0, 1, 2].map((i) => {
        const tierBase = base - h * 0.15 - i * h * 0.25;
        const tierW = w * (1 - i * 0.24);
        return <path key={i} d={`M ${x - tierW} ${tierBase} L ${x} ${tierBase - h * 0.42} L ${x + tierW} ${tierBase} Z`} fill={color} />;
      })}
    </g>
  );
}

function row(seed: string, n: number, base: number, hMin: number, hMax: number, color: string, trunk: string) {
  return Array.from({ length: n }, (_, i) => {
    const x = X0 + (i + random(`${seed}x${i}`) * 0.6) * ((X1 - X0) / n);
    const h = hMin + random(`${seed}h${i}`) * (hMax - hMin);
    return <Pine key={i} x={x} base={base + random(`${seed}b${i}`) * 20} h={h} color={color} trunk={trunk} />;
  });
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod);
  return (
    <g>
      <OutdoorSky tod={tod} frame={frame} horizon={HORIZON} sunX={1300} />
      <Layer depth={0.2}>
        <path d={`M ${X0} ${HORIZON} Q 400 ${HORIZON - 120} 900 ${HORIZON - 40} Q 1400 ${HORIZON - 150} ${X1} ${HORIZON - 30} L ${X1} ${HORIZON + 200} L ${X0} ${HORIZON + 200} Z`} fill={c("#9fb8b0")} />
        {row("far", 26, HORIZON + 60, 160, 240, c(C.pineFar), c(C.pineFar))}
      </Layer>
      <Layer depth={0.5}>
        <rect x={X0} y={HORIZON + 80} width={X1 - X0} height={400} fill={c(mix(C.grass, C.pineFar, 0.4))} />
        {row("mid", 16, 790, 300, 420, c(C.pine), c(C.woodDark))}
      </Layer>
      <Layer depth={0.8}>
        {row("near", 7, 860, 520, 680, c(C.pineDark), c(C.woodDark))}
      </Layer>
      <Layer depth={1}>
        <path d={`M ${X0} ${GROUND - 40} Q 500 ${GROUND - 64} 1000 ${GROUND - 40} Q 1500 ${GROUND - 20} ${X1} ${GROUND - 46} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(C.grass)} />
        <path d={`M 700 ${GROUND - 46} Q 900 ${GROUND - 30} 1300 ${GROUND - 44} Q 1500 980 1700 ${Y1} L 200 ${Y1} Q 700 980 700 ${GROUND - 46} Z`} fill={c("#c9a978")} />
        <path d={`M 760 ${GROUND - 30} Q 1000 ${GROUND - 18} 1240 ${GROUND - 30}`} stroke={c("#b08f60")} strokeWidth={5} fill="none" />
        {Array.from({ length: 16 }, (_, i) => {
          const x = X0 + 80 + random(`gt${i}`) * (X1 - X0 - 160);
          const y = GROUND - 10 + random(`gty${i}`) * 170;
          return <path key={i} d={`M ${x - 10} ${y} L ${x - 4} ${y - 18} M ${x} ${y} L ${x + 2} ${y - 24} M ${x + 9} ${y} L ${x + 6} ${y - 16}`} stroke={c(C.grassDark)} strokeWidth={4} strokeLinecap="round" />;
        })}
      </Layer>
    </g>
  );
}

function Fern({ x, y, s, color }: { x: number; y: number; s: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={color}>
      {[-60, -30, 0, 30, 60].map((a) => (
        <path key={a} d="M 0 0 Q -14 -70 0 -150 Q 14 -70 0 0 Z" transform={`rotate(${a})`} />
      ))}
    </g>
  );
}

function Front({ tod, frame }: BgProps) {
  const c = t(tod);
  return (
    <Layer depth={1.2}>
      <Fern x={-40} y={1100} s={1.5} color={c(C.pineDark)} />
      <Fern x={120} y={1120} s={1.1} color={c(mix(C.pineDark, C.grass, 0.4))} />
      <Fern x={1960} y={1110} s={1.6} color={c(C.pineDark)} />
      <rect x={-190} y={-300} width={120} height={1500} fill={c("#5b4433")} />
      {tod === "night" &&
        Array.from({ length: 14 }, (_, i) => {
          const x = 200 + random(`ff${i}`) * 1520 + Math.sin(frame / 25 + i * 2) * 40;
          const y = 520 + random(`ffy${i}`) * 360 + Math.cos(frame / 31 + i) * 30;
          const a = 0.4 + 0.6 * Math.max(0, Math.sin(frame / 12 + i * 1.7));
          return (
            <g key={i} opacity={a}>
              <Glow x={x} y={y} r={26} opacity={0.6} />
              <circle cx={x} cy={y} r={3.5} fill={ACCENT} />
            </g>
          );
        })}
    </Layer>
  );
}

export const forest = { groundY: GROUND, horizonY: HORIZON, wallY: 380, Back, Front };
