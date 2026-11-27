import { random } from "remotion";
import { Layer } from "../camera";
import { Glow, X0, X1, Y0, Y1, t, useGid, type BgProps } from "./common";

/** Cave: violet rock arches, stalactites, a turquoise glowing pool, dark edges. Always dim. */
const GROUND = 885;
const POOL = "#45f0d6";
/** Top edge of the main arch opening at x. */
const archY = (x: number) => 130 + (x - 960) ** 2 / 1900;
const ARCH = `M 110 ${GROUND + 40} L 150 640 Q 140 420 230 330 Q 380 170 620 150 Q 800 100 960 125 Q 1150 100 1330 160 Q 1560 190 1690 330 Q 1790 430 1770 640 L 1810 ${GROUND + 40} Z`;

function Stalactites({ seed, from, to, n, color }: { seed: string; from: number; to: number; n: number; color: string }) {
  return (
    <g fill={color}>
      {Array.from({ length: n }, (_, i) => {
        const x = from + (i + random(`${seed}x${i}`) * 0.7) * ((to - from) / n);
        const y = archY(x) - 160;
        const len = 175 + random(`${seed}l${i}`) * 100;
        const w = 30 + random(`${seed}w${i}`) * 26;
        return <path key={i} d={`M ${x - w} ${y} Q ${x - w * 0.25} ${y + len * 0.55} ${x} ${y + len} Q ${x + w * 0.25} ${y + len * 0.55} ${x + w} ${y} Z`} />;
      })}
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const night = tod === "night";
  const edge = useGid();
  return (
    <g>
      <Layer depth={0.4}>
        <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} fill={c("#4f5790")} />
        <Glow x={960} y={760} r={900} opacity={0.4} color={POOL} />
        {[[430, 70], [760, 54], [1200, 62], [1500, 80]].map(([x, w]) => (
          <path key={x} d={`M ${x! - w!} 900 Q ${x! - 14} 560 ${x! - 12} 480 Q ${x! - 14} 400 ${x! - w! * 0.9} ${Y0} L ${x! + w! * 0.9} ${Y0} Q ${x! + 14} 400 ${x! + 12} 480 Q ${x! + 14} 560 ${x! + w!} 900 Z`} fill={c("#434a80")} />
        ))}
        <path d={`M ${X0} 780 Q 400 730 800 770 Q 1200 720 1500 760 Q 1800 740 ${X1} 770 L ${X1} 980 L ${X0} 980 Z`} fill={c("#3e4479")} />
      </Layer>
      <Layer depth={0.65}>
        <path d={`M ${X0} ${Y0} L ${X1} ${Y0} L ${X1} ${GROUND + 40} L ${X0} ${GROUND + 40} Z ${ARCH}`} fill={c("#342e5f")} fillRule="evenodd" />
        <path d={ARCH} fill="none" stroke={c("#5b5498")} strokeWidth={12} opacity={0.7} />
        <Stalactites seed="st" from={300} to={1620} n={9} color={c("#342e5f")} />
        {Array.from({ length: 40 }, (_, i) => {
          const x = X0 + random(`gw-x${i}`) * (X1 - X0);
          const y = Math.min(archY(x) - 50, Y0 + 80 + random(`gw-y${i}`) * 420);
          const tw = 0.4 + 0.6 * Math.abs(Math.sin(frame / (10 + random(`gw-t${i}`) * 12) + i));
          return <circle key={i} cx={x} cy={y} r={2.5 + random(`gw-r${i}`) * 2} fill="#a8fff0" opacity={tw} />;
        })}
      </Layer>
      <Layer depth={0.85}>
        <path d={`M ${X0} ${Y0} L 70 ${Y0} Q 150 300 90 600 Q 60 800 140 ${GROUND + 40} L ${X0} ${GROUND + 40} Z`} fill={c("#29234d")} />
        <path d={`M ${X1} ${Y0} L 1850 ${Y0} Q 1770 320 1830 620 Q 1860 800 1780 ${GROUND + 40} L ${X1} ${GROUND + 40} Z`} fill={c("#29234d")} />
        {[[240, 120, 40], [330, 70, 28], [1640, 140, 46], [1560, 80, 30]].map(([x, h, w]) => (
          <path key={x} d={`M ${x! - w!} 860 Q ${x! - w! * 0.3} ${860 - h! * 0.5} ${x} ${860 - h!} Q ${x! + w! * 0.3} ${860 - h! * 0.5} ${x! + w!} 860 Z`} fill={c("#3a3368")} />
        ))}
        <Glow x={960} y={830} r={520} opacity={0.5} color={POOL} />
        <ellipse cx={960} cy={848} rx={330} ry={44} fill={c("#2a2550")} />
        <ellipse cx={960} cy={846} rx={300} ry={34} fill={POOL} />
        <ellipse cx={940} cy={842} rx={200} ry={18} fill="#b6fff2" opacity={0.45} />
        {[0, 1, 2].map((i) => {
          const k = ((frame + i * 30) % 90) / 90;
          return <ellipse key={i} cx={1010} cy={846} rx={20 + k * 160} ry={4 + k * 18} fill="none" stroke="#e6fffa" strokeWidth={3} opacity={0.8 * (1 - k)} />;
        })}
      </Layer>
      <Layer depth={1}>
        <path d={`M ${X0} ${GROUND - 24} Q 300 ${GROUND - 44} 600 ${GROUND - 26} Q 960 ${GROUND - 12} 1300 ${GROUND - 30} Q 1650 ${GROUND - 46} ${X1} ${GROUND - 22} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c("#463f74")} />
        {Array.from({ length: 22 }, (_, i) => (
          <ellipse key={i} cx={X0 + random(`pb-x${i}`) * (X1 - X0)} cy={GROUND + 20 + random(`pb-y${i}`) * 200} rx={18 + random(`pb-r${i}`) * 40} ry={8 + random(`pb-r${i}`) * 12} fill={c("#3a3466")} />
        ))}
        <Glow x={960} y={GROUND + 10} r={600} opacity={0.25} color={POOL} />
        <defs>
          <radialGradient id={edge} cx={960} cy={620} r={1200} gradientUnits="userSpaceOnUse">
            <stop offset="0.4" stopColor="#0b0a1c" stopOpacity={0} />
            <stop offset="1" stopColor="#0b0a1c" stopOpacity={night ? 0.8 : 0.7} />
          </radialGradient>
        </defs>
        <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} fill={`url(#${edge})`} />
      </Layer>
    </g>
  );
}

function Front({ tod }: BgProps) {
  const c = t(tod, true);
  return (
    <Layer depth={1.15}>
      <g fill={c("#1a1636")}>
        <path d={`M ${X0} ${Y0} L 260 ${Y0} Q 200 40 120 60 L 90 170 L 60 70 Q 0 90 ${X0} 120 Z`} />
        <path d={`M ${X1} ${Y0} L 1700 ${Y0} Q 1740 20 1800 40 L 1830 140 L 1860 50 Q 1920 60 ${X1} 90 Z`} />
        <path d={`M ${X0} ${Y1} L ${X0} 1010 Q 0 980 90 1000 Q 160 1030 200 ${Y1} Z`} />
      </g>
    </Layer>
  );
}

export const cave = { groundY: GROUND, horizonY: 640, wallY: 380, Back, Front };
