import { random } from "remotion";
import { mix } from "../../theme";
import { Layer } from "../camera";
import { Glow, OutdoorSky, X0, X1, Y1, lit, t, type BgProps } from "./common";

/** mountain: a snowy pass under icy peaks, snow-laden pines, a rocky path, cold light. */
const GROUND = 885;
const HORIZON = 620;

const PEAK_FAR = "#b9c8e0";
const PEAK = "#8ea6c6";
const PEAK_SHADE = "#7189ad";
const SNOW = "#f2f7fc";
const SNOW_SHADE = "#d4e1ef";
const ICE = "#c4d8ec";
const PINE = "#2f5a55";
const PINE_DARK = "#24474a";
const ROCK = "#8d8f99";
const ROCK_DARK = "#6e717d";

/** Night pulls the base toward moonlight first, so snow glows blue, not grey. */
const toner = (tod: BgProps["tod"]) => (hex: string) => t(tod)(tod === "night" ? mix(hex, "#7f9cff", 0.3) : hex);

type Peak = { x: number; w: number; h: number; base: number };

/** A peak with a shaded right flank and a jagged snow cap. */
function Mountain({ p, rock, shade, snow }: { p: Peak; rock: string; shade: string; snow: string }) {
  const { x, w, h, base } = p;
  const tx = x + w * 0.48;
  const ty = base - h;
  const cap = h * 0.32;
  const lx = tx - (w * 0.48 * cap) / h;
  const rx = tx + (w * 0.52 * cap) / h;
  return (
    <g>
      <path d={`M ${x} ${base} L ${tx} ${ty} L ${x + w} ${base} Z`} fill={rock} />
      <path d={`M ${tx} ${ty} L ${x + w} ${base} L ${tx + w * 0.08} ${base} Z`} fill={shade} />
      <path d={`M ${tx} ${ty} L ${lx} ${ty + cap} L ${lx + (tx - lx) * 0.45} ${ty + cap * 0.78} L ${tx - 4} ${ty + cap * 1.05} L ${tx + (rx - tx) * 0.5} ${ty + cap * 0.8} L ${rx} ${ty + cap} Z`} fill={snow} />
    </g>
  );
}

function SnowPine({ x, base, h, pine, snow }: { x: number; base: number; h: number; pine: string; snow: string }) {
  const w = h * 0.36;
  return (
    <g>
      {[0, 1, 2].map((i) => {
        const tb = base - h * 0.1 - i * h * 0.26;
        const tw = w * (1 - i * 0.25);
        const tt = tb - h * 0.4;
        return (
          <g key={i}>
            <path d={`M ${x - tw} ${tb} L ${x} ${tt} L ${x + tw} ${tb} Z`} fill={pine} />
            <path d={`M ${x - tw * 0.42} ${tt + h * 0.17} L ${x} ${tt} L ${x + tw * 0.42} ${tt + h * 0.17} Q ${x} ${tt + h * 0.12} ${x - tw * 0.42} ${tt + h * 0.17} Z`} fill={snow} />
            <path d={`M ${x - tw} ${tb} Q ${x} ${tb - 14} ${x + tw} ${tb}`} stroke={snow} strokeWidth={7} fill="none" strokeLinecap="round" />
          </g>
        );
      })}
    </g>
  );
}

const FAR: Peak[] = [
  { x: -400, w: 900, h: 420, base: HORIZON + 40 },
  { x: 300, w: 1000, h: 520, base: HORIZON + 40 },
  { x: 1100, w: 1150, h: 470, base: HORIZON + 40 },
];
const NEAR: Peak[] = [
  { x: -300, w: 760, h: 300, base: HORIZON + 90 },
  { x: 1240, w: 900, h: 340, base: HORIZON + 90 },
];

