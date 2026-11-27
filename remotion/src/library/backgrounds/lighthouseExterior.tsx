import { random } from "remotion";
import { ACCENT, C, mix } from "../../theme";
import { Layer } from "../camera";
import { Glow, OutdoorSky, X0, X1, Y1, lit, t, useGid, type BgProps } from "./common";

const HORIZON = 600;
const GROUND = 880;

/** Half-width of the tower at height y (it tapers toward the top). */
const tower = { x: 400, base: 742, top: 286, wBase: 84, wTop: 58 };
const halfW = (y: number) => tower.wTop + ((y - tower.top) / (tower.base - tower.top)) * (tower.wBase - tower.wTop);

function Lighthouse({ tod, frame }: BgProps) {
  const c = t(tod);
  const beamId = useGid();
  const bands = 5;
  const bandH = (tower.base - tower.top) / bands;
  const lampY = 246;
  const on = lit(tod);
  const theta = frame * 0.045;
  const reach = Math.cos(theta);
  const flare = Math.max(0, 1 - Math.abs(reach) * 4);
  return (
    <g>
      {on && (
        <g opacity={tod === "night" ? 0.55 : 0.3}>
          <defs>
            <linearGradient id={beamId} x1={tower.x} y1="0" x2={tower.x + reach * 1500} y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor={ACCENT} stopOpacity={0.9} />
              <stop offset="1" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path
            d={`M ${tower.x} ${lampY - 6} L ${tower.x + reach * 1500} ${lampY - 110} L ${tower.x + reach * 1500} ${lampY + 120} L ${tower.x} ${lampY + 6} Z`}
            fill={`url(#${beamId})`}
            opacity={0.35 + 0.35 * Math.abs(reach)}
          />
          <Glow x={tower.x} y={lampY} r={160 + flare * 160} opacity={0.5 + flare * 0.4} />
        </g>
      )}
      {Array.from({ length: bands }, (_, i) => {
        const y0 = tower.top + i * bandH;
        const y1 = y0 + bandH;
        return (
          <path
            key={i}
            d={`M ${tower.x - halfW(y0)} ${y0} L ${tower.x + halfW(y0)} ${y0} L ${tower.x + halfW(y1)} ${y1} L ${tower.x - halfW(y1)} ${y1} Z`}
            fill={c(i % 2 ? C.white : C.red)}
          />
        );
      })}
      <path
        d={`M ${tower.x + 18} ${tower.top} L ${tower.x + halfW(tower.top)} ${tower.top} L ${tower.x + halfW(tower.base)} ${tower.base} L ${tower.x + 26} ${tower.base} Z`}
        fill="#000"
        opacity={0.12}
      />
      <rect x={tower.x - 18} y={tower.base - 74} width={36} height={74} rx={16} fill={c(C.woodDark)} />
      {[420, 560].map((y) => (
        <rect key={y} x={tower.x - 11} y={y} width={22} height={30} rx={10} fill={on ? "#ffd98a" : c("#3d4b66")} />
      ))}
      <rect x={tower.x - 86} y={tower.top - 12} width={172} height={16} rx={4} fill={c("#2f3a4f")} />
      <path d={`M ${tower.x - 80} ${tower.top - 12} L ${tower.x - 80} ${tower.top - 38} L ${tower.x + 80} ${tower.top - 38} L ${tower.x + 80} ${tower.top - 12}`} fill="none" stroke={c("#2f3a4f")} strokeWidth={5} />
      {[-60, -30, 0, 30, 60].map((dx) => <path key={dx} d={`M ${tower.x + dx} ${tower.top - 38} L ${tower.x + dx} ${tower.top - 12}`} stroke={c("#2f3a4f")} strokeWidth={4} />)}
      <rect x={tower.x - 46} y={lampY - 34} width={92} height={62} rx={6} fill={on ? ACCENT : c(C.glass)} />
      {[-20, 8].map((dx) => <path key={dx} d={`M ${tower.x + dx} ${lampY - 34} L ${tower.x + dx + 6} ${lampY + 28}`} stroke={c("#2f3a4f")} strokeWidth={5} />)}
      <path d={`M ${tower.x - 56} ${lampY - 32} Q ${tower.x} ${lampY - 110} ${tower.x + 56} ${lampY - 32} Z`} fill={c(C.redDark)} />
      <circle cx={tower.x} cy={lampY - 86} r={9} fill={c("#2f3a4f")} />
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod);
  const seaId = useGid();
  return (
    <g>
      <OutdoorSky tod={tod} frame={frame} horizon={HORIZON} sunX={1480} />

      <Layer depth={0.2}>
        <path d={`M 1050 ${HORIZON} Q 1180 ${HORIZON - 58} 1320 ${HORIZON - 30} Q 1420 ${HORIZON - 64} 1560 ${HORIZON} Z`} fill={c("#7d93a8")} />
        <path d={`M 1700 ${HORIZON} Q 1820 ${HORIZON - 34} ${X1} ${HORIZON - 20} L ${X1} ${HORIZON} Z`} fill={c("#8aa0b3")} />
      </Layer>

      <Layer depth={0.35}>
        <defs>
          <linearGradient id={seaId} x1="0" y1={HORIZON} x2="0" y2={Y1} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={c(C.sea)} />
            <stop offset="1" stopColor={c(C.seaDeep)} />
          </linearGradient>
        </defs>
        <rect x={X0} y={HORIZON} width={X1 - X0} height={Y1 - HORIZON} fill={`url(#${seaId})`} />
        {tod !== "day" &&
          Array.from({ length: 9 }, (_, i) => {
            const y = HORIZON + 10 + i * 26;
            const w = 150 - i * 9 + Math.sin(frame / 14 + i * 1.7) * 18;
            return <path key={`r${i}`} d={`M ${1480 - w / 2} ${y} L ${1480 + w / 2} ${y}`} stroke={tod === "dusk" ? "#ffc38a" : "#fff2c8"} strokeWidth={7} strokeLinecap="round" opacity={0.42 - i * 0.035} />;
          })}
        {Array.from({ length: 26 }, (_, i) => {
          const y = HORIZON + 18 + (i % 9) * 30 + random(`wy${i}`) * 10;
          const x = X0 + random(`wx${i}`) * (X1 - X0) + Math.sin(frame / 30 + i) * 14;
          const w = 30 + random(`ww${i}`) * 60 * ((y - HORIZON) / 200);
          return <path key={i} d={`M ${x} ${y} q ${w / 2} -6 ${w} 0`} stroke={c(C.foam)} strokeWidth={3} fill="none" opacity={0.5} strokeLinecap="round" />;
        })}
      </Layer>

      <Layer depth={0.6}>
        <path d={`M 120 860 L 170 760 Q 240 712 330 724 L 470 718 Q 600 716 660 780 L 720 860 Z`} fill={c(C.rock)} />
        <path d={`M 470 718 Q 600 716 660 780 L 720 860 L 560 860 Q 560 770 470 718 Z`} fill={c(C.rockDark)} />
        <path d={`M 160 800 q 30 -10 60 4 M 560 800 q 40 -8 70 6`} stroke={c(C.foam)} strokeWidth={4} fill="none" opacity={0.7} />
        <Lighthouse tod={tod} frame={frame} />
      </Layer>
    </g>
  );
}

