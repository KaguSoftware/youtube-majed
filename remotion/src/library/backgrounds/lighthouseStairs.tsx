import { ACCENT, C, mix } from "../../theme";
import { Layer } from "../camera";
import { Glow, SkyGradient, Stars, X0, X1, Y0, Y1, lit, t, useGid, type BgProps } from "./common";

const GROUND = 880;

function Back({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const shadeId = useGid();
  const clipId = useGid();
  const rows = Math.ceil((GROUND - Y0) / 72);
  const steps = 11;
  return (
    <g>
      <Layer depth={0.75}>
        <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0 + 40} fill={c(C.stone)} />
        {Array.from({ length: rows }, (_, r) => {
          const y = Y0 + r * 72;
          const off = r % 2 ? 0 : 90;
          return (
            <g key={r}>
              <path d={`M ${X0} ${y} L ${X1} ${y}`} stroke={c(C.stoneDark)} strokeWidth={4} opacity={0.6} />
              {Array.from({ length: 16 }, (_, k) => {
                const x = X0 + off + k * 180;
                return <path key={k} d={`M ${x} ${y} L ${x} ${y + 72}`} stroke={c(C.stoneDark)} strokeWidth={4} opacity={0.6} />;
              })}
            </g>
          );
        })}

        <defs>
          <clipPath id={clipId}>
            <circle cx={470} cy={300} r={74} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <SkyGradient tod={tod} top={200} bottom={400} />
          {tod === "night" && <Stars frame={frame} count={14} maxY={380} seed="port" />}
        </g>
        <circle cx={470} cy={300} r={74} fill="none" stroke={c("#5b6474")} strokeWidth={16} />
        <path d="M 396 300 L 544 300 M 470 226 L 470 374" stroke={c("#5b6474")} strokeWidth={8} />

        <path
          d={`M ${1560 + 150} ${GROUND - 40 + 62} L ${1560 - (steps - 1) * 86 + 150} ${GROUND - 40 - (steps - 1) * 62 + 62} L ${1560 - (steps - 1) * 86} ${GROUND - 40 - (steps - 1) * 62 + 62} L ${1560 - (steps - 1) * 86 + 70} ${GROUND - 40 - (steps - 1) * 62 + 150} L ${1560 + 40} ${GROUND + 30} Z`}
          fill={c("#5e4634")}
        />
        {Array.from({ length: steps }, (_, i) => {
          const x = 1560 - i * 86;
          const y = GROUND - 40 - i * 62;
          return (
            <g key={i}>
              <path d={`M ${x} ${y} L ${x + 150} ${y} L ${x + 150} ${y + 26} L ${x} ${y + 26} Z`} fill={c(C.woodLight)} />
              <path d={`M ${x} ${y + 26} L ${x + 150} ${y + 26} L ${x + 150} ${y + 62} L ${x} ${y + 62} Z`} fill={c(C.woodDark)} />
            </g>
          );
        })}
        <path d={`M 1720 ${GROUND - 150} L ${1720 - steps * 86} ${GROUND - 150 - steps * 62}`} stroke={c("#3a3f4c")} strokeWidth={9} strokeLinecap="round" />
        {Array.from({ length: 6 }, (_, i) => {
          const x = 1690 - i * 172;
          const y = GROUND - 128 - i * 124;
          return <path key={i} d={`M ${x} ${y} L ${x} ${y + 104}`} stroke={c("#3a3f4c")} strokeWidth={6} />;
        })}

        <g transform="translate(1100 400)">
          {lit(tod) && <Glow x={0} y={-10} r={260} opacity={0.42} />}
          <path d="M -26 30 L 26 30 L 18 50 L -18 50 Z" fill={c("#3a3f4c")} />
          <path d="M -20 -40 L 20 -40 L 24 30 L -24 30 Z" fill={lit(tod) ? ACCENT : c("#f1e4bf")} opacity={0.95} />
          <path d="M -26 -40 L 26 -40 L 14 -58 L -14 -58 Z" fill={c("#3a3f4c")} />
        </g>
      </Layer>

      <Layer depth={1}>
        <defs>
          <linearGradient id={shadeId} x1={X0} y1="0" x2={X1} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#000" stopOpacity={0.4} />
            <stop offset="0.3" stopColor="#000" stopOpacity={0} />
            <stop offset="0.7" stopColor="#000" stopOpacity={0} />
            <stop offset="1" stopColor="#000" stopOpacity={0.4} />
          </linearGradient>
        </defs>
        <rect x={X0} y={GROUND - 30} width={X1 - X0} height={Y1 - GROUND + 30} fill={c(mix(C.stoneDark, "#5a5148", 0.3))} />
        <path d={`M ${X0} ${GROUND - 30} L ${X1} ${GROUND - 30}`} stroke={c("#5a5148")} strokeWidth={6} />
        {[-60, 220, 520, 840, 1160, 1480, 1800, 2100].map((x, i) => (
          <path key={x} d={`M ${x} ${GROUND - 30} L ${x - 60 + i * 12} ${Y1}`} stroke={c("#7d7368")} strokeWidth={4} opacity={0.6} />
        ))}
        <path d={`M ${X0} 960 L ${X1} 960 M ${X0} 1050 L ${X1} 1050`} stroke={c("#7d7368")} strokeWidth={4} opacity={0.5} />
        <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} fill={`url(#${shadeId})`} />
      </Layer>
    </g>
  );
}

export const lighthouseStairs = { groundY: GROUND, horizonY: 300, wallY: 380, Back };
