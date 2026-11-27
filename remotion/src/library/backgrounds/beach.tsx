import { random } from "remotion";
import { mix } from "../../theme";
import { Layer } from "../camera";
import { OutdoorSky, X0, X1, Y1, t, useGid, type BgProps } from "./common";

/** beach: turquoise sea rolling onto pale sand, a palm, a distant island. Ships sit on HORIZON. */
const GROUND = 885;
const HORIZON = 590;
const SUN_X = 1250;
const SHORE = 790; // where the wet sand meets the water (depth 1)

const SEA_FAR = "#2f8fb8";
const SEA_NEAR = "#47c2c6";
const SHALLOW = "#7fdccf";
const FOAM = "#f2fbfa";
const SAND = "#f1dcae";
const SAND_WET = "#d8bd8a";
const SAND_DRY = "#f6e6c2";
const PALM = "#4f9a5e";
const PALM_DARK = "#3c7d4c";
const TRUNK = "#b48a5e";

/** Night pulls the base toward moonlight first, so sand and sea stay blue and clear, not grey. */
const toner = (tod: BgProps["tod"]) => (hex: string) => t(tod)(tod === "night" ? mix(hex, "#6f8cff", 0.35) : hex);

function Palm({ x, base, tod, frame }: { x: number; base: number } & BgProps) {
  const c = toner(tod);
  const topX = x - 120;
  const topY = base - 520;
  const sway = Math.sin(frame / 40) * 3;
  const fronds = [-160, -120, -75, -30, 10, 50];
  return (
    <g>
      <path d={`M ${x - 22} ${base} Q ${x - 10} ${base - 300} ${topX - 12} ${topY + 6} L ${topX + 12} ${topY} Q ${x + 14} ${base - 300} ${x + 22} ${base} Z`} fill={c(TRUNK)} />
      {Array.from({ length: 9 }, (_, i) => {
        const k = (i + 1) / 10;
        const px = x + (topX - x) * k * k;
        const py = base - (base - topY) * k;
        return <path key={i} d={`M ${px - 18 + k * 6} ${py} q 18 8 ${36 - k * 12} 0`} stroke={c(mix(TRUNK, "#000", 0.22))} strokeWidth={5} fill="none" />;
      })}
      <g transform={`rotate(${sway} ${topX} ${topY})`}>
        {fronds.map((a, i) => (
          <path
            key={a}
            d="M 0 0 Q 90 -60 210 10 Q 120 -18 0 14 Z"
            transform={`translate(${topX} ${topY}) rotate(${a}) scale(${i % 2 ? 1 : 0.9})`}
            fill={c(i % 2 ? PALM : PALM_DARK)}
          />
        ))}
        {[-14, 6, 0].map((dx, i) => <circle key={i} cx={topX + dx} cy={topY + 18 + (i === 2 ? 14 : 0)} r={13} fill={c("#7a5a3a")} />)}
      </g>
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = toner(tod);
  const seaId = useGid();
  const glint = tod === "dusk" ? "#ffc38a" : tod === "night" ? "#fff2c8" : "#ffffff";
  const lap = Math.sin(frame / 28); // waves washing up and back
  return (
    <g>
      <OutdoorSky tod={tod} frame={frame} horizon={HORIZON} sunX={SUN_X} />

      <Layer depth={0.2}>
        <path d={`M 1440 ${HORIZON} Q 1520 ${HORIZON - 70} 1640 ${HORIZON - 60} Q 1720 ${HORIZON - 96} 1820 ${HORIZON - 40} Q 1880 ${HORIZON - 20} 1920 ${HORIZON} Z`} fill={c("#6f9e8e")} />
        <path d={`M 1700 ${HORIZON - 70} q 6 -40 -10 -64 M 1700 ${HORIZON - 132} q -30 -4 -44 14 M 1700 ${HORIZON - 132} q 30 -6 44 12 M 1700 ${HORIZON - 132} q -6 -22 -30 -26`} stroke={c("#5a8a7a")} strokeWidth={6} fill="none" strokeLinecap="round" />
        <path d={`M ${X0} ${HORIZON} Q 0 ${HORIZON - 26} 180 ${HORIZON - 14} Q 300 ${HORIZON - 4} 360 ${HORIZON} Z`} fill={c("#8fb0b0")} />
      </Layer>

      <Layer depth={0.35}>
        <defs>
          <linearGradient id={seaId} x1="0" y1={HORIZON} x2="0" y2={860} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={c(SEA_FAR)} />
            <stop offset="1" stopColor={c(SEA_NEAR)} />
          </linearGradient>
        </defs>
        <rect x={X0} y={HORIZON} width={X1 - X0} height={Y1 - HORIZON} fill={`url(#${seaId})`} />
        {Array.from({ length: 9 }, (_, i) => {
          const y = HORIZON + 8 + i * 22;
          const w = (tod === "day" ? 90 : 160) - i * 8 + Math.sin(frame / 14 + i * 1.7) * 18;
          return <path key={`g${i}`} d={`M ${SUN_X - w / 2} ${y} L ${SUN_X + w / 2} ${y}`} stroke={glint} strokeWidth={6} strokeLinecap="round" opacity={(tod === "day" ? 0.3 : 0.45) - i * 0.035} />;
        })}
        {Array.from({ length: 30 }, (_, i) => {
          const y = HORIZON + 14 + (i % 10) * 18 + random(`bwy${i}`) * 8;
          const x = X0 + random(`bwx${i}`) * (X1 - X0) + Math.sin(frame / 30 + i) * 14;
          const w = 24 + random(`bww${i}`) * 50 * ((y - HORIZON) / 120);
          return <path key={i} d={`M ${x} ${y} q ${w / 2} -6 ${w} 0`} stroke={c(FOAM)} strokeWidth={3} fill="none" opacity={0.45} strokeLinecap="round" />;
        })}
      </Layer>

      <Layer depth={0.7}>
        {[0, 1].map((k) => {
          const y = 742 + k * 26 + Math.sin(frame / 22 + k * 2) * 4;
          const dx = ((frame * (0.8 + k * 0.4)) % 320) - 320;
          return (
            <path
              key={k}
              d={`M ${X0 + dx} ${y} ${Array.from({ length: 12 }, () => `q 80 -16 160 0 t 160 0`).join(" ")}`}
              stroke={c(FOAM)}
              strokeWidth={6 - k}
              fill="none"
              strokeLinecap="round"
              opacity={0.75 - k * 0.2}
            />
          );
        })}
      </Layer>

      <Layer depth={1}>
        <path d={`M ${X0} ${SHORE - 20 + lap * 12} Q 500 ${SHORE - 44 + lap * 14} 1000 ${SHORE - 24 + lap * 12} Q 1500 ${SHORE - 6 + lap * 10} ${X1} ${SHORE - 30 + lap * 12} L ${X1} ${SHORE + 40} L ${X0} ${SHORE + 40} Z`} fill={c(SHALLOW)} opacity={0.85} />
        <path d={`M ${X0} ${SHORE - 18 + lap * 12} Q 500 ${SHORE - 42 + lap * 14} 1000 ${SHORE - 22 + lap * 12} Q 1500 ${SHORE - 4 + lap * 10} ${X1} ${SHORE - 28 + lap * 12}`} stroke={c(FOAM)} strokeWidth={9} fill="none" strokeLinecap="round" />
        <path d={`M ${X0} ${SHORE + 6} Q 600 ${SHORE - 14} 1100 ${SHORE + 4} Q 1600 ${SHORE + 20} ${X1} ${SHORE} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(SAND_WET)} />
        <path d={`M ${X0} ${SHORE + 6} Q 600 ${SHORE - 14} 1100 ${SHORE + 4} Q 1600 ${SHORE + 20} ${X1} ${SHORE}`} stroke={c(FOAM)} strokeWidth={5} fill="none" opacity={0.25 + 0.25 * Math.max(0, lap)} />
        <path d={`M ${X0} ${GROUND - 34} Q 500 ${GROUND - 56} 1000 ${GROUND - 36} Q 1500 ${GROUND - 18} ${X1} ${GROUND - 40} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(SAND)} />
        <path d={`M ${X0} 1000 Q 800 966 ${X1} 1004 L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(SAND_DRY)} />
        {Array.from({ length: 16 }, (_, i) => {
          const x = X0 + 80 + random(`sp${i}`) * (X1 - X0 - 160);
          const y = 915 + random(`spy${i}`) * 150;
          return <ellipse key={i} cx={x} cy={y} rx={5 + random(`spr${i}`) * 5} ry={3} fill={c(SAND_WET)} opacity={0.7} />;
        })}
        <g transform="translate(1660 1010) rotate(18)" fill={c("#ef8a6a")}>
          {[0, 72, 144, 216, 288].map((a) => <path key={a} d="M -7 0 L 0 -26 L 7 0 Z" transform={`rotate(${a})`} />)}
          <circle r={9} />
        </g>
        <path d="M 300 1040 q 22 -34 44 0 Z" fill={c("#f3c2b4")} />
        <ellipse cx={170} cy={950} rx={90} ry={16} fill={c(SAND_WET)} opacity={0.6} />
        <Palm x={170} base={955} tod={tod} frame={frame} />
      </Layer>
    </g>
  );
}

function Front({ tod }: BgProps) {
  const c = toner(tod);
  return (
    <Layer depth={1.15}>
      {[[1990, 1110, 1.3], [1880, 1130, 1]].map(([x, y, s]) => (
        <g key={x} transform={`translate(${x} ${y}) scale(${s})`} fill={c("#9bb46a")}>
          {[-50, -25, 0, 25, 50].map((a) => <path key={a} d="M 0 0 Q -8 -60 0 -130 Q 8 -60 0 0 Z" transform={`rotate(${a})`} />)}
        </g>
      ))}
    </Layer>
  );
}

export const beach = { groundY: GROUND, horizonY: HORIZON, wallY: 380, Back, Front };
