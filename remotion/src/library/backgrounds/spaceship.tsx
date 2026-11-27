import { random } from "remotion";
import { Layer } from "../camera";
import { Glow, X0, X1, Y0, Y1, lit, t, useGid, type BgProps } from "./common";

/** Spaceship bridge: curved steel walls, a wide viewport onto space (always space), glowing consoles. */
const GROUND = 885;
const CYAN = "#5ef0ff";
const ORANGE = "#ffa94d";
const VIEW = "M 420 90 L 1500 90 L 1590 440 L 330 440 Z";

type Tone = (hex: string) => string;

function Space({ frame }: { frame: number }) {
  const clip = useGid();
  const grad = useGid();
  const px = 1260 - frame * 0.06;
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <path d={VIEW} />
        </clipPath>
        <linearGradient id={grad} x1="0" y1="90" x2="0" y2="440" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#060a20" />
          <stop offset="1" stopColor="#1c2150" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x={300} y={80} width={1320} height={380} fill={`url(#${grad})`} />
        <Glow x={620} y={240} r={260} opacity={0.35} color="#9b6bff" />
        <Glow x={820} y={360} r={200} opacity={0.25} color={CYAN} />
        {Array.from({ length: 60 }, (_, i) => {
          const tw = 0.5 + 0.5 * Math.sin(frame / (6 + random(`ss-t${i}`) * 10) + i);
          return <circle key={i} cx={330 + random(`ss-x${i}`) * 1260} cy={95 + random(`ss-y${i}`) * 340} r={1 + random(`ss-r${i}`) * 2.2} fill="#fff8e1" opacity={0.4 + 0.6 * tw} />;
        })}
        <Glow x={px} y={330} r={260} opacity={0.4} color="#ffb27a" />
        <ellipse cx={px} cy={330} rx={250} ry={46} fill="none" stroke="#ffd9a8" strokeWidth={10} opacity={0.55} transform={`rotate(-12 ${px} 330)`} />
        <circle cx={px} cy={330} r={150} fill="#e9814a" />
        <path d={`M ${px - 150} 300 Q ${px} 280 ${px + 150} 310 L ${px + 150} 335 Q ${px} 305 ${px - 150} 326 Z`} fill="#c8603a" />
        <path d={`M ${px - 145} 370 Q ${px} 350 ${px + 145} 380 L ${px + 140} 398 Q ${px} 372 ${px - 140} 390 Z`} fill="#f4a467" />
        <circle cx={px + 40} cy={350} r={150} fill="#1c2150" opacity={0.35} />
        <path d={`M ${px - 250} 330 A 250 46 0 0 0 ${px + 250} 330`} fill="none" stroke="#ffd9a8" strokeWidth={10} opacity={0.8} transform={`rotate(-12 ${px} 330)`} />
        <circle cx={520} cy={170} r={22} fill="#b9c6e0" />
        <circle cx={528} cy={166} r={20} fill="#1c2150" opacity={0.5} />
      </g>
    </g>
  );
}

