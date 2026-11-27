import { ACCENT } from "../../theme";
import { Layer } from "../camera";
import { Glow, X0, X1, Y0, Y1, lit, t, type BgProps } from "./common";

/** Science lab: tiled wall, long teal bench with bubbling flasks, a big humming machine. */
const GROUND = 885;
const BENCH = 660; // bench top
const GREEN = "#7dfc9e";
const LIGHTS = [GREEN, "#ff6b5b", ACCENT, "#5ee6ff"];

type Tone = (hex: string) => string;

function Bubbles({ x, top, bottom, frame, seed }: { x: number; top: number; bottom: number; frame: number; seed: number }) {
  return (
    <g fill="#eafff1">
      {[0, 1, 2].map((i) => {
        const k = ((frame + i * 17 + seed * 11) % 50) / 50;
        return <circle key={i} cx={x + Math.sin(k * 9 + i) * 5} cy={bottom - k * (bottom - top)} r={4 + i} opacity={0.85 * (1 - k)} />;
      })}
    </g>
  );
}

function Flask({ x, s, liquid, frame, seed, c, on }: { x: number; s: number; liquid: string; frame: number; seed: number; c: Tone; on: boolean }) {
  const y = BENCH;
  const surf = y - 46 * s;
  return (
    <g>
      {on && <Glow x={x} y={y - 40 * s} r={120 * s} opacity={0.4} color={liquid} />}
      <path d={`M ${x - 12 * s} ${y - 120 * s} L ${x - 12 * s} ${y - 80 * s} L ${x - 46 * s} ${y} L ${x + 46 * s} ${y} L ${x + 12 * s} ${y - 80 * s} L ${x + 12 * s} ${y - 120 * s} Z`} fill={c("#e6f4f3")} opacity={0.85} />
      <path d={`M ${x - 31 * s} ${surf} L ${x - 46 * s} ${y} L ${x + 46 * s} ${y} L ${x + 31 * s} ${surf} Z`} fill={liquid} />
      <rect x={x - 16 * s} y={y - 126 * s} width={32 * s} height={8 * s} rx={3} fill={c("#c9dcdc")} />
      <Bubbles x={x} top={y - 150 * s} bottom={surf + 6} frame={frame} seed={seed} />
    </g>
  );
}

