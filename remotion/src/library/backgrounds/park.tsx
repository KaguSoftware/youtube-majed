import { random } from "remotion";
import { ACCENT, mix } from "../../theme";
import { Layer } from "../camera";
import { Glow, OutdoorSky, X0, X1, Y1, lit, t, type BgProps } from "./common";

/** park: fresh lawns, a sandy path, round trees, a pond, the town skyline far off. */
const GROUND = 885;
const HORIZON = 610;

const LAWN = "#86c46a";
const LAWN_LIGHT = "#9fd47e";
const LAWN_FAR = "#a3cf8a";
const LEAF = "#5fae5a";
const LEAF_DARK = "#468f4c";
const LEAF_FAR = "#8dbf86";
const TRUNK = "#8a6446";
const PATH = "#e6d2a2";
const POND = "#6cbad0";
const POND_DEEP = "#4f9fbe";

/** Night pulls the base toward moonlight first, so greens go teal-blue, not grey. */
const toner = (tod: BgProps["tod"]) => (hex: string) => t(tod)(tod === "night" ? mix(hex, "#6f8cff", 0.25) : hex);

/** A round deciduous tree: a trunk and a cluster of circles, with a darker underside. */
function Tree({ x, base, s, leaf, dark, trunk, sway = 0 }: { x: number; base: number; s: number; leaf: string; dark: string; trunk: string; sway?: number }) {
  return (
    <g transform={`translate(${x} ${base}) scale(${s})`}>
      <path d="M -14 0 L -9 -150 L 9 -150 L 14 0 Z" fill={trunk} />
      <path d="M 0 -120 L 34 -170" stroke={trunk} strokeWidth={10} strokeLinecap="round" />
      <g transform={`rotate(${sway} 0 -150)`}>
        <circle cx={0} cy={-230} r={92} fill={dark} />
        <circle cx={-62} cy={-190} r={66} fill={dark} />
        <circle cx={66} cy={-196} r={70} fill={dark} />
        <circle cx={-10} cy={-252} r={82} fill={leaf} />
        <circle cx={-64} cy={-210} r={54} fill={leaf} />
        <circle cx={58} cy={-220} r={58} fill={leaf} />
      </g>
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = toner(tod);
  const on = lit(tod);
  const sway = Math.sin(frame / 45) * 1.2;
  return (
    <g>
      <OutdoorSky tod={tod} frame={frame} horizon={HORIZON} sunX={1460} />

      <Layer depth={0.18}>
        {Array.from({ length: 14 }, (_, i) => {
          const x = 380 + i * 92 + random(`skx${i}`) * 20;
          const h = 70 + random(`skh${i}`) * 130;
          return (
            <g key={i}>
              <rect x={x} y={HORIZON + 20 - h} width={78} height={h} fill={c("#a9bccd")} />
              {on && [0, 1, 2, 3].map((j) => random(`skl${i}-${j}`) > 0.45 && (
                <rect key={j} x={x + 14 + (j % 2) * 34} y={HORIZON + 34 - h + Math.floor(j / 2) * 30} width={14} height={12} fill="#ffd98a" opacity={0.7} />
              ))}
            </g>
          );
        })}
      </Layer>

      <Layer depth={0.3}>
        <path d={`M ${X0} ${HORIZON + 20} Q 300 ${HORIZON - 40} 760 ${HORIZON} Q 1200 ${HORIZON + 30} 1600 ${HORIZON - 30} Q 1900 ${HORIZON - 50} ${X1} ${HORIZON} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(LAWN_FAR)} />
        {Array.from({ length: 18 }, (_, i) => {
          const x = X0 + i * 140 + random(`ftx${i}`) * 50;
          const r = 38 + random(`ftr${i}`) * 26;
          return <circle key={i} cx={x} cy={HORIZON + 16 - r * 0.4} r={r} fill={c(LEAF_FAR)} />;
        })}
      </Layer>

      <Layer depth={0.6}>
        <path d={`M ${X0} ${HORIZON + 70} Q 600 ${HORIZON + 40} 1100 ${HORIZON + 70} Q 1600 ${HORIZON + 100} ${X1} ${HORIZON + 60} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(LAWN)} />
        <ellipse cx={1290} cy={772} rx={330} ry={46} fill={c(mix(LAWN, "#000", 0.12))} />
        <ellipse cx={1290} cy={770} rx={316} ry={40} fill={c(POND)} />
        <ellipse cx={1310} cy={780} rx={220} ry={22} fill={c(POND_DEEP)} />
        {[0, 1, 2].map((i) => {
          const k = ((frame / 70 + i / 3) % 1);
          return <ellipse key={i} cx={1200} cy={768} rx={20 + k * 110} ry={4 + k * 14} fill="none" stroke={c("#d8f1f6")} strokeWidth={3} opacity={0.6 * (1 - k)} />;
        })}
        {tod !== "day" && <path d="M 1360 760 L 1440 760 M 1376 776 L 1424 776" stroke={tod === "dusk" ? "#ffc38a" : "#fff2c8"} strokeWidth={5} strokeLinecap="round" opacity={0.45} />}
        <Tree x={110} base={790} s={1.25} leaf={c(LEAF)} dark={c(LEAF_DARK)} trunk={c(TRUNK)} sway={sway} />
        <Tree x={760} base={720} s={0.62} leaf={c(mix(LEAF, LAWN_FAR, 0.35))} dark={c(mix(LEAF_DARK, LAWN_FAR, 0.35))} trunk={c(TRUNK)} />
        <Tree x={1820} base={780} s={1.15} leaf={c(LEAF)} dark={c(LEAF_DARK)} trunk={c(TRUNK)} sway={-sway} />
        <g transform="translate(1660 0)">
          {on && <Glow x={0} y={520} r={240} opacity={0.45} />}
          <rect x={-6} y={530} width={12} height={250} fill={c("#3d4a44")} />
          <rect x={-16} y={770} width={32} height={14} rx={4} fill={c("#3d4a44")} />
          <circle cx={0} cy={518} r={22} fill={on ? ACCENT : c("#f3ecd2")} />
          <path d="M -26 504 L 26 504 L 0 482 Z" fill={c("#3d4a44")} />
        </g>
      </Layer>

      <Layer depth={1}>
        <path d={`M ${X0} ${GROUND - 44} Q 500 ${GROUND - 70} 1000 ${GROUND - 46} Q 1500 ${GROUND - 24} ${X1} ${GROUND - 52} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(LAWN_LIGHT)} />
        <path d={`M ${X0} ${GROUND - 8} Q 600 ${GROUND - 36} 1100 ${GROUND - 14} Q 1600 ${GROUND + 6} ${X1} ${GROUND - 22} L ${X1} ${GROUND + 70} Q 1500 ${GROUND + 92} 1000 ${GROUND + 66} Q 500 ${GROUND + 42} ${X0} ${GROUND + 64} Z`} fill={c(PATH)} />
        <path d={`M ${X0} ${GROUND + 64} Q 500 ${GROUND + 42} 1000 ${GROUND + 66} Q 1500 ${GROUND + 92} ${X1} ${GROUND + 70}`} stroke={c(mix(PATH, "#000", 0.14))} strokeWidth={6} fill="none" />
        <path d={`M ${X0} 1030 Q 800 1000 ${X1} 1040 L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(LAWN)} />
        {Array.from({ length: 14 }, (_, i) => {
          const x = X0 + 80 + random(`pt${i}`) * (X1 - X0 - 160);
          const y = 990 + random(`pty${i}`) * 80;
          return <path key={i} d={`M ${x - 10} ${y} L ${x - 4} ${y - 18} M ${x} ${y} L ${x + 2} ${y - 24} M ${x + 9} ${y} L ${x + 6} ${y - 16}`} stroke={c(LEAF_DARK)} strokeWidth={4} strokeLinecap="round" />;
        })}
        {Array.from({ length: 10 }, (_, i) => {
          const x = X0 + 120 + random(`fl${i}`) * (X1 - X0 - 240);
          const y = 1000 + random(`fly${i}`) * 70;
          const col = ["#f6d35b", "#f28fb0", "#ffffff"][i % 3]!;
          return <circle key={i} cx={x} cy={y} r={7} fill={c(col)} />;
        })}
      </Layer>
    </g>
  );
}

function Front({ tod }: BgProps) {
  const c = toner(tod);
  return (
    <Layer depth={1.15}>
      {[[-30, 1110, 1.1], [1990, 1120, 1.25]].map(([x, y, s]) => (
        <g key={x} transform={`translate(${x} ${y}) scale(${s})`}>
          <circle cx={0} cy={-40} r={90} fill={c(LEAF_DARK)} />
          <circle cx={70} cy={-10} r={60} fill={c(LEAF)} />
          {[[-30, -90], [40, -60], [-60, -30]].map(([fx, fy]) => <circle key={fx} cx={fx} cy={fy} r={9} fill={c("#f28fb0")} />)}
        </g>
      ))}
    </Layer>
  );
}

export const park = { groundY: GROUND, horizonY: HORIZON, wallY: 380, Back, Front };