function Console({ x, w, top, frame, seed, c }: { x: number; w: number; top: number; frame: number; seed: number; c: Tone }) {
  return (
    <g>
      <Glow x={x + w / 2} y={top} r={w * 0.7} opacity={0.22} color={CYAN} />
      <path d={`M ${x} ${top + 40} L ${x + 30} ${top} L ${x + w - 30} ${top} L ${x + w} ${top + 40} L ${x + w - 20} ${GROUND} L ${x + 20} ${GROUND} Z`} fill={c("#34415a")} />
      <path d={`M ${x} ${top + 40} L ${x + w} ${top + 40} L ${x + w - 4} ${top + 58} L ${x + 4} ${top + 58} Z`} fill={c("#56688a")} />
      <path d={`M ${x + 44} ${top + 8} L ${x + w * 0.55} ${top + 8} L ${x + w * 0.55 + 6} ${top + 32} L ${x + 38} ${top + 32} Z`} fill={CYAN} opacity={0.9} />
      {Array.from({ length: 5 }, (_, i) => {
        const on = Math.sin(frame * 0.3 + i * 1.9 + seed) > 0;
        return <circle key={i} cx={x + w * 0.62 + i * 22} cy={top + 20} r={7} fill={on ? (i % 2 ? ORANGE : CYAN) : c("#22293a")} />;
      })}
      <rect x={x + 50} y={top + 100} width={w - 100} height={8} rx={4} fill={c("#56688a")} />
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const on = lit(tod);
  const pulse = 0.7 + 0.3 * Math.sin(frame * 0.12);
  return (
    <g>
      <Layer depth={0.85}>
        <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill={c("#7489a8")} />
        <path d={`M ${X0} ${Y0} L ${X1} ${Y0} L ${X1} 130 Q 960 -10 ${X0} 130 Z`} fill={c("#4f6080")} />
        {[-1, 1].map((sd) => {
          const e = sd < 0 ? X0 : X1;
          const rx = sd < 0 ? 250 : 1670;
          const bx = sd < 0 ? 140 : 1780;
          return (
            <g key={sd}>
              <path d={`M ${e} ${Y0} L ${rx} ${Y0} Q ${bx} 450 ${rx} ${GROUND} L ${e} ${GROUND} Z`} fill={c("#61759a")} />
              <path d={`M ${rx} ${Y0} Q ${bx} 450 ${rx} ${GROUND}`} stroke={c("#46557a")} strokeWidth={30} fill="none" />
              {[210, 360, 520].map((y) => (
                <path key={y} d={`M ${e} ${y} L ${sd < 0 ? 175 : 1745} ${y}`} stroke={c("#53658a")} strokeWidth={5} />
              ))}
              <rect x={sd < 0 ? 40 : 1820} y={260} width={60} height={70} rx={8} fill={c("#3e4b67")} />
              <circle cx={sd < 0 ? 70 : 1850} cy={295} r={10} fill={Math.sin(frame * 0.2 + sd) > 0 ? ORANGE : c("#2a3247")} />
            </g>
          );
        })}
        <Space frame={frame} />
        <path d={VIEW} fill="none" stroke={c("#3b4862")} strokeWidth={32} strokeLinejoin="round" />
        <path d="M 790 90 L 760 440 M 1130 90 L 1160 440" stroke={c("#3b4862")} strokeWidth={16} />
        <rect x={300} y={452} width={1320} height={10} rx={5} fill={CYAN} opacity={0.85 * pulse} />
        <rect x={300} y={600} width={1320} height={6} fill={c("#687c9d")} />
        {[400, 700, 1000, 1300].map((x) => (
          <rect key={x} x={x} y={630} width={220} height={150} rx={10} fill={c("#6b80a0")} />
        ))}
        <Console x={X0} w={560} top={650} frame={frame} seed={0} c={c} />
        <Console x={1620} w={560} top={650} frame={frame} seed={2} c={c} />
        <Console x={800} w={320} top={730} frame={frame} seed={4} c={c} />
        {on && <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill="#6fd8ff" opacity={0.08} />}
      </Layer>
      <Layer depth={1}>
        <rect x={X0} y={GROUND - 30} width={X1 - X0} height={Y1 - GROUND + 30} fill={c("#46546d")} />
        {Array.from({ length: 14 }, (_, i) => (
          <path key={i} d={`M ${X0 + i * 200} ${GROUND - 24} L ${X0 - 400 + i * 260} ${Y1}`} stroke={c("#3a465c")} strokeWidth={6} />
        ))}
        {[945, 1030].map((y) => (
          <path key={y} d={`M ${X0} ${y} L ${X1} ${y}`} stroke={c("#3a465c")} strokeWidth={6} />
        ))}
        <rect x={X0} y={GROUND - 34} width={X1 - X0} height={8} fill={CYAN} opacity={0.75 * pulse} />
        <Glow x={960} y={GROUND} r={900} opacity={0.12} color={CYAN} />
      </Layer>
    </g>
  );
}

export const spaceship = { groundY: GROUND, horizonY: 300, wallY: 540, Back };
