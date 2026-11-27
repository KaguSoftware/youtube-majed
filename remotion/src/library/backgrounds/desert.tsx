import { random } from "remotion";
import { mix } from "../../theme";
import { Layer } from "../camera";
import { OutdoorSky, Stars, X0, X1, Y1, t, useGid, type BgProps } from "./common";

/** desert: ochre dunes, purple mesas, saguaros; heat haze by day, a sky full of stars at night. */
const GROUND = 885;
const HORIZON = 620;

const SAND = "#e8b46e";
const SAND_LIGHT = "#f0c88a";
const SAND_DARK = "#cf9455";
const TERRA = "#c46a45";
const MESA = "#a07aa6";
const MESA_SHADE = "#86628f";
const MESA_FAR = "#c3a3c0";
const CACTUS = "#6f9558";
const CACTUS_DARK = "#557a45";

/** A flat-topped mesa: steep sides, a shaded right flank. */
function Mesa({ x, w, h, top, color, shade }: { x: number; w: number; h: number; top: number; color: string; shade: string }) {
  const b = HORIZON + 30;
  const y = b - h;
  const s = (w - top) / 2;
  return (
    <g>
      <path d={`M ${x} ${b} L ${x + s * 0.7} ${y + h * 0.25} L ${x + s} ${y} L ${x + s + top} ${y} L ${x + w - s * 0.6} ${y + h * 0.3} L ${x + w} ${b} Z`} fill={color} />
      <path d={`M ${x + s + top * 0.72} ${y} L ${x + s + top} ${y} L ${x + w - s * 0.6} ${y + h * 0.3} L ${x + w} ${b} L ${x + s + top * 0.8} ${b} Z`} fill={shade} />
      <rect x={x + s * 0.6} y={y + h * 0.42} width={w - s * 1.2} height={8} fill={shade} opacity={0.5} />
    </g>
  );
}

/** Saguaro: thick round-capped strokes, so it stays a flat shape with no outline. */
function Saguaro({ x, base, h, color, shade }: { x: number; base: number; h: number; color: string; shade: string }) {
  const w = h * 0.16;
  const arm = (dir: number, at: number, up: number) =>
    `M ${x} ${base - h * at} L ${x + dir * h * 0.22} ${base - h * at} L ${x + dir * h * 0.22} ${base - h * (at + up)}`;
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={arm(-1, 0.45, 0.28)} stroke={color} strokeWidth={w * 0.8} />
      <path d={arm(1, 0.6, 0.22)} stroke={color} strokeWidth={w * 0.8} />
      <path d={`M ${x} ${base} L ${x} ${base - h + w / 2}`} stroke={color} strokeWidth={w} />
      <path d={`M ${x + w * 0.2} ${base} L ${x + w * 0.2} ${base - h + w * 0.8}`} stroke={shade} strokeWidth={w * 0.35} />
    </g>
  );
}

/** Night pulls the base toward moonlight first, so the sand turns lavender-blue, not grey. */
const toner = (tod: BgProps["tod"]) => (hex: string) => t(tod)(tod === "night" ? mix(hex, "#6f8cff", 0.35) : hex);

