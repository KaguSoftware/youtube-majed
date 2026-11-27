import { random } from "remotion";
import { Layer } from "../camera";
import { Glow, Moon, SkyGradient, Stars, X0, X1, Y0, Y1, lit, t, useGid, type BgProps } from "./common";

/** Open-plan office: cool grey-blue walls, teal partitions, blinds, tube lights, water cooler. */
const GROUND = 885;
const WALL = "#c3cfd9";
const WALL_LOW = "#a9b8c5";
const TEAL = "#3f9a92";
const PANEL = "#8ea3b2";
const DARK = "#3a4652";

/** A window with half-lowered venetian blinds; the sky shows through the gaps. */
function BlindWindow({ tod, frame, x, w, seed }: BgProps & { x: number; w: number; seed: string }) {
  const c = t(tod, true);
  const clip = useGid();
  const y = 150;
  const h = 300;
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={y} width={w} height={h} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <SkyGradient tod={tod} top={y} bottom={y + h} />
        {tod === "night" && <Stars frame={frame} count={14} maxY={y + h} seed={seed} />}
        {tod === "night" && seed === "ofL" && <Moon x={x + w - 120} y={y + 172} r={26} />}
        {[0, 1, 2, 3, 4].map((i) => {
          const bx = x + i * (w / 5) + 10;
          const by = y + h - 60 - random(`${seed}-b${i}`) * 70;
          return (
            <g key={i}>
              <rect x={bx} y={by} width={w / 5 - 24} height={200} fill={c(tod === "night" ? "#4d5a78" : "#9aaabd")} />
              {lit(tod) && [0, 1, 2].map((k) => (random(`${seed}-w${i}-${k}`) > 0.4 ? <rect key={k} x={bx + 12 + (k % 2) * 30} y={by + 14 + k * 22} width={14} height={10} fill="#ffd98a" opacity={0.85} /> : null))}
            </g>
          );
        })}
        {Array.from({ length: 13 }, (_, i) => (
          <rect key={i} x={x} y={y + i * 12} width={w} height={i < 7 ? 12 : 6} fill={c("#e9eef2")} />
        ))}
        {Array.from({ length: 13 }, (_, i) => (
          <rect key={i} x={x} y={y + i * 12 + (i < 7 ? 10 : 6)} width={w} height={2} fill={c("#c6d0d8")} />
        ))}
      </g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={c("#eef2f5")} strokeWidth={16} />
      <rect x={x + w / 2 - 5} y={y} width={10} height={h} fill={c("#eef2f5")} />
      <rect x={x - 24} y={y + h + 6} width={w + 48} height={16} rx={3} fill={c("#dfe6ec")} />
    </g>
  );
}