function Machine({ frame, c, on }: { frame: number; c: Tone; on: boolean }) {
  const spin = frame * 3;
  return (
    <g>
      <path d={`M 250 230 C 380 90 520 70 640 ${Y0}`} stroke={c("#41545e")} strokeWidth={22} fill="none" />
      <path d={`M 150 230 C 220 40 300 20 360 ${Y0}`} stroke={c("#566b75")} strokeWidth={14} fill="none" />
      <rect x={-200} y={220} width={540} height={GROUND - 220} rx={18} fill={c("#93aab3")} />
      <rect x={290} y={220} width={50} height={GROUND - 220} fill={c("#7b939d")} />
      <rect x={-200} y={200} width={560} height={34} rx={10} fill={c("#5f7782")} />
      <circle cx={130} cy={400} r={110} fill={c("#5f7782")} />
      <circle cx={130} cy={400} r={88} fill="#123c33" />
      {on && <Glow x={130} y={400} r={260} opacity={0.45} color={GREEN} />}
      <g transform={`rotate(${spin} 130 400)`}>
        <path d="M 130 400 m -60 0 a 60 60 0 0 1 120 0 a 30 30 0 0 1 -60 0 a 30 30 0 0 0 -60 0 Z" fill={GREEN} opacity={0.9} />
      </g>
      <circle cx={130} cy={400} r={88} fill="none" stroke={c("#d9e6e8")} strokeWidth={6} opacity={0.5} />
      <rect x={-60} y={560} width={330} height={120} rx={10} fill={c("#41545e")} />
      {Array.from({ length: 12 }, (_, i) => {
        const blink = Math.sin(frame * 0.35 + i * 2.3) > -0.2;
        const col = LIGHTS[i % 4]!;
        return <circle key={i} cx={-30 + (i % 6) * 54} cy={595 + Math.floor(i / 6) * 50} r={12} fill={blink ? col : c("#2c3a41")} />;
      })}
      {[20, 200].map((gx, i) => (
        <g key={gx}>
          <circle cx={gx} cy={740} r={44} fill={c("#eef4f2")} />
          <path d={`M ${gx} 740 L ${gx + Math.sin(frame * 0.12 + i * 2) * 30} ${712}`} stroke="#d0473d" strokeWidth={5} strokeLinecap="round" />
        </g>
      ))}
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const on = lit(tod);
  return (
    <g>
      <Layer depth={0.85}>
        <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill={c("#e7f1ef")} />
        {Array.from({ length: 50 }, (_, i) => (
          <path key={`h${i}`} d={`M ${X0} ${Y0 + i * 58} L ${X1} ${Y0 + i * 58}`} stroke={c("#d3e3e0")} strokeWidth={3} />
        ))}
        {Array.from({ length: 50 }, (_, i) => (
          <path key={`v${i}`} d={`M ${X0 + i * 58} ${Y0} L ${X0 + i * 58} ${BENCH}`} stroke={c("#d3e3e0")} strokeWidth={3} />
        ))}
        <rect x={X0} y={BENCH - 128} width={X1 - X0} height={30} fill={c("#8cc9c2")} />
        {[340, 1240].map((x) => (
          <g key={x}>
            {on && <Glow x={x + 200} y={70} r={360} opacity={0.3} color="#e9fff8" />}
            <rect x={x} y={Y0} width={400} height={60 - Y0} fill={c("#cfdedc")} />
            <rect x={x + 20} y={50} width={360} height={22} rx={6} fill="#f4fffb" />
          </g>
        ))}
        <g>
          <rect x={1300} y={330} width={420} height={16} rx={4} fill={c("#5a7a80")} />
          {[["#b56b45", 30, 70], ["#4f81bd", 36, 54], ["#d9e9e6", 28, 84], ["#9bbb59", 40, 60], ["#b56b45", 26, 48], ["#d9e9e6", 34, 76]].map(([col, w, h], i) => (
            <g key={i}>
              <rect x={1330 + i * 62} y={330 - (h as number)} width={w as number} height={h as number} rx={6} fill={c(col as string)} />
              <rect x={1336 + i * 62} y={322 - (h as number)} width={(w as number) - 12} height={10} rx={2} fill={c("#41545e")} />
            </g>
          ))}
        </g>
        <rect x={X0} y={BENCH + 14} width={X1 - X0} height={GROUND - BENCH} fill={c("#5f9f9b")} />
        {Array.from({ length: 16 }, (_, i) => (
          <g key={i}>
            <rect x={X0 + 20 + i * 170} y={BENCH + 40} width={150} height={GROUND - BENCH - 80} rx={6} fill={c("#6aaba6")} />
            <rect x={X0 + 75 + i * 170} y={BENCH + 56} width={40} height={8} rx={4} fill={c("#3e6c6a")} />
          </g>
        ))}
        <rect x={X0} y={BENCH} width={X1 - X0} height={20} fill={c("#34505a")} />
        <Flask x={660} s={1} liquid={GREEN} frame={frame} seed={1} c={c} on={on} />
        <Flask x={760} s={0.7} liquid="#5ee6ff" frame={frame} seed={2} c={c} on={on} />
        <g transform="translate(1110 0)">
          <rect x={-50} y={BENCH - 16} width={100} height={16} rx={4} fill={c("#41545e")} />
          <path d={`M 20 ${BENCH - 16} L 30 ${BENCH - 110} L 6 ${BENCH - 150}`} stroke={c("#41545e")} strokeWidth={18} fill="none" strokeLinecap="round" />
          <rect x={-22} y={BENCH - 190} width={30} height={90} rx={8} transform={`rotate(-20 -7 ${BENCH - 145})`} fill={c("#e6eeee")} />
          <rect x={-40} y={BENCH - 70} width={60} height={10} rx={3} fill={c("#41545e")} />
        </g>
        <g transform="translate(1210 0)">
          <rect x={0} y={BENCH - 40} width={150} height={40} rx={4} fill={c("#c9a27a")} />
          {["#ff6b5b", GREEN, ACCENT, "#5ee6ff"].map((col, i) => (
            <g key={i}>
              <rect x={14 + i * 34} y={BENCH - 100} width={20} height={80} rx={10} fill={c("#e6f4f3")} opacity={0.9} />
              <rect x={14 + i * 34} y={BENCH - 62} width={20} height={42} rx={10} fill={col} />
            </g>
          ))}
        </g>
        <Flask x={1720} s={1.15} liquid={GREEN} frame={frame} seed={3} c={c} on={on} />
        <Machine frame={frame} c={c} on={on} />
        {on && <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill="#8fe6da" opacity={tod === "night" ? 0.16 : 0.08} />}
      </Layer>
      <Layer depth={1}>
        <rect x={X0} y={GROUND - 30} width={X1 - X0} height={Y1 - GROUND + 30} fill={c("#bccbca")} />
        <rect x={X0} y={GROUND - 36} width={X1 - X0} height={12} fill={c("#41545e")} />
        {[935, 1010, 1110].map((y) => (
          <path key={y} d={`M ${X0} ${y} L ${X1} ${y}`} stroke={c("#aabbb9")} strokeWidth={4} />
        ))}
        {Array.from({ length: 13 }, (_, i) => (
          <path key={i} d={`M ${X0 + i * 220} ${GROUND - 24} L ${X0 - 300 + i * 260} ${Y1}`} stroke={c("#aabbb9")} strokeWidth={4} />
        ))}
        {on && <rect x={X0} y={GROUND - 36} width={X1 - X0} height={Y1 - GROUND + 36} fill="#8fe6da" opacity={tod === "night" ? 0.12 : 0.06} />}
      </Layer>
    </g>
  );
}

export const lab = { groundY: GROUND, horizonY: 400, wallY: 380, Back };
