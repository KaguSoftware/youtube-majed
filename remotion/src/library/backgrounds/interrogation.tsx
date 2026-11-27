import { Layer } from "../camera";
import { Glow, X0, X1, Y0, Y1, lit, t, useGid, type BgProps } from "./common";

/** Interrogation room: sickly olive walls, one-way mirror, height chart, one hard swinging lamp. */
const GROUND = 885;
const BULB = "#fff1b8";

function Lamp({ frame, on }: { frame: number; on: boolean }) {
  const cone = useGid();
  const swing = 1.4 * Math.sin(frame * 0.05);
  const k = on ? 1 : 0.6;
  return (
    <g transform={`rotate(${swing} 960 ${Y0})`}>
      <defs>
        <linearGradient id={cone} x1="0" y1="330" x2="0" y2={GROUND} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={BULB} stopOpacity={0.42 * k} />
          <stop offset="1" stopColor={BULB} stopOpacity={0.14 * k} />
        </linearGradient>
      </defs>
      <path d={`M 900 320 L 1020 320 L 1560 ${GROUND + 20} L 360 ${GROUND + 20} Z`} fill={`url(#${cone})`} />
      <ellipse cx={960} cy={GROUND + 10} rx={620} ry={70} fill={BULB} opacity={0.2 * k} />
      <path d={`M 960 ${Y0} L 960 262`} stroke="#2a2d24" strokeWidth={6} />
      <rect x={946} y={250} width={28} height={22} rx={4} fill="#2a2d24" />
      <path d="M 940 268 L 980 268 L 1040 326 L 880 326 Z" fill="#3a4032" />
      <ellipse cx={960} cy={326} rx={34} ry={14} fill={BULB} />
      <Glow x={960} y={330} r={on ? 240 : 140} opacity={on ? 0.6 : 0.4} color={BULB} />
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const on = lit(tod);
  const dark = useGid();
  const rec = Math.floor(frame / 15) % 2 === 0;
  return (
    <g>
      <Layer depth={0.85}>
        <defs>
          <radialGradient id={dark} cx={960} cy={560} r={1250} gradientUnits="userSpaceOnUse">
            <stop offset="0.35" stopColor="#14160f" stopOpacity={0} />
            <stop offset="1" stopColor="#14160f" stopOpacity={0.6} />
          </radialGradient>
        </defs>
        <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill={c("#a2a987")} />
        {[[300, 120, 160], [1300, 560, 120], [1200, 200, 90]].map(([x, y, r]) => (
          <ellipse key={x} cx={x} cy={y} rx={r} ry={r! * 0.7} fill={c("#8f9674")} opacity={0.35} />
        ))}
        <rect x={X0} y={640} width={X1 - X0} height={GROUND - 640} fill={c("#7b8463")} />
        <rect x={X0} y={630} width={X1 - X0} height={14} fill={c("#5f674d")} />
        <path d={`M 1140 ${Y0} L 1140 640`} stroke={c("#8a9070")} strokeWidth={14} />
        <rect x={1122} y={420} width={36} height={56} rx={4} fill={c("#8a9070")} />

        <rect x={150} y={170} width={750} height={320} rx={6} fill={c("#878b80")} />
        <rect x={172} y={192} width={706} height={276} fill={c("#3a4643")} />
        <path d="M 260 192 L 420 192 L 250 468 L 172 468 L 172 340 Z" fill={c("#56645f")} opacity={0.6} />
        <path d="M 470 192 L 520 192 L 350 468 L 300 468 Z" fill={c("#56645f")} opacity={0.45} />
        <path d="M 700 192 L 760 192 L 600 468 L 560 468 Z" fill={c("#56645f")} opacity={0.3} />
        <rect x={140} y={490} width={770} height={16} rx={4} fill={c("#6f7368")} />

        <g transform="translate(1540 0)">
          <rect x={0} y={200} width={260} height={GROUND - 200} fill={c("#bfc2a6")} />
          {Array.from({ length: 20 }, (_, i) => {
            const y = GROUND - i * 34;
            const major = i % 2 === 0 && i > 0;
            return (
              <g key={i}>
                <path d={`M 0 ${y} L ${major ? 260 : 70} ${y}`} stroke={c("#5a6150")} strokeWidth={major ? 5 : 3} opacity={major ? 0.75 : 0.55} />
                {major && (
                  <text x={88} y={y - 10} fontFamily="Fredoka, sans-serif" fontWeight={700} fontSize={30} fill={c("#5a6150")} opacity={0.8}>
                    {`${i / 2}'`}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        <g transform="translate(1790 120)">
          <rect x={-20} y={-60} width={14} height={70} fill={c("#3a4032")} />
          <path d="M -60 0 L 30 -14 L 40 30 L -50 44 Z" fill={c("#d8dacb")} />
          <path d="M -60 0 L -86 6 L -80 40 L -50 44 Z" fill={c("#3a4032")} />
          <circle cx={20} cy={8} r={7} fill={rec ? "#ff4a3d" : c("#5a2a24")} />
        </g>
        {on && <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill="#7d8a3c" opacity={tod === "night" ? 0.2 : 0.1} />}
        <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill={`url(#${dark})`} />
      </Layer>
      <Layer depth={1}>
        <rect x={X0} y={GROUND - 30} width={X1 - X0} height={Y1 - GROUND + 30} fill={c("#6e7064")} />
        <rect x={X0} y={GROUND - 36} width={X1 - X0} height={12} fill={c("#4f5245")} />
        <path d={`M 300 960 L 420 990 L 470 1060 M 1500 1000 L 1620 980`} stroke={c("#5c5e52")} strokeWidth={5} fill="none" />
        <ellipse cx={960} cy={1010} rx={46} ry={14} fill={c("#4f5245")} />
        <rect x={X0} y={GROUND} width={X1 - X0} height={Y1 - GROUND} fill="#14160f" opacity={0.15} />
        {on && <rect x={X0} y={GROUND - 36} width={X1 - X0} height={Y1 - GROUND + 36} fill="#7d8a3c" opacity={tod === "night" ? 0.14 : 0.07} />}
      </Layer>
      <Layer depth={0.92}>
        <Lamp frame={frame} on={on} />
      </Layer>
    </g>
  );
}

export const interrogation = { groundY: GROUND, horizonY: 400, wallY: 360, Back };
