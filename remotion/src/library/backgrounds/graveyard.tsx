import { random } from "remotion";
import { Layer } from "../camera";
import { OutdoorSky, X0, X1, Y0, Y1, lit, t, type BgProps } from "./common";

/** Old graveyard: tombstones, iron fence with a stone gate, crooked bare tree, low mist. */
const GROUND = 885;
const HORIZON = 620;
const STONES = [
  { x: 120, h: 130, w: 74, kind: 0, tilt: -6 },
  { x: 270, h: 96, w: 64, kind: 1, tilt: 4 },
  { x: 680, h: 118, w: 70, kind: 2, tilt: 0 },
  { x: 820, h: 84, w: 66, kind: 0, tilt: 7 },
  { x: 1100, h: 104, w: 70, kind: 0, tilt: -4 },
  { x: 1240, h: 140, w: 54, kind: 3, tilt: 2 },
  { x: 1590, h: 100, w: 70, kind: 1, tilt: -8 },
  { x: 1860, h: 124, w: 76, kind: 0, tilt: 5 },
];

type Tone = (hex: string) => string;

function Stone({ x, h, w, kind, tilt, c }: (typeof STONES)[number] & { c: Tone }) {
  const b = 845;
  const face = c("#a9afa7");
  const shade = c("#878e87");
  const shape =
    kind === 0 ? `M ${x - w / 2} ${b} L ${x - w / 2} ${b - h + w / 2} A ${w / 2} ${w / 2} 0 0 1 ${x + w / 2} ${b - h + w / 2} L ${x + w / 2} ${b} Z`
    : kind === 1 ? `M ${x - 12} ${b} L ${x - 12} ${b - h + 60} L ${x - w / 2} ${b - h + 60} L ${x - w / 2} ${b - h + 34} L ${x - 12} ${b - h + 34} L ${x - 12} ${b - h} L ${x + 12} ${b - h} L ${x + 12} ${b - h + 34} L ${x + w / 2} ${b - h + 34} L ${x + w / 2} ${b - h + 60} L ${x + 12} ${b - h + 60} L ${x + 12} ${b} Z`
    : kind === 2 ? `M ${x - w / 2} ${b} L ${x - w / 2} ${b - h} L ${x + w / 2} ${b - h} L ${x + w / 2} ${b} Z`
    : `M ${x - w / 2} ${b} L ${x - w / 3} ${b - h + 20} L ${x} ${b - h - 10} L ${x + w / 3} ${b - h + 20} L ${x + w / 2} ${b} Z`;
  return (
    <g transform={`rotate(${tilt} ${x} ${b})`}>
      <path d={shape} fill={face} />
      <rect x={x + w / 2 - 12} y={b - h + (kind === 0 ? w / 2 : 30)} width={12} height={h - (kind === 0 ? w / 2 : 30)} fill={shade} opacity={kind === 1 ? 0 : 1} />
      {kind !== 1 && <rect x={x - w / 4} y={b - h * 0.55} width={w / 2 - 6} height={6} rx={3} fill={shade} />}
      {kind !== 1 && <rect x={x - w / 4} y={b - h * 0.42} width={w / 3} height={6} rx={3} fill={shade} />}
      <ellipse cx={x - w / 4} cy={b - 4} rx={w / 3} ry={8} fill={c("#7b977c")} />
    </g>
  );
}

