import { ACCENT, C, mix } from "../../theme";
import { Layer } from "../camera";
import { Glow, Moon, SkyGradient, Stars, X0, X1, Y0, Y1, lit, t, useGid, type BgProps } from "./common";

const GROUND = 890;

function Window({ tod, frame }: BgProps) {
  const c = t(tod);
  const clip = useGid();
  const x = 1270;
  const y = 210;
  const w = 300;
  const h = 330;
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={y} width={w} height={h} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <SkyGradient tod={tod} top={y} bottom={y + h} />
        {tod === "night" && <Stars frame={frame} count={16} maxY={y + h} seed="win" />}
        {tod === "night" && <Moon x={x + 210} y={y + 90} r={32} />}
        <path d={`M ${x} ${y + h - 70} Q ${x + 120} ${y + h - 120} ${x + w} ${y + h - 80} L ${x + w} ${y + h} L ${x} ${y + h} Z`} fill={c("#6e9f86")} />
      </g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={c(C.woodDark)} strokeWidth={18} />
      <path d={`M ${x + w / 2} ${y} L ${x + w / 2} ${y + h} M ${x} ${y + h / 2} L ${x + w} ${y + h / 2}`} stroke={c(C.woodDark)} strokeWidth={10} />
      <rect x={x - 30} y={y + h + 4} width={w + 60} height={20} rx={4} fill={c(C.wood)} />
      <path d={`M ${x - 70} ${y - 30} Q ${x - 20} ${y + 160} ${x - 50} ${y + h + 40} L ${x + 30} ${y + h + 40} Q ${x + 40} ${y + 140} ${x + 20} ${y - 30} Z`} fill={c(C.rug)} />
      <path d={`M ${x + w + 70} ${y - 30} Q ${x + w + 20} ${y + 160} ${x + w + 50} ${y + h + 40} L ${x + w - 30} ${y + h + 40} Q ${x + w - 40} ${y + 140} ${x + w - 20} ${y - 30} Z`} fill={c(C.rug)} />
      <rect x={x - 90} y={y - 44} width={w + 180} height={16} rx={8} fill={c(C.woodDark)} />
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod);
  const on = lit(tod);
  return (
    <g>
      <Layer depth={0.8}>
        <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill={c(C.wall)} />
        {Array.from({ length: 40 }, (_, i) => (
          <rect key={i} x={X0 + i * 64} y={Y0} width={22} height={660 - Y0} fill={c(C.wallShade)} opacity={0.55} />
        ))}
        <rect x={X0} y={640} width={X1 - X0} height={GROUND - 640} fill={c(C.woodLight)} />
        <rect x={X0} y={630} width={X1 - X0} height={16} fill={c(C.woodDark)} />
        {Array.from({ length: 14 }, (_, i) => (
          <rect key={i} x={X0 + 30 + i * 180} y={672} width={140} height={160} rx={6} fill="none" stroke={c(C.wood)} strokeWidth={6} />
        ))}

        <Window tod={tod} frame={frame} />

        <g transform="translate(300 330)">
          <rect x={0} y={0} width={340} height={16} rx={4} fill={c(C.woodDark)} />
          {[["#c0504d", 30, 96], ["#4f81bd", 30, 84], ["#9bbb59", 26, 104], ["#e8b04b", 34, 78]].map(([col, w, hgt], i) => (
            <rect key={i} x={20 + i * 40} y={-(hgt as number)} width={w as number} height={hgt as number} rx={3} fill={c(col as string)} />
          ))}
          <path d="M 200 0 L 214 -86 L 236 -86 L 250 0 Z" fill={c(C.white)} />
          <path d="M 204 -24 L 246 -24 L 243 -44 L 207 -44 Z M 209 -64 L 241 -64 L 239 -80 L 211 -80 Z" fill={c(C.red)} />
          <rect x={210} y={-104} width={30} height={20} rx={3} fill={on ? ACCENT : c(C.glass)} />
          <circle cx={300} cy={-28} r={26} fill={c("#7fb3a3")} />
          <rect x={286} y={-12} width={28} height={12} fill={c("#b56b45")} />
        </g>

        <g transform="translate(820 240)">
          <rect x={0} y={0} width={180} height={140} rx={6} fill={c(C.woodDark)} />
          <rect x={12} y={12} width={156} height={116} fill={c("#a9d3e6")} />
          <rect x={12} y={84} width={156} height={44} fill={c("#3c7aa6")} />
          <path d="M 80 84 L 86 34 L 98 34 L 104 84 Z" fill={c(C.white)} />
          <path d="M 82 64 L 102 64 L 101 54 L 83 54 Z" fill={c(C.red)} />
        </g>

        <g transform="translate(1110 330)">
          {on && <Glow x={0} y={10} r={300} opacity={0.4} />}
          <path d="M -6 40 L 6 40 L 6 80 L -6 80 Z" fill={c(C.woodDark)} />
          <path d="M -36 -10 L 36 -10 L 26 40 L -26 40 Z" fill={on ? ACCENT : c("#f4e2b8")} />
          <path d="M -36 -10 L 36 -10 L 30 -22 L -30 -22 Z" fill={c(C.woodDark)} />
        </g>

        <g transform="translate(1700 380)">
          <rect x={0} y={0} width={190} height={GROUND - 380} rx={6} fill={c(C.woodDark)} />
          <rect x={18} y={18} width={154} height={200} rx={4} fill={c(C.wood)} />
          <rect x={18} y={240} width={154} height={240} rx={4} fill={c(C.wood)} />
          <circle cx={150} cy={260} r={9} fill={c("#e8c35a")} />
        </g>
      </Layer>

      <Layer depth={1}>
        <rect x={X0} y={GROUND - 40} width={X1 - X0} height={Y1 - GROUND + 40} fill={c(C.wood)} />
        <rect x={X0} y={GROUND - 44} width={X1 - X0} height={14} fill={c(C.woodDark)} />
        {[930, 990, 1070].map((y, r) => (
          <g key={y}>
            <path d={`M ${X0} ${y} L ${X1} ${y}`} stroke={c(C.woodDark)} strokeWidth={4} opacity={0.6} />
            {Array.from({ length: 9 }, (_, k) => {
              const x = X0 + (r % 2 ? 140 : 0) + k * 320;
              return <path key={k} d={`M ${x} ${y - (r ? 60 : 84) + (r === 2 ? -20 : 0)} L ${x} ${y}`} stroke={c(C.woodDark)} strokeWidth={4} opacity={0.5} />;
            })}
          </g>
        ))}
        <ellipse cx={960} cy={952} rx={400} ry={58} fill={c(C.rug)} />
        <ellipse cx={960} cy={952} rx={340} ry={42} fill="none" stroke={c(C.rugLight)} strokeWidth={8} />
        {on && <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} fill={mix("#ffb347", "#000", 0.2)} opacity={0.05} />}
      </Layer>
    </g>
  );
}

export const houseInterior = { groundY: GROUND, horizonY: 380, wallY: 400, Back };