function Back({ tod, frame }: BgProps) {
  const gid = useGid();
  const c = toner(tod);
  const night = tod === "night";
  return (
    <g>
      <OutdoorSky tod={tod} frame={frame} horizon={HORIZON} sunX={1000} />
      {night && (
        <Layer depth={0.08}>
          <defs>
            <filter id={`${gid}-mw`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={55} />
            </filter>
          </defs>
          <ellipse cx={250} cy={380} rx={1300} ry={120} transform="rotate(-40 250 380)" fill="#c9d4ff" opacity={0.16} filter={`url(#${gid}-mw)`} />
          <ellipse cx={250} cy={380} rx={900} ry={52} transform="rotate(-40 250 380)" fill="#e6ebff" opacity={0.14} filter={`url(#${gid}-mw)`} />
          <Stars frame={frame} count={150} maxY={HORIZON - 30} seed="desert-stars" />
        </Layer>
      )}

      <Layer depth={0.2}>
        <Mesa x={-300} w={560} h={150} top={260} color={c(MESA_FAR)} shade={c(mix(MESA_FAR, MESA_SHADE, 0.4))} />
        <Mesa x={1180} w={420} h={120} top={150} color={c(MESA_FAR)} shade={c(mix(MESA_FAR, MESA_SHADE, 0.4))} />
        <Mesa x={300} w={520} h={230} top={210} color={c(MESA)} shade={c(MESA_SHADE)} />
        <Mesa x={1520} w={640} h={270} top={300} color={c(MESA)} shade={c(MESA_SHADE)} />
        <rect x={X0} y={HORIZON + 20} width={X1 - X0} height={200} fill={c(mix(SAND, MESA_FAR, 0.35))} />
      </Layer>

      {tod === "day" && (
        <Layer depth={0.25}>
          {Array.from({ length: 7 }, (_, i) => {
            const y = HORIZON + 8 + i * 9;
            const ph = frame / 9 + i * 1.3;
            const x = X0 + ((i * 337) % 1400) + Math.sin(ph) * 30;
            return <path key={i} d={`M ${x} ${y} q 60 ${-4 * Math.sin(ph)} 120 0 t 120 0 t 120 0`} stroke="#fff6e0" strokeWidth={3} fill="none" opacity={0.22 + 0.1 * Math.sin(ph * 1.7)} />;
          })}
        </Layer>
      )}

      <Layer depth={0.5}>
        <path d={`M ${X0} ${HORIZON + 70} Q 200 ${HORIZON + 10} 640 ${HORIZON + 60} Q 1000 ${HORIZON + 100} 1360 ${HORIZON + 40} Q 1700 ${HORIZON - 5} ${X1} ${HORIZON + 50} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(SAND_DARK)} />
        <path d={`M 640 ${HORIZON + 60} Q 1000 ${HORIZON + 100} 1360 ${HORIZON + 40} Q 1100 ${HORIZON + 110} 760 ${HORIZON + 100} Z`} fill={c(mix(SAND_DARK, TERRA, 0.35))} />
        {[[70, 1, 70], [380, 0.42, 48], [1180, 0.36, 56], [1560, 0.5, 30], [1870, 1, 54]].map(([x, s, b]) => (
          <Saguaro key={x} x={x!} base={HORIZON + b!} h={190 * s!} color={c(mix(CACTUS, SAND_DARK, 0.2))} shade={c(CACTUS_DARK)} />
        ))}
      </Layer>

      <Layer depth={0.75}>
        <path d={`M ${X0} 790 Q 300 730 760 772 Q 1200 812 1560 760 Q 1840 724 ${X1} 770 L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(SAND)} />
        <path d={`M ${X0} 790 Q 300 730 760 772 Q 420 770 ${X0} 830 Z`} fill={c(SAND_LIGHT)} />
        <Saguaro x={-40} base={800} h={360} color={c(CACTUS)} shade={c(CACTUS_DARK)} />
        <Saguaro x={1930} base={790} h={320} color={c(CACTUS)} shade={c(CACTUS_DARK)} />
      </Layer>

      <Layer depth={1}>
        <path d={`M ${X0} ${GROUND - 40} Q 500 ${GROUND - 66} 1000 ${GROUND - 42} Q 1500 ${GROUND - 20} ${X1} ${GROUND - 48} L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(SAND_LIGHT)} />
        <path d={`M ${X0} 1010 Q 700 970 1300 1000 Q 1700 1020 ${X1} 990 L ${X1} ${Y1} L ${X0} ${Y1} Z`} fill={c(SAND)} />
        {Array.from({ length: 12 }, (_, i) => {
          const x = X0 + 100 + random(`rip${i}`) * (X1 - X0 - 200);
          const y = 925 + random(`ripy${i}`) * 140;
          const w = 120 + random(`ripw${i}`) * 140;
          return <path key={i} d={`M ${x} ${y} q ${w / 2} -14 ${w} 0`} stroke={c(SAND_DARK)} strokeWidth={5} fill="none" strokeLinecap="round" opacity={0.6} />;
        })}
        {[[230, 950, 40], [1640, 975, 30], [1080, 1050, 24]].map(([x, y, r]) => (
          <g key={x}>
            <ellipse cx={x} cy={y} rx={r!} ry={r! * 0.55} fill={c(TERRA)} />
            <ellipse cx={x! + r! * 0.25} cy={y! + r! * 0.15} rx={r! * 0.6} ry={r! * 0.35} fill={c(mix(TERRA, "#000", 0.2))} />
          </g>
        ))}
      </Layer>
    </g>
  );
}

function Front({ tod }: BgProps) {
  const c = toner(tod);
  return (
    <Layer depth={1.15}>
      <Saguaro x={-50} base={1190} h={400} color={c(CACTUS_DARK)} shade={c(mix(CACTUS_DARK, "#000", 0.2))} />
      <ellipse cx={2040} cy={1130} rx={170} ry={80} fill={c(mix(TERRA, "#000", 0.15))} />
    </Layer>
  );
}

export const desert = { groundY: GROUND, horizonY: HORIZON, wallY: 380, Back, Front };