function Ground({ tod }: BgProps) {
  const c = t(tod);
  return (
    <Layer depth={1}>
      <path d={`M ${X0} 846 Q 300 826 700 842 Q 1100 858 1500 836 Q 1800 822 ${X1} 840 L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(C.grass)} />
      <path d={`M ${X0} 846 Q 300 826 700 842 Q 1100 858 1500 836 Q 1800 822 ${X1} 840 L ${X1} 860 Q 1500 852 1100 874 Q 700 860 300 846 L ${X0} 866 Z`} fill={c(mix(C.grass, "#ffffff", 0.18))} />
      <path d={`M ${X0} 990 Q 800 960 ${X1} 1000 L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(C.grassDark)} />
      {Array.from({ length: 22 }, (_, i) => {
        const x = X0 + 60 + random(`tuft${i}`) * (X1 - X0 - 120);
        const y = 880 + random(`tufty${i}`) * 170;
        return <path key={i} d={`M ${x - 10} ${y} L ${x - 4} ${y - 18} M ${x} ${y} L ${x + 2} ${y - 24} M ${x + 9} ${y} L ${x + 6} ${y - 16}`} stroke={c(C.grassDark)} strokeWidth={4} strokeLinecap="round" />;
      })}
      {[260, 1180, 1660].map((x) => (
        <ellipse key={x} cx={x} cy={938 + (x % 3) * 12} rx={34} ry={14} fill={c(C.rock)} />
      ))}
    </Layer>
  );
}

export const lighthouseExterior = {
  groundY: GROUND,
  horizonY: HORIZON,
  wallY: 380,
  Back: (p: BgProps) => (
    <>
      <Back {...p} />
      <Ground {...p} />
    </>
  ),
};