function Mist({ y, frame, speed, seed, opacity, n = 6 }: { y: number; frame: number; speed: number; seed: string; opacity: number; n?: number }) {
  const span = X1 - X0 + 800;
  return (
    <g fill="#e2eaec" opacity={opacity}>
      {Array.from({ length: n }, (_, i) => {
        const x = ((random(`${seed}${i}`) * span + frame * speed * (1 + i * 0.15)) % span) + X0 - 400;
        return <ellipse key={i} cx={x} cy={y + random(`${seed}y${i}`) * 30} rx={260 + random(`${seed}r${i}`) * 200} ry={26 + random(`${seed}h${i}`) * 16} />;
      })}
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod);
  const on = lit(tod);
  const bark = c("#3c4245");
  return (
    <g>
      <OutdoorSky tod={tod} frame={frame} horizon={HORIZON} sunX={1450} />
      <Layer depth={0.08}>
        <rect x={X0} y={Y0} width={X1 - X0} height={HORIZON + 60 - Y0} fill={tod === "day" ? "#a3b0b2" : "#6d5c78"} opacity={tod === "night" ? 0 : tod === "dusk" ? 0.3 : 0.5} />
      </Layer>
      <Layer depth={0.25}>
        <path d={`M ${X0} ${HORIZON + 10} Q 300 ${HORIZON - 70} 700 ${HORIZON - 10} Q 1100 ${HORIZON - 110} 1500 ${HORIZON - 30} Q 1800 ${HORIZON - 70} ${X1} ${HORIZON} L ${X1} 900 L ${X0} 900 Z`} fill={c("#8ea19e")} />
        <g transform={`translate(1150 ${HORIZON - 70})`} fill={c("#7a8e8b")}>
          <rect x={0} y={-60} width={140} height={90} />
          <path d="M -10 -60 L 70 -110 L 150 -60 Z" />
          <rect x={10} y={-170} width={40} height={130} />
          <path d="M 4 -170 L 30 -240 L 56 -170 Z" />
          <rect x={22} y={-140} width={16} height={26} rx={8} fill={on ? "#ffd98a" : c("#6a7d7a")} />
        </g>
        {[300, 360, 1700, 1760, 1820].map((x, i) => (
          <ellipse key={x} cx={x} cy={HORIZON - 40 - (i % 2) * 20} rx={18} ry={70 + (i % 2) * 20} fill={c("#6f857e")} />
        ))}
      </Layer>
      <Layer depth={0.5}>
        <rect x={X0} y={745} width={X1 - X0} height={300} fill={c("#7c9585")} />
        <g fill={c("#626f6c")}>
          {Array.from({ length: 64 }, (_, i) => {
            const x = X0 + i * 40;
            if (x > 740 && x < 1180) return null;
            return <path key={i} d={`M ${x - 3} 760 L ${x - 3} 655 L ${x} 640 L ${x + 3} 655 L ${x + 3} 760 Z`} />;
          })}
          <rect x={X0} y={668} width={740 - X0} height={6} />
          <rect x={X0} y={735} width={740 - X0} height={6} />
          <rect x={1180} y={668} width={X1 - 1180} height={6} />
          <rect x={1180} y={735} width={X1 - 1180} height={6} />
        </g>
        {[720, 1180].map((x) => (
          <g key={x} fill={c("#9ca39a")}>
            <rect x={x - 22} y={600} width={44} height={165} />
            <rect x={x - 30} y={588} width={60} height={18} />
            <circle cx={x} cy={572} r={18} />
          </g>
        ))}
        <path d="M 742 650 Q 960 600 1158 650" stroke={c("#626f6c")} strokeWidth={6} fill="none" />
        <Mist y={760} frame={frame} speed={0.5} seed="m1" opacity={tod === "night" ? 0.22 : 0.32} />
      </Layer>
      <Layer depth={0.7}>
        {STONES.map((s) => <Stone key={s.x} {...s} c={c} />)}
      </Layer>
      <Layer depth={0.8}>
        <path d="M 1660 870 Q 1690 700 1660 560 Q 1640 420 1700 300 L 1730 304 Q 1690 430 1720 560 Q 1750 720 1740 870 Z" fill={bark} />
        <g stroke={bark} fill="none" strokeLinecap="round">
          <path d="M 1700 310 Q 1660 200 1560 160 Q 1480 120 1420 140" strokeWidth={22} />
          <path d="M 1560 160 Q 1540 90 1580 30" strokeWidth={12} />
          <path d="M 1480 132 Q 1440 80 1360 90" strokeWidth={10} />
          <path d="M 1712 320 Q 1780 220 1860 200 Q 1950 170 2050 120" strokeWidth={20} />
          <path d="M 1860 200 Q 1880 120 1840 60" strokeWidth={10} />
          <path d="M 1690 470 Q 1600 430 1540 360" strokeWidth={14} />
          <path d="M 1700 300 Q 1720 180 1690 60 Q 1680 0 1720 -60" strokeWidth={14} />
          <path d="M 1430 138 L 1390 180 M 1520 146 L 1500 200 M 1790 230 L 1800 290 M 1960 160 L 1990 210" strokeWidth={7} />
        </g>
      </Layer>
      <Layer depth={1}>
        <path d={`M ${X0} ${GROUND - 26} Q 500 ${GROUND - 44} 960 ${GROUND - 28} Q 1400 ${GROUND - 14} ${X1} ${GROUND - 38} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c("#6c8775")} />
        <path d={`M 880 ${GROUND - 30} L 1040 ${GROUND - 30} L 1300 ${Y1} L 620 ${Y1} Z`} fill={c("#8e8b78")} />
        {Array.from({ length: 18 }, (_, i) => {
          const x = X0 + 60 + random(`gy${i}`) * (X1 - X0 - 120);
          const y = GROUND + random(`gyy${i}`) * 170;
          return <path key={i} d={`M ${x - 10} ${y} L ${x - 6} ${y - 22} M ${x} ${y} L ${x + 4} ${y - 28} M ${x + 9} ${y} L ${x + 12} ${y - 18}`} stroke={c("#566e5f")} strokeWidth={4} strokeLinecap="round" />;
        })}
        <Mist y={GROUND + 10} frame={frame} speed={0.8} seed="m2" opacity={tod === "night" ? 0.2 : 0.28} n={5} />
      </Layer>
    </g>
  );
}

function Front({ frame, tod }: BgProps) {
  return (
    <Layer depth={1.15}>
      <Mist y={Y1 - 280} frame={frame} speed={1.1} seed="m3" opacity={tod === "night" ? 0.18 : 0.24} n={4} />
    </Layer>
  );
}

export const graveyard = { groundY: GROUND, horizonY: HORIZON, wallY: 380, Back, Front };