function Monitor({ x, tod, frame, i }: { x: number; tod: BgProps["tod"]; frame: number; i: number }) {
  const c = t(tod, true);
  const on = lit(tod);
  const blink = Math.sin(frame / 9 + i * 2) > 0.2 ? 1 : 0.55;
  return (
    <g>
      {on && <Glow x={x} y={600} r={130} opacity={0.3} color="#8fe0ee" />}
      <rect x={x - 6} y={628} width={12} height={30} fill={c(DARK)} />
      <rect x={x - 62} y={566} width={124} height={74} rx={6} fill={c(DARK)} />
      <rect x={x - 54} y={574} width={108} height={58} rx={2} fill={on ? "#86d2df" : c("#9fcfd8")} />
      <rect x={x - 44} y={584} width={50} height={6} rx={3} fill={on ? "#d8f6fb" : c("#d6eef2")} />
      <rect x={x - 44} y={598} width={72} height={6} rx={3} fill={on ? "#d8f6fb" : c("#d6eef2")} opacity={0.8} />
      <rect x={x - 44} y={612} width={10} height={8} fill="#e6fbff" opacity={blink * 0.9} />
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const on = lit(tod);
  const flick = random(`tube-${Math.floor(frame / 4)}`) > 0.94 ? 0.55 : 1;
  return (
    <g>
      <Layer depth={0.8}>
        <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill={c(WALL)} />
        <rect x={X0} y={Y0} width={X1 - X0} height={100 - Y0} fill={c("#dde3e9")} />
        <rect x={X0} y={96} width={X1 - X0} height={10} fill={c("#a3b1bd")} />
        {[-60, 640, 1300, 1980].map((x) => (
          <rect key={x} x={x} y={100} width={36} height={GROUND - 100} fill={c(WALL_LOW)} opacity={0.5} />
        ))}
        {[300, 960, 1620].map((x, i) => (
          <g key={x}>
            {on && <Glow x={x} y={110} r={380} opacity={0.32} color="#eaf6ff" />}
            <rect x={x - 150} y={30} width={300} height={34} rx={6} fill={c("#b4c0ca")} />
            <rect x={x - 138} y={38} width={276} height={18} rx={9} fill="#f2fbff" opacity={i === 1 ? flick : 1} />
          </g>
        ))}
        <BlindWindow tod={tod} frame={frame} x={130} w={460} seed="ofL" />
        <BlindWindow tod={tod} frame={frame} x={1330} w={460} seed="ofR" />
        <g transform="translate(860 230)">
          <rect x={0} y={0} width={200} height={70} rx={8} fill={c(TEAL)} />
          <circle cx={42} cy={35} r={18} fill={c("#e9f4f2")} />
          <rect x={72} y={24} width={100} height={9} rx={4} fill={c("#e9f4f2")} />
          <rect x={72} y={40} width={66} height={7} rx={3} fill={c("#bfe0dc")} />
        </g>
        <rect x={X0} y={548} width={X1 - X0} height={12} fill={c(TEAL)} opacity={0.75} />
        <rect x={X0} y={560} width={X1 - X0} height={GROUND - 560} fill={c(WALL_LOW)} />
        {[150, 720, 1200].map((x, i) => <Monitor key={x} x={x} tod={tod} frame={frame} i={i} />)}
        <rect x={X0} y={652} width={X1 - X0} height={GROUND - 652} fill={c(PANEL)} />
        <rect x={X0} y={646} width={X1 - X0} height={14} rx={4} fill={c(TEAL)} />
        {Array.from({ length: 9 }, (_, i) => (
          <rect key={i} x={X0 + 100 + i * 300} y={660} width={6} height={GROUND - 660} fill={c("#7d93a3")} />
        ))}
        <g transform={`translate(1810 ${GROUND})`}>
          <rect x={-42} y={-250} width={84} height={250} rx={8} fill={c("#e7ecf0")} />
          <rect x={-42} y={-120} width={84} height={6} fill={c("#c5d0d8")} />
          <rect x={-24} y={-170} width={18} height={12} rx={3} fill={c("#4f86c6")} />
          <rect x={6} y={-170} width={18} height={12} rx={3} fill={c("#d9564c")} />
          <path d="M -46 -250 L 46 -250 L 40 -270 L -40 -270 Z" fill={c("#cfd8df")} />
          <rect x={-36} y={-388} width={72} height={120} rx={22} fill={c("#8cc8e6")} opacity={0.85} />
          <rect x={-26} y={-372} width={14} height={86} rx={7} fill={c("#c7e6f4")} opacity={0.8} />
        </g>
      </Layer>
      <Layer depth={1}>
        <rect x={X0} y={GROUND - 36} width={X1 - X0} height={Y1 - GROUND + 36} fill={c("#6c7d8d")} />
        <rect x={X0} y={GROUND - 40} width={X1 - X0} height={10} fill={c("#56636f")} />
        {[960, 1060].map((y) => (
          <rect key={y} x={X0} y={y} width={X1 - X0} height={3} fill={c("#5f6f7e")} />
        ))}
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={X0 + i * 240} y={GROUND - 30} width={3} height={Y1 - GROUND + 30} fill={c("#5f6f7e")} />
        ))}
      </Layer>
    </g>
  );
}

export const office = { groundY: GROUND, horizonY: 400, wallY: 360, Back };