function Back({ tod, frame }: BgProps) {
  const c = toner(tod);
  const on = lit(tod);
  return (
    <g>
      <OutdoorSky tod={tod} frame={frame} horizon={HORIZON} sunX={420} />

      <Layer depth={0.15}>
        <rect x={X0} y={HORIZON + 20} width={X1 - X0} height={300} fill={c(mix(ICE, PEAK_FAR, 0.4))} />
        {FAR.map((p) => <Mountain key={p.x} p={p} rock={c(PEAK_FAR)} shade={c(mix(PEAK_FAR, PEAK_SHADE, 0.35))} snow={c(SNOW)} />)}
        {FAR.map((p, i) =>
          Array.from({ length: 4 }, (_, j) => {
            // snow blowing off the summits, drifting downwind and fading
            const k = (frame / 90 + j / 4 + i * 0.3) % 1;
            const tx = p.x + p.w * 0.48 + k * 220;
            const ty = p.base - p.h + 6 - k * 26;
            return <ellipse key={`${i}-${j}`} cx={tx} cy={ty} rx={18 + k * 60} ry={6 + k * 12} fill={c(SNOW)} opacity={0.55 * (1 - k)} />;
          }),
        )}
      </Layer>

      <Layer depth={0.32}>
        {NEAR.map((p) => <Mountain key={p.x} p={p} rock={c(PEAK)} shade={c(PEAK_SHADE)} snow={c(SNOW)} />)}
        <path d={`M ${X0} ${HORIZON + 80} Q 500 ${HORIZON + 30} 1000 ${HORIZON + 70} Q 1500 ${HORIZON + 110} ${X1} ${HORIZON + 60} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(ICE)} />
        {Array.from({ length: 22 }, (_, i) => {
          const x = X0 + i * 110 + random(`mpf${i}`) * 50;
          return <SnowPine key={i} x={x} base={HORIZON + 96 + random(`mpfb${i}`) * 20} h={90 + random(`mpfh${i}`) * 60} pine={c(mix(PINE, ICE, 0.45))} snow={c(SNOW)} />;
        })}
      </Layer>

      <Layer depth={0.6}>
        <path d={`M ${X0} 770 Q 400 720 900 760 Q 1400 800 ${X1} 740 L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(SNOW_SHADE)} />
        <g transform="translate(960 12) scale(0.85)">
          <path d="M -70 760 L -70 700 L 0 660 L 70 700 L 70 760 Z" fill={c("#8a5d3d")} />
          <path d="M -88 706 L 0 650 L 88 706 L 80 714 L 0 664 L -80 714 Z" fill={c(SNOW)} />
          {on && <Glow x={-28} y={722} r={90} opacity={0.5} />}
          <rect x={-42} y={708} width={28} height={26} rx={3} fill={on ? "#ffd98a" : c("#4a5a70")} />
          <rect x={20} y={714} width={30} height={46} rx={3} fill={c("#5a3d28")} />
          {on && [0, 1, 2].map((i) => {
            const k = (frame / 80 + i / 3) % 1;
            return <circle key={i} cx={40 + k * 30} cy={640 - k * 80} r={8 + k * 14} fill={c("#c9d2de")} opacity={0.5 * (1 - k)} />;
          })}
          <rect x={30} y={640} width={18} height={44} fill={c("#6e4a35")} />
        </g>
        {[[40, 240], [250, 180], [1720, 260], [1900, 200]].map(([x, h]) => (
          <SnowPine key={x} x={x!} base={790} h={h!} pine={c(PINE)} snow={c(SNOW)} />
        ))}
      </Layer>

      <Layer depth={0.82}>
        <SnowPine x={-60} base={850} h={520} pine={c(PINE_DARK)} snow={c(SNOW)} />
        <SnowPine x={1990} base={850} h={480} pine={c(PINE_DARK)} snow={c(SNOW)} />
      </Layer>

      <Layer depth={1}>
        <path d={`M ${X0} ${GROUND - 44} Q 500 ${GROUND - 70} 1000 ${GROUND - 46} Q 1500 ${GROUND - 24} ${X1} ${GROUND - 52} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(SNOW)} />
        <path d={`M ${X0} ${GROUND - 12} Q 600 ${GROUND - 34} 1100 ${GROUND - 14} Q 1600 ${GROUND + 4} ${X1} ${GROUND - 20} L ${X1} ${GROUND + 64} Q 1500 ${GROUND + 84} 1000 ${GROUND + 62} Q 500 ${GROUND + 40} ${X0} ${GROUND + 60} Z`} fill={c("#a39c94")} />
        {Array.from({ length: 34 }, (_, i) => {
          const x = X0 + (i + random(`st${i}`) * 0.5) * ((X1 - X0) / 34);
          const y = GROUND + 6 + random(`sty${i}`) * 44;
          return <ellipse key={i} cx={x} cy={y} rx={22 + random(`str${i}`) * 18} ry={8 + random(`strr${i}`) * 5} fill={c(i % 3 ? "#8e877f" : "#b5ada3")} />;
        })}
        <path d={`M ${X0} 1010 Q 700 984 1300 1004 Q 1700 1018 ${X1} 996 L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(SNOW_SHADE)} />
        {[[260, 1000, 1], [1640, 1010, 0.8]].map(([x, y, s]) => (
          <g key={x} transform={`translate(${x} ${y}) scale(${s})`}>
            <path d="M -80 0 L -64 -46 L -20 -70 L 30 -62 L 72 -30 L 84 0 Z" fill={c(ROCK)} />
            <path d="M 30 -62 L 72 -30 L 84 0 L 20 0 Z" fill={c(ROCK_DARK)} />
            <path d="M -66 -42 L -20 -70 L 30 -62 L 60 -38 Q 20 -48 -10 -44 Q -40 -36 -66 -42 Z" fill={c(SNOW)} />
          </g>
        ))}
      </Layer>
    </g>
  );
}

function Front({ tod }: BgProps) {
  const c = toner(tod);
  return (
    <Layer depth={1.15}>
      <ellipse cx={-20} cy={1130} rx={200} ry={90} fill={c(ROCK_DARK)} />
      <path d="M -220 1130 Q -20 1010 180 1120 Q -20 1070 -220 1130 Z" fill={c(SNOW)} />
    </Layer>
  );
}

export const mountain = { groundY: GROUND, horizonY: HORIZON, wallY: 380, Back, Front };
