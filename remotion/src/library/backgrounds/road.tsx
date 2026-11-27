import { random } from "remotion";
import { ACCENT, mix } from "../../theme";
import { Layer } from "../camera";
import { Glow, OutdoorSky, X0, X1, Y1, lit, t, type BgProps } from "./common";

/** road: a country road running left to right through golden fields, a fence, rolling green hills. */
const GROUND = 885;
const HORIZON = 610;
const ROAD_TOP = 830;
const ROAD_BOTTOM = 990;

const HILL_FAR = "#9cc48a";
const HILL = "#78b062";
const HILL_DARK = "#5f9a52";
const WHEAT = "#e8c35a";
const WHEAT_LIGHT = "#f2d67e";
const WHEAT_DARK = "#cfa543";
const VERGE = "#86b45e";
const ASPHALT = "#5a5f6b";
const POST = "#9a7350";

/** Night pulls the base toward moonlight first, so fields go blue-green, not grey. */
const toner = (tod: BgProps["tod"]) => (hex: string) => t(tod)(tod === "night" ? mix(hex, "#6f8cff", 0.3) : hex);

function Barn({ tod }: BgProps) {
  const c = toner(tod);
  const on = lit(tod);
  return (
    <g transform={`translate(880 ${HORIZON + 22})`}>
      <path d="M -70 0 L -70 -70 L 0 -112 L 70 -70 L 70 0 Z" fill={c("#c0533f")} />
      <path d="M -80 -66 L 0 -118 L 80 -66 L 74 -60 L 0 -106 L -74 -60 Z" fill={c("#6b4a3a")} />
      <path d="M -22 0 L -22 -44 L 22 -44 L 22 0 Z" fill={c("#efe2c8")} />
      <path d="M -20 -2 L 20 -42 M -20 -42 L 20 -2" stroke={c("#c0533f")} strokeWidth={5} />
      {on && <Glow x={0} y={-74} r={60} opacity={0.6} />}
      <rect x={-10} y={-84} width={20} height={20} rx={2} fill={on ? "#ffd98a" : c("#4a3a32")} />
      <rect x={86} y={-110} width={34} height={110} rx={14} fill={c("#b8bcc4")} />
      <path d="M 86 -106 Q 103 -136 120 -106 Z" fill={c("#8d929c")} />
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = toner(tod);
  return (
    <g>
      <OutdoorSky tod={tod} frame={frame} horizon={HORIZON} sunX={1500} />

      <Layer depth={0.2}>
        <path d={`M ${X0} ${HORIZON + 10} Q 200 ${HORIZON - 120} 620 ${HORIZON - 50} Q 1000 ${HORIZON + 10} 1300 ${HORIZON - 90} Q 1700 ${HORIZON - 170} ${X1} ${HORIZON - 30} L ${X1} ${HORIZON + 200} L ${X0} ${HORIZON + 200} Z`} fill={c(HILL_FAR)} />
      </Layer>

      <Layer depth={0.32}>
        <path d={`M ${X0} ${HORIZON + 40} Q 400 ${HORIZON - 40} 900 ${HORIZON + 20} Q 1300 ${HORIZON + 60} 1700 ${HORIZON} Q 1950 ${HORIZON - 30} ${X1} ${HORIZON + 10} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(HILL)} />
        <path d={`M 1180 ${HORIZON + 30} Q 1500 ${HORIZON - 20} 1900 ${HORIZON - 10} L ${X1} ${HORIZON + 10} L ${X1} ${HORIZON + 220} L 1000 ${HORIZON + 220} Z`} fill={c(WHEAT_DARK)} opacity={0.75} />
        <path d={`M ${X0} ${HORIZON + 30} Q 100 ${HORIZON - 30} 420 ${HORIZON - 14} Q 560 ${HORIZON - 4} 760 ${HORIZON + 60} L 900 ${HORIZON + 220} L ${X0} ${HORIZON + 220} Z`} fill={c(WHEAT)} opacity={0.7} />
        {[[180, 0.8], [260, 0.6], [1320, 0.7], [1760, 0.9]].map(([x, s]) => (
          <g key={x} transform={`translate(${x} ${HORIZON + 30}) scale(${s})`}>
            <rect x={-6} y={-60} width={12} height={60} fill={c("#6b5040")} />
            <circle cx={0} cy={-84} r={40} fill={c(HILL_DARK)} />
            <circle cx={-24} cy={-66} r={26} fill={c(HILL_DARK)} />
          </g>
        ))}
        <Barn tod={tod} frame={frame} />
      </Layer>

      <Layer depth={0.55}>
        <path d={`M ${X0} ${HORIZON + 80} Q 700 ${HORIZON + 50} 1300 ${HORIZON + 76} Q 1800 ${HORIZON + 96} ${X1} ${HORIZON + 70} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(WHEAT)} />
        <path d={`M ${X0} ${HORIZON + 80} Q 700 ${HORIZON + 50} 1300 ${HORIZON + 76} Q 1800 ${HORIZON + 96} ${X1} ${HORIZON + 70} L ${X1} ${HORIZON + 104} Q 1700 ${HORIZON + 124} 1200 ${HORIZON + 104} Q 600 ${HORIZON + 86} ${X0} ${HORIZON + 120} Z`} fill={c(WHEAT_LIGHT)} />
        {Array.from({ length: 7 }, (_, i) => {
          const y = HORIZON + 112 + i * 18;
          const wave = Math.sin(frame / 30 + i * 0.8) * 10;
          return <path key={i} d={`M ${X0} ${y} Q 500 ${y - 12 + wave} 1000 ${y} T ${X1} ${y}`} stroke={c(WHEAT_DARK)} strokeWidth={4} fill="none" opacity={0.45} />;
        })}
        {[220, 1100, 1980].map((x) => (
          <g key={x}>
            <rect x={x - 6} y={430} width={12} height={HORIZON + 160 - 430} fill={c("#7a5a40")} />
            <rect x={x - 34} y={448} width={68} height={8} rx={3} fill={c("#7a5a40")} />
          </g>
        ))}
        {[[220, 1100], [1100, 1980], [-660, 220]].map(([a, b]) =>
          [0, 1].map((k) => (
            <path key={`${a}-${k}`} d={`M ${a! + (k ? 30 : -30)} 450 Q ${(a! + b!) / 2} 500 ${b! + (k ? 30 : -30)} 450`} stroke={c("#4a4450")} strokeWidth={2.5} fill="none" opacity={0.7} />
          )),
        )}
      </Layer>

      <Layer depth={0.8}>
        <rect x={X0} y={790} width={X1 - X0} height={60} fill={c(VERGE)} />
        {Array.from({ length: 24 }, (_, i) => {
          const x = X0 + i * 110;
          return <rect key={i} x={x} y={732} width={14} height={78} rx={3} fill={c(POST)} />;
        })}
        <rect x={X0} y={746} width={X1 - X0} height={9} fill={c(POST)} />
        <rect x={X0} y={774} width={X1 - X0} height={9} fill={c(POST)} />
      </Layer>

      <Layer depth={1}>
        <rect x={X0} y={ROAD_TOP - 24} width={X1 - X0} height={30} fill={c("#c9b48a")} />
        <rect x={X0} y={ROAD_TOP} width={X1 - X0} height={ROAD_BOTTOM - ROAD_TOP} fill={c(ASPHALT)} />
        <rect x={X0} y={ROAD_TOP + 12} width={X1 - X0} height={6} fill={c("#e9e4d6")} />
        <rect x={X0} y={ROAD_BOTTOM - 18} width={X1 - X0} height={6} fill={c("#e9e4d6")} />
        {Array.from({ length: 16 }, (_, i) => (
          <rect key={i} x={X0 + i * 170} y={918} width={90} height={8} rx={2} fill={c("#f2c94c")} />
        ))}
        {Array.from({ length: 24 }, (_, i) => (
          <circle key={i} cx={X0 + random(`ac${i}`) * (X1 - X0)} cy={ROAD_TOP + 30 + random(`acy${i}`) * 120} r={3 + random(`acr${i}`) * 3} fill={c(mix(ASPHALT, "#000", 0.2))} />
        ))}
        {lit(tod) && Array.from({ length: 12 }, (_, i) => (
          <circle key={`ce${i}`} cx={X0 + 60 + i * 220} cy={ROAD_BOTTOM - 15} r={4} fill={ACCENT} opacity={0.85} />
        ))}
        <rect x={X0} y={ROAD_BOTTOM} width={X1 - X0} height={26} fill={c("#c9b48a")} />
        <path d={`M ${X0} ${ROAD_BOTTOM + 22} Q 700 ${ROAD_BOTTOM + 8} 1300 ${ROAD_BOTTOM + 20} Q 1700 ${ROAD_BOTTOM + 30} ${X1} ${ROAD_BOTTOM + 18} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(VERGE)} />
        {Array.from({ length: 14 }, (_, i) => {
          const x = X0 + 80 + random(`rt${i}`) * (X1 - X0 - 160);
          const y = ROAD_BOTTOM + 40 + random(`rty${i}`) * 60;
          return <path key={i} d={`M ${x - 10} ${y} L ${x - 4} ${y - 18} M ${x} ${y} L ${x + 2} ${y - 24} M ${x + 9} ${y} L ${x + 6} ${y - 16}`} stroke={c(HILL_DARK)} strokeWidth={4} strokeLinecap="round" />;
        })}
      </Layer>
    </g>
  );
}

function Front({ tod }: BgProps) {
  const c = toner(tod);
  const tuft = (x: number, y: number, s: number, col: string) => (
    <g key={x} transform={`translate(${x} ${y}) scale(${s})`} fill={col}>
      {[-45, -20, 0, 20, 45].map((a) => <path key={a} d="M 0 0 Q -8 -50 0 -110 Q 8 -50 0 0 Z" transform={`rotate(${a})`} />)}
    </g>
  );
  return (
    <Layer depth={1.15}>
      {tuft(-20, 1120, 1.3, c(WHEAT_DARK))}
      {tuft(1960, 1120, 1.2, c(HILL_DARK))}
    </Layer>
  );
}

export const road = { groundY: GROUND, horizonY: HORIZON, wallY: 380, Back, Front };
