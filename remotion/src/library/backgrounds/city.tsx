import { random } from "remotion";
import { mix } from "../../theme";
import { Layer } from "../camera";
import { Glow, OutdoorSky, X0, X1, Y1, lit, t, type BgProps } from "./common";

/** city: cool concrete towers with lit windows, a colourful billboard, crosswalk and traffic light. */
const GROUND = 885;
const HORIZON = 560;
const BASE = 800; // foot of the mid-row buildings

const WARM = "#ffd98a";
const COOL = "#bfe6ff";
const POLE = "#3a4254";

/** Night pulls the base toward moonlight first, so concrete reads blue, not grey. */
const toner = (tod: BgProps["tod"]) => (hex: string) => t(tod)(tod === "night" ? mix(hex, "#6f8cff", 0.3) : hex);

const AWNINGS = ["#d0473d", "#2f9e8f", "#e0a24e", "#7b5ea7", "#3d7cc9"];

type Tower = { x: number; w: number; top: number; color: string; cols: number; glass?: boolean };
const TOWERS: Tower[] = [
  { x: -260, w: 330, top: 90, color: "#9aa7b8", cols: 4 },
  { x: 70, w: 290, top: 230, color: "#c9b8a6", cols: 3 },
  { x: 360, w: 360, top: 40, color: "#6f90b0", cols: 5, glass: true },
  { x: 720, w: 300, top: 300, color: "#b8c0c9", cols: 3 },
  { x: 1020, w: 340, top: 140, color: "#d29a7a", cols: 4 },
  { x: 1360, w: 300, top: 20, color: "#7e8fa6", cols: 3, glass: true },
  { x: 1660, w: 330, top: 210, color: "#a8b5a4", cols: 4 },
  { x: 1990, w: 200, top: 120, color: "#9aa7b8", cols: 2 },
];

function Building({ b, tod, frame }: { b: Tower } & BgProps) {
  const c = toner(tod);
  const on = lit(tod);
  const rows = Math.floor((600 - b.top) / 70);
  const awning = AWNINGS[Math.abs(Math.round(b.x / 10)) % AWNINGS.length]!;
  const gap = b.w / b.cols;
  const tick = Math.floor(frame / 45);
  return (
    <g>
      <rect x={b.x} y={b.top} width={b.w} height={BASE - b.top} fill={c(b.color)} />
      <rect x={b.x + b.w - 30} y={b.top} width={30} height={BASE - b.top} fill="#000" opacity={0.1} />
      <rect x={b.x - 8} y={b.top - 16} width={b.w + 16} height={18} fill={c(mix(b.color, "#000", 0.25))} />
      {Array.from({ length: rows * b.cols }, (_, i) => {
        const r = Math.floor(i / b.cols);
        const col = i % b.cols;
        const key = `${b.x}-${i}`;
        const x = b.x + col * gap + gap * 0.22;
        const y = b.top + 30 + r * 70;
        const roll = random(`cw-${key}`);
        // a few windows switch on and off as the night goes on
        const flick = random(`cwf-${key}-${tick}`) < 0.06;
        // fewer lit windows low down, where the figures stand
        const glow = on && (roll > (tod === "night" ? 0.38 : 0.6) + (y > 470 ? 0.22 : 0)) !== flick;
        const fill = glow ? (random(`cwc-${key}`) > 0.75 ? COOL : WARM) : c(mix(b.color, b.glass ? "#e2f1fa" : "#3a4660", b.glass ? 0.4 : 0.26));
        return <rect key={i} x={x} y={y} width={gap * 0.56} height={b.glass ? 52 : 40} rx={3} fill={fill} />;
      })}
      <rect x={b.x + 18} y={672} width={b.w - 36} height={BASE - 672} fill={c(mix(b.color, "#2a3550", 0.35))} />
      <rect x={b.x + 30} y={684} width={b.w - 110} height={92} rx={4} fill={on ? WARM : c(mix(b.color, "#e2f1fa", 0.35))} opacity={on ? 0.85 : 1} />
      <rect x={b.x + b.w - 70} y={690} width={40} height={BASE - 690} rx={4} fill={c(mix(b.color, "#1d1b29", 0.5))} />
      <path d={`M ${b.x + 10} 642 L ${b.x + b.w - 10} 642 L ${b.x + b.w - 2} 676 L ${b.x + 2} 676 Z`} fill={c(awning)} />
    </g>
  );
}

