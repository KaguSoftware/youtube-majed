import { Layer } from "../camera";
import { Glow, Moon, SkyGradient, Stars, X0, X1, Y0, Y1, lit, t, useGid, type BgProps } from "./common";

/** Classroom: warm yellow walls, green chalkboard, posters, wall clock, teacher's desk, tall window at the left. */
const GROUND = 885;
const WALL = "#f1d68c";
const WAINSCOT = "#d9a868";
const BOARD = "#3e7d5c";
const FRAME = "#a7734a";
const CHALK = "#e8efe6";

function TallWindow({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const clip = useGid();
  const [x, y, w, h] = [-200, 150, 330, 470];
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={y} width={w} height={h} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <SkyGradient tod={tod} top={y} bottom={y + h} />
        {tod === "night" && <Stars frame={frame} count={14} maxY={y + h} seed="cls" />}
        {tod === "night" && <Moon x={x + 250} y={y + 100} r={28} />}
        <circle cx={x + 220} cy={y + h - 40} r={90} fill={c("#6fa56a")} />
        <circle cx={x + 90} cy={y + h - 10} r={70} fill={c("#5d9460")} />
      </g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={c("#f5efe0")} strokeWidth={18} />
      {[1, 2].map((k) => <rect key={k} x={x} y={y + (k * h) / 3 - 5} width={w} height={10} fill={c("#f5efe0")} />)}
      <rect x={x + w / 2 - 5} y={y} width={10} height={h} fill={c("#f5efe0")} />
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const on = lit(tod);
  const tick = Math.floor(frame / 30);
  return (
    <g>
      <Layer depth={0.8}>
        <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill={c(WALL)} />
        <rect x={X0} y={Y0} width={X1 - X0} height={70 - Y0} fill={c("#f7e7b8")} />
        <rect x={X0} y={66} width={X1 - X0} height={8} fill={c(FRAME)} />
        {[700, 1220].map((x) => (
          <g key={x}>
            {on && <Glow x={x} y={110} r={420} opacity={0.3} color="#fff1c9" />}
            <rect x={x - 2} y={Y0} width={4} height={96 - Y0} fill={c("#7a6a55")} transform={`translate(-120 0)`} />
            <rect x={x - 2} y={Y0} width={4} height={96 - Y0} fill={c("#7a6a55")} transform={`translate(120 0)`} />
            <rect x={x - 160} y={92} width={320} height={22} rx={8} fill={c("#e5dcc8")} />
            <rect x={x - 148} y={110} width={296} height={8} rx={4} fill={on ? "#fff6dc" : c("#fffaf0")} />
          </g>
        ))}
        <rect x={X0} y={620} width={X1 - X0} height={GROUND - 620} fill={c(WAINSCOT)} />
        <rect x={X0} y={612} width={X1 - X0} height={14} fill={c(FRAME)} />
        <TallWindow tod={tod} frame={frame} />
        <g transform="translate(560 160)">
          <rect x={-20} y={-20} width={840} height={350} rx={8} fill={c(FRAME)} />
          <rect x={0} y={0} width={800} height={310} fill={c(BOARD)} />
          <g opacity={0.55} fill="none" stroke={c(CHALK)} strokeWidth={6} strokeLinecap="round">
            <path d="M 60 80 L 90 34 L 120 80 M 72 62 L 108 62" />
            <path d="M 150 60 l 30 0 M 165 45 l 0 30" />
            <path d="M 210 36 q 34 0 30 18 q -4 16 -30 16 q 34 2 30 20 q -4 14 -30 12 Z" />
            <path d="M 280 50 l 34 0 M 280 66 l 34 0" />
            <path d="M 360 34 q -30 0 -30 30 q 0 30 30 30" />
            <path d="M 60 160 Q 160 120 260 170 T 460 160" />
            <path d="M 60 230 L 400 230 M 60 262 L 300 262" opacity={0.6} />
            <circle cx={640} cy={140} r={70} />
            <path d="M 640 140 L 690 90 M 570 140 L 710 140" />
          </g>
          <rect x={-20} y={310} width={840} height={18} rx={4} fill={c("#8f6140")} />
          <rect x={120} y={302} width={36} height={10} rx={3} fill={c(CHALK)} />
          <rect x={600} y={300} width={60} height={14} rx={3} fill={c("#c26b5a")} />
        </g>
        <g transform="translate(260 190)">
          <rect x={0} y={0} width={200} height={260} rx={4} fill={c("#f7f1e3")} />
          {["#d0473d", "#4f81bd", "#9bbb59", "#e8b04b", "#8e6bbf", "#3fa7a0"].map((col, i) => (
            <circle key={i} cx={46 + (i % 3) * 54} cy={56 + Math.floor(i / 3) * 70} r={22} fill={c(col)} />
          ))}
          <rect x={30} y={190} width={140} height={14} rx={7} fill={c("#8a7c6a")} />
          <rect x={50} y={216} width={100} height={10} rx={5} fill={c("#b4a690")} />
        </g>
        <g transform="translate(1480 230)">
          <rect x={0} y={0} width={230} height={170} rx={4} fill={c("#2f4a72")} />
          <circle cx={70} cy={84} r={40} fill={c("#e8b04b")} />
          <ellipse cx={70} cy={84} rx={64} ry={14} fill="none" stroke={c("#f5d48a")} strokeWidth={5} />
          <circle cx={170} cy={60} r={18} fill={c("#d9786a")} />
          <circle cx={186} cy={124} r={10} fill={c("#9fd3e0")} />
        </g>
        <g transform="translate(1595 130)">
          <circle r={56} fill={c("#3c3f48")} />
          <circle r={46} fill={c("#fbf7ec")} />
          <path d={`M 0 0 L ${Math.sin(((tick % 60) / 60) * Math.PI * 2) * 36} ${-Math.cos(((tick % 60) / 60) * Math.PI * 2) * 36}`} stroke={c("#d0473d")} strokeWidth={3} strokeLinecap="round" />
          <path d="M 0 0 L 0 -30 M 0 0 L 20 8" stroke={c("#3c3f48")} strokeWidth={6} strokeLinecap="round" />
        </g>
        <g transform={`translate(1640 ${GROUND})`}>
          <rect x={0} y={-200} width={420} height={24} rx={4} fill={c("#9a6a44")} />
          <rect x={14} y={-176} width={400} height={176} fill={c("#b8835a")} />
          <rect x={34} y={-156} width={130} height={56} rx={4} fill={c("#c99a70")} />
          <circle cx={150} cy={-222} r={20} fill={c("#d0473d")} />
          <path d="M 150 -242 q 6 -10 14 -10" stroke={c("#5a9259")} strokeWidth={5} fill="none" />
          <rect x={210} y={-236} width={120} height={18} rx={3} fill={c("#4f81bd")} />
          <rect x={220} y={-252} width={100} height={16} rx={3} fill={c("#e8b04b")} />
        </g>
      </Layer>
      <Layer depth={1}>
        <rect x={X0} y={GROUND - 36} width={X1 - X0} height={Y1 - GROUND + 36} fill={c("#a8b39a")} />
        <rect x={X0} y={GROUND - 40} width={X1 - X0} height={10} fill={c("#7e6146")} />
        {[940, 1010, 1100].map((y) => <rect key={y} x={X0} y={y} width={X1 - X0} height={3} fill={c("#95a088")} />)}
        {Array.from({ length: 14 }, (_, i) => (
          <path key={i} d={`M ${X0 + i * 200} ${GROUND - 30} L ${X0 + i * 200 - (960 - X0 - i * 200) * 0.3} ${Y1}`} stroke={c("#95a088")} strokeWidth={3} />
        ))}
      </Layer>
    </g>
  );
}

export const classroom = { groundY: GROUND, horizonY: 400, wallY: 380, Back };
