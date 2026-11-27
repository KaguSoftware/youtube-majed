import { Layer } from "../camera";
import { Glow, Moon, SkyGradient, Stars, X0, X1, Y0, Y1, lit, t, useGid, type BgProps } from "./common";

/** Hospital room: pale mint walls, privacy curtain on a ceiling rail, window, headwall sockets, heart monitor. */
const GROUND = 885;
const MINT = "#d5ece3";
const MINT_LOW = "#b7d9cc";
const WHITE = "#f4f8f6";
const CURTAIN = "#9fc9dc";
const CURTAIN_DARK = "#86b6cc";

function Window({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const clip = useGid();
  const [x, y, w, h] = [700, 180, 420, 270];
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={y} width={w} height={h} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <SkyGradient tod={tod} top={y} bottom={y + h} />
        {tod === "night" && <Stars frame={frame} count={14} maxY={y + h} seed="hosp" />}
        {tod === "night" && <Moon x={x + 320} y={y + 70} r={28} />}
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={x + 10 + i * 110} y={y + h - 70 - (i % 2) * 50} width={90} height={140} fill={c("#a4b4c2")} />
        ))}
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={x + 30 + i * 110} y={y + h - 50 - (i % 2) * 50} width={22} height={14} fill={lit(tod) ? "#ffd98a" : c("#dfe8ee")} opacity={0.85} />
        ))}
      </g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={c(WHITE)} strokeWidth={16} />
      <rect x={x + w / 2 - 5} y={y} width={10} height={h} fill={c(WHITE)} />
      <rect x={x - 20} y={y + h + 4} width={w + 40} height={14} rx={4} fill={c(WHITE)} />
      <rect x={x - 10} y={y - 30} width={w + 20} height={34} rx={4} fill={c("#e4ece9")} />
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const on = lit(tod);
  const scr = { x: 1560, y: 230, w: 260, h: 170 };
  const beat = (frame % 30) / 30;
  const KEYS = [[0, 0], [0.36, 0], [0.4, -8], [0.43, 0], [0.46, 8], [0.49, -64], [0.52, 26], [0.55, 0], [0.66, -12], [0.74, 0], [1, 0]] as const;
  const ecg = (p: number) => {
    const k = KEYS.findIndex(([x]) => x >= p);
    const [x0, y0] = KEYS[Math.max(0, k - 1)]!;
    const [x1, y1] = KEYS[Math.max(0, k)]!;
    return x1 === x0 ? y1 : y0 + ((y1 - y0) * (p - x0)) / (x1 - x0);
  };
  const trace = Array.from({ length: 121 }, (_, i) => {
    const u = i / 120;
    const ph = (((u * 2 - beat) % 1) + 1) % 1;
    return `${i ? "L" : "M"} ${(scr.x + 16 + u * (scr.w - 32)).toFixed(1)} ${(scr.y + 100 + ecg(ph) * 0.9).toFixed(1)}`;
  }).join(" ");
  return (
    <g>
      <Layer depth={0.8}>
        <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill={c(MINT)} />
        <rect x={X0} y={Y0} width={X1 - X0} height={64 - Y0} fill={c(WHITE)} />
        {[400, 1300].map((x) => (
          <g key={x}>
            {on && <Glow x={x} y={120} r={560} opacity={0.3} color="#a6f2df" />}
            <rect x={x - 140} y={34} width={280} height={34} rx={6} fill={c("#c3d3cf")} />
            <rect x={x - 128} y={42} width={256} height={18} rx={4} fill={on ? "#f4fdff" : c("#ffffff")} />
          </g>
        ))}
        <rect x={X0} y={600} width={X1 - X0} height={GROUND - 600} fill={c(MINT_LOW)} />
        <rect x={X0} y={590} width={X1 - X0} height={22} rx={6} fill={c(WHITE)} />
        <rect x={X0} y={606} width={X1 - X0} height={6} fill={c("#8fc4b4")} />
        <Window tod={tod} frame={frame} />
        <g transform="translate(1290 420)">
          <rect x={0} y={0} width={420} height={70} rx={10} fill={c("#e6efec")} />
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${36 + i * 56} 20)`}>
              <rect x={0} y={0} width={40} height={30} rx={5} fill={c(WHITE)} />
              <circle cx={14} cy={15} r={3} fill={c("#7a8a86")} />
              <circle cx={26} cy={15} r={3} fill={c("#7a8a86")} />
            </g>
          ))}
          <circle cx={250} cy={35} r={16} fill={c("#5fae7a")} />
          <circle cx={300} cy={35} r={16} fill={c("#e9eef0")} />
          <circle cx={350} cy={35} r={16} fill={c("#6d9ccc")} />
        </g>
        <g>
          <rect x={scr.x + scr.w / 2 - 10} y={scr.y + scr.h} width={20} height={70} fill={c("#9aa7a4")} />
          <rect x={scr.x - 14} y={scr.y - 14} width={scr.w + 28} height={scr.h + 28} rx={14} fill={c("#c9d3d1")} />
          {on && <Glow x={scr.x + scr.w / 2} y={scr.y + scr.h / 2} r={240} opacity={0.3} color="#7df5b8" />}
          <rect x={scr.x} y={scr.y} width={scr.w} height={scr.h} rx={6} fill="#173a33" />
          <path d={trace} fill="none" stroke="#69f5a8" strokeWidth={4} strokeLinejoin="round" />
          <rect x={scr.x + 20} y={scr.y + 132} width={60} height={18} rx={3} fill="#69f5a8" opacity={0.75} />
          <rect x={scr.x + 180} y={scr.y + 132} width={60} height={18} rx={3} fill="#7fd6f5" opacity={0.75} />
          <circle cx={scr.x + scr.w - 20} cy={scr.y + 20} r={6} fill="#ff6b6b" opacity={beat < 0.2 ? 1 : 0.3} />
        </g>
        <rect x={X0} y={92} width={760} height={10} rx={5} fill={c("#b5c1be")} />
        {Array.from({ length: 12 }, (_, i) => <circle key={i} cx={X0 + 30 + i * 22} cy={100} r={7} fill={c("#9eaaa7")} />)}
        <path d={`M ${X0} 104 L 240 104 Q 210 300 250 500 Q 220 700 260 ${GROUND} L ${X0} ${GROUND} Z`} fill={c(CURTAIN)} />
        {[-150, -70, 10, 90, 170].map((x) => (
          <path key={x} d={`M ${x} 110 Q ${x - 14} 480 ${x + 10} ${GROUND - 20}`} stroke={c(CURTAIN_DARK)} strokeWidth={14} fill="none" strokeLinecap="round" />
        ))}
        <g transform={`translate(1880 ${GROUND})`}>
          <rect x={-5} y={-640} width={10} height={630} fill={c("#a9b5b2")} />
          <path d="M -60 -640 L 60 -640" stroke={c("#a9b5b2")} strokeWidth={8} strokeLinecap="round" />
          <rect x={-58} y={-630} width={50} height={80} rx={14} fill={c("#cfe6ee")} opacity={0.9} />
          <path d="M -33 -550 Q -40 -400 -10 -300" stroke={c("#cfe6ee")} strokeWidth={4} fill="none" />
          <path d="M -50 0 L 0 -14 L 50 0" stroke={c("#a9b5b2")} strokeWidth={8} fill="none" strokeLinecap="round" />
        </g>
      </Layer>
      <Layer depth={1}>
        <rect x={X0} y={GROUND - 36} width={X1 - X0} height={Y1 - GROUND + 36} fill={c("#b9c7c8")} />
        <rect x={X0} y={GROUND - 40} width={X1 - X0} height={10} fill={c("#8fa3a3")} />
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={X0 + i * 240} y={GROUND - 30} width={3} height={Y1 - GROUND + 30} fill={c("#a8b7b8")} />
        ))}
        {[970, 1080].map((y) => <rect key={y} x={X0} y={y} width={X1 - X0} height={3} fill={c("#a8b7b8")} />)}
        <ellipse cx={1100} cy={960} rx={500} ry={30} fill="#ffffff" opacity={0.12} />
      </Layer>
    </g>
  );
}

export const hospital = { groundY: GROUND, horizonY: 400, wallY: 360, Back };
