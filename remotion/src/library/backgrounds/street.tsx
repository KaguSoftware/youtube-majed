import { random } from "remotion";
import { ACCENT, C, mix } from "../../theme";
import { Layer } from "../camera";
import { Glow, OutdoorSky, X0, X1, Y1, lit, t, type BgProps } from "./common";

const GROUND = 880;
const HORIZON = 560;
const BASE = 810;

type House = { x: number; w: number; h: number; color: string; roof: string; shop?: boolean };
const HOUSES: House[] = [
  { x: -240, w: 420, h: 470, color: "#6fa3a0", roof: C.roof },
  { x: 180, w: 380, h: 540, color: "#e7c26b", roof: C.roofWarm },
  { x: 560, w: 470, h: 430, color: "#e58f73", roof: C.roof, shop: true },
  { x: 1030, w: 360, h: 560, color: "#8fb6d6", roof: C.roofWarm },
  { x: 1390, w: 430, h: 480, color: "#f0e3c4", roof: C.roof },
  { x: 1820, w: 380, h: 520, color: "#a9c98a", roof: C.roofWarm },
];

function Facade({ house, tod }: { house: House; tod: BgProps["tod"] }) {
  const c = t(tod);
  const { x, w, h, color, roof, shop } = house;
  const top = BASE - h;
  const on = lit(tod);
  const win = (wx: number, wy: number, key: string) => {
    const glow = on && random(`win-${key}`) > 0.35;
    return (
      <g key={key}>
        <rect x={wx} y={wy} width={64} height={84} rx={6} fill={glow ? "#ffd98a" : c(C.glass)} />
        <path d={`M ${wx + 32} ${wy} L ${wx + 32} ${wy + 84} M ${wx} ${wy + 42} L ${wx + 64} ${wy + 42}`} stroke={c(mix(color, "#000", 0.35))} strokeWidth={5} />
        <rect x={wx - 6} y={wy + 84} width={76} height={10} rx={3} fill={c(mix(color, "#000", 0.25))} />
      </g>
    );
  };
  return (
    <g>
      <rect x={x} y={top} width={w} height={h} fill={c(color)} />
      <rect x={x + w - 26} y={top} width={26} height={h} fill="#000" opacity={0.08} />
      <path d={`M ${x - 24} ${top + 4} L ${x + w / 2} ${top - 130} L ${x + w + 24} ${top + 4} Z`} fill={c(roof)} />
      <rect x={x + w * 0.66} y={top - 120} width={36} height={80} fill={c(mix(roof, "#000", 0.2))} />
      {win(x + w * 0.18, top + 50, `${x}a`)}
      {win(x + w * 0.62, top + 50, `${x}b`)}
      {h > 460 && win(x + w * 0.18, top + 190, `${x}c`)}
      {h > 460 && win(x + w * 0.62, top + 190, `${x}d`)}
      {shop ? (
        <g>
          <rect x={x + 40} y={BASE - 210} width={w - 80} height={150} rx={6} fill={on ? "#ffd98a" : c(C.glass)} />
          {Array.from({ length: 8 }, (_, i) => (
            <path
              key={i}
              d={`M ${x + 20 + i * ((w - 40) / 8)} ${BASE - 270} l ${(w - 40) / 8} 0 l 0 50 q ${-(w - 40) / 16} 18 ${-(w - 40) / 8} 0 Z`}
              fill={c(i % 2 ? C.white : C.red)}
            />
          ))}
          <text x={x + w / 2} y={BASE - 290} textAnchor="middle" fontFamily="Fredoka, sans-serif" fontWeight={700} fontSize={40} fill={c("#5a3a2a")}>
            BAKERY
          </text>
        </g>
      ) : (
        <g>
          <rect x={x + w / 2 - 42} y={BASE - 150} width={84} height={150} rx={8} fill={c(mix(color, "#000", 0.4))} />
          <circle cx={x + w / 2 + 24} cy={BASE - 70} r={6} fill={c("#e8c35a")} />
        </g>
      )}
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod);
  const on = lit(tod);
  return (
    <g>
      <OutdoorSky tod={tod} frame={frame} horizon={HORIZON} sunX={600} />
      <Layer depth={0.3}>
        {Array.from({ length: 12 }, (_, i) => {
          const x = X0 + i * 220;
          const h = 160 + random(`far${i}`) * 140;
          return <path key={i} d={`M ${x} ${HORIZON + 100} L ${x} ${HORIZON + 100 - h} L ${x + 100} ${HORIZON + 40 - h} L ${x + 200} ${HORIZON + 100 - h} L ${x + 200} ${HORIZON + 100} Z`} fill={c("#a7b4c9")} />;
        })}
      </Layer>
      <Layer depth={0.65}>
        {HOUSES.map((h) => <Facade key={h.x} house={h} tod={tod} />)}
        <rect x={X0} y={BASE} width={X1 - X0} height={70} fill={c(C.stone)} />
        <rect x={X0} y={BASE + 60} width={X1 - X0} height={14} fill={c(C.stoneDark)} />
      </Layer>
      <Layer depth={1}>
        <rect x={X0} y={GROUND - 20} width={X1 - X0} height={Y1 - GROUND + 20} fill={c(C.cobble)} />
        {Array.from({ length: 90 }, (_, i) => {
          const row = Math.floor(i / 18);
          const x = X0 + (i % 18) * 140 + (row % 2) * 70 + random(`cb${i}`) * 20;
          const y = GROUND + 20 + row * 46;
          return <ellipse key={i} cx={x} cy={y} rx={52 + row * 6} ry={14 + row * 2} fill={c(C.cobbleDark)} opacity={0.55} />;
        })}
        <g transform="translate(1520 0)">
          {on && <Glow x={0} y={420} r={320} opacity={0.45} />}
          <rect x={-10} y={430} width={20} height={GROUND - 430} fill={c("#30384a")} />
          <rect x={-22} y={GROUND - 30} width={44} height={30} rx={6} fill={c("#30384a")} />
          <path d="M -34 388 L 34 388 L 24 450 L -24 450 Z" fill={on ? ACCENT : c("#f6ebc8")} />
          <path d="M -40 388 L 40 388 L 0 352 Z" fill={c("#30384a")} />
        </g>
      </Layer>
    </g>
  );
}

export const street = { groundY: GROUND, horizonY: HORIZON, wallY: 380, Back };