function Billboard({ tod, frame }: BgProps) {
  const c = toner(tod);
  const on = lit(tod);
  const k = (hex: string) => (on ? hex : c(hex));
  const blink = on && Math.floor(frame / 20) % 6 === 0 ? 0.55 : 1;
  return (
    <g transform="translate(1040 150)">
      {[60, 220].map((x) => <rect key={x} x={x} y={150} width={14} height={70} fill={c(POLE)} />)}
      {on && <Glow x={150} y={80} r={300} opacity={0.35} color="#ff7ab8" />}
      <rect x={-10} y={-10} width={320} height={170} rx={8} fill={c("#2c3346")} />
      <rect x={0} y={0} width={300} height={150} rx={4} fill={k("#ff6f91")} />
      <circle cx={225} cy={75} r={58} fill={k("#ffd166")} opacity={blink} />
      <path d="M 0 150 L 0 96 Q 70 70 150 110 Q 220 140 300 100 L 300 150 Z" fill={k("#3fc1c9")} />
      <text x={24} y={66} fontFamily="Fredoka, sans-serif" fontWeight={700} fontSize={50} fill={k("#ffffff")}>
        FIZZ!
      </text>
    </g>
  );
}

function TrafficLight({ tod, frame }: BgProps) {
  const c = toner(tod);
  const on = lit(tod);
  const cyc = frame % 210;
  const active = cyc < 90 ? 2 : cyc < 120 ? 1 : 0;
  const colors = ["#ff4d4d", "#ffc53d", "#3ddc84"];
  return (
    <g transform="translate(1640 0)">
      <rect x={-9} y={470} width={18} height={GROUND - 470} fill={c(POLE)} />
      <rect x={-20} y={GROUND - 22} width={40} height={22} rx={5} fill={c(POLE)} />
      <rect x={-34} y={330} width={68} height={170} rx={14} fill={c("#2a303d")} />
      {colors.map((col, i) => {
        const y = 362 + i * 54;
        const isOn = i === active;
        return (
          <g key={col}>
            {isOn && <Glow x={0} y={y} r={on ? 110 : 50} opacity={on ? 0.55 : 0.3} color={col} />}
            <circle cx={0} cy={y} r={20} fill={isOn ? col : c(mix(col, "#1d1b29", 0.7))} />
          </g>
        );
      })}
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = toner(tod);
  const on = lit(tod);
  return (
    <g>
      <OutdoorSky tod={tod} frame={frame} horizon={HORIZON} sunX={1500} />
      <Layer depth={0.25}>
        {Array.from({ length: 16 }, (_, i) => {
          const x = X0 + i * 160 + random(`fx${i}`) * 40;
          const h = 240 + random(`fh${i}`) * 260;
          const w = 110 + random(`fw${i}`) * 60;
          return (
            <g key={i}>
              <rect x={x} y={HORIZON + 120 - h} width={w} height={h} fill={c("#a9b6cc")} />
              {i % 4 === 1 && <rect x={x + w / 2 - 3} y={HORIZON + 60 - h} width={6} height={60} fill={c("#a9b6cc")} />}
              {on && Array.from({ length: 10 }, (_, j) => random(`fl${i}-${j}`) > 0.55 && (
                <rect key={j} x={x + 14 + (j % 3) * (w / 3.4)} y={HORIZON + 140 - h + Math.floor(j / 3) * 46} width={10} height={14} fill={WARM} opacity={0.75} />
              ))}
            </g>
          );
        })}
      </Layer>
      <Layer depth={0.6}>
        {TOWERS.map((b) => <Building key={b.x} b={b} tod={tod} frame={frame} />)}
        <Billboard tod={tod} frame={frame} />
        <rect x={X0} y={BASE} width={X1 - X0} height={60} fill={c("#8d96a5")} />
        <rect x={X0} y={BASE + 50} width={X1 - X0} height={12} fill={c("#6f7888")} />
      </Layer>
      <Layer depth={1}>
        <rect x={X0} y={GROUND - 26} width={X1 - X0} height={110} fill={c("#b9bfc8")} />
        {Array.from({ length: 22 }, (_, i) => (
          <rect key={i} x={X0 + i * 120} y={GROUND - 26} width={4} height={110} fill={c("#a3aab5")} />
        ))}
        <rect x={X0} y={GROUND + 80} width={X1 - X0} height={16} fill={c("#8a919c")} />
        <rect x={X0} y={GROUND + 96} width={X1 - X0} height={Y1 - GROUND - 96} fill={c("#4c5466")} />
        {Array.from({ length: 9 }, (_, i) => {
          const x = 640 + i * 76;
          return <path key={i} d={`M ${x} ${GROUND + 112} L ${x + 44} ${GROUND + 112} L ${x + 70} ${Y1} L ${x + 4} ${Y1} Z`} fill={c("#e8ebef")} opacity={0.9} />;
        })}
        <g transform="translate(300 0)">
          {on && <Glow x={75} y={420} r={300} opacity={0.4} />}
          <rect x={-8} y={430} width={16} height={GROUND - 430} fill={c(POLE)} />
          <path d={`M 0 432 Q 0 400 50 400 L 70 400`} stroke={c(POLE)} strokeWidth={12} fill="none" />
          <rect x={40} y={398} width={70} height={18} rx={8} fill={on ? WARM : c("#e8e2cc")} />
        </g>
        <TrafficLight tod={tod} frame={frame} />
      </Layer>
    </g>
  );
}

export const city = { groundY: GROUND, horizonY: HORIZON, wallY: 380, Back };
