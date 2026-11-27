import { ACCENT } from "../../theme";
import { Layer } from "../camera";
import { Glow, Moon, SkyGradient, Stars, X0, X1, Y0, Y1, lit, t, useGid, type BgProps } from "./common";

/** Home kitchen: mint walls, butter-yellow tiles, sage cabinets, fridge, stove, window over the sink. */
const GROUND = 885;
const MINT = "#bfe2d2";
const TILE = "#f3d77f";
const SAGE = "#7fb79f";
const SAGE_DARK = "#5f9a82";
const TOP = "#eef1ea";
const STEEL = "#c4ccd0";

function SinkWindow({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const clip = useGid();
  const [x, y, w, h] = [790, 200, 340, 300];
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={y} width={w} height={h} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <SkyGradient tod={tod} top={y} bottom={y + h} />
        {tod === "night" && <Stars frame={frame} count={14} maxY={y + h} seed="kit" />}
        {tod === "night" && <Moon x={x + 90} y={y + 80} r={28} />}
        <path d={`M ${x} ${y + h - 60} Q ${x + 170} ${y + h - 110} ${x + w} ${y + h - 70} L ${x + w} ${y + h} L ${x} ${y + h} Z`} fill={c("#79ab7c")} />
        <circle cx={x + 250} cy={y + h - 110} r={44} fill={c("#5e9468")} />
        <rect x={x + 244} y={y + h - 80} width={12} height={40} fill={c("#7d5b45")} />
      </g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={c("#f6f6ef")} strokeWidth={18} />
      <rect x={x + w / 2 - 6} y={y} width={12} height={h} fill={c("#f6f6ef")} />
      <path d={`M ${x - 20} ${y - 10} L ${x + w + 20} ${y - 10} L ${x + w + 20} ${y + 50} Q ${x + w / 2} ${y + 90} ${x - 20} ${y + 50} Z`} fill={c("#e98f7c")} />
      <path d={`M ${x - 20} ${y + 50} Q ${x + w / 2} ${y + 90} ${x + w + 20} ${y + 50}`} fill="none" stroke={c("#f6f6ef")} strokeWidth={6} strokeDasharray="2 16" strokeLinecap="round" />
      <rect x={x - 26} y={y + h + 4} width={w + 52} height={16} rx={4} fill={c("#f6f6ef")} />
      <circle cx={x + 60} cy={y + h - 8} r={18} fill={c("#6fae6a")} />
      <rect x={x + 46} y={y + h - 6} width={28} height={14} rx={3} fill={c("#d0704e")} />
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const on = lit(tod);
  const steam = (k: number) => ((frame * 0.9 + k * 40) % 120) / 120;
  return (
    <g>
      <Layer depth={0.8}>
        <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill={c(MINT)} />
        <rect x={X0} y={330} width={X1 - X0} height={300} fill={c(TILE)} />
        {Array.from({ length: 6 }, (_, r) => (
          <rect key={r} x={X0} y={330 + r * 50} width={X1 - X0} height={3} fill={c("#e2c066")} />
        ))}
        {Array.from({ length: 42 }, (_, i) => (
          <rect key={i} x={X0 + i * 60} y={330} width={3} height={300} fill={c("#e2c066")} />
        ))}
        <SinkWindow tod={tod} frame={frame} />
        {([[X0, 560], [300, 450], [1150, 140], [1560, X1 - 1560]] as const).map(([x, w], i) => {
          const n = Math.max(1, Math.round(w / 190));
          const dw = (w - 14) / n - 14;
          return (
            <g key={i}>
              <rect x={x} y={110} width={w} height={190} rx={6} fill={c(SAGE)} />
              {Array.from({ length: n }, (_, k) => (
                <g key={k}>
                  <rect x={x + 14 + k * (dw + 14)} y={124} width={dw} height={162} rx={6} fill={c(SAGE_DARK)} opacity={0.35} />
                  <rect x={x + k * (dw + 14) + dw - 12} y={250} width={10} height={26} rx={5} fill={c(STEEL)} />
                </g>
              ))}
            </g>
          );
        })}
        <rect x={400} y={318} width={320} height={10} rx={5} fill={c("#8b8f93")} />
        {[460, 560, 660].map((x, i) => (
          <g key={x} transform={`translate(${x} 324) rotate(${[4, -3, 2][i]})`}>
            <rect x={-4} y={0} width={8} height={40} rx={4} fill={c("#6a7177")} />
            <circle cx={0} cy={[70, 76, 66][i]} r={[32, 38, 28][i]} fill={c(["#d9643f", "#7d8a94", "#e0a23c"][i]!)} />
          </g>
        ))}
        <g transform="translate(-40 0)">
          <rect x={0} y={250} width={300} height={GROUND - 250} rx={22} fill={c("#eaf0ee")} />
          <rect x={0} y={460} width={300} height={8} fill={c("#cdd7d4")} />
          <rect x={250} y={300} width={14} height={120} rx={7} fill={c(STEEL)} />
          <rect x={250} y={500} width={14} height={150} rx={7} fill={c(STEEL)} />
          <circle cx={90} cy={330} r={16} fill={c("#e46b5d")} />
          <rect x={150} y={320} width={50} height={64} rx={4} fill={c("#ffffff")} transform="rotate(6 175 352)" />
        </g>
        <rect x={260} y={612} width={X1 - 260} height={30} rx={4} fill={c(TOP)} />
        <rect x={260} y={642} width={X1 - 260} height={GROUND - 642} fill={c(SAGE)} />
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={280 + i * 200} y={660} width={180} height={GROUND - 690} rx={6} fill={c(SAGE_DARK)} opacity={0.3} />
        ))}
        <rect x={860} y={604} width={200} height={14} rx={6} fill={c(STEEL)} />
        <path d="M 948 604 L 948 560 Q 948 540 972 540 L 984 540" fill="none" stroke={c(STEEL)} strokeWidth={10} strokeLinecap="round" />
        <g transform="translate(1290 0)">
          {on && <Glow x={130} y={250} r={200} opacity={0.35} />}
          <path d="M 0 250 L 260 250 L 220 150 L 40 150 Z" fill={c(STEEL)} />
          <rect x={90} y={Y0} width={80} height={150 - Y0} fill={c("#b2bbc0")} />
          <rect x={20} y={246} width={220} height={8} rx={4} fill={on ? ACCENT : c("#dfe5e8")} />
          <rect x={0} y={612} width={260} height={GROUND - 612} fill={c("#e9edef")} />
          <rect x={0} y={606} width={260} height={16} rx={4} fill={c("#3b4248")} />
          <rect x={24} y={680} width={212} height={150} rx={10} fill={c("#3b4248")} />
          <rect x={44} y={700} width={172} height={84} rx={6} fill={c("#59636b")} />
          {[50, 100, 160, 210].map((kx) => <circle key={kx} cx={kx} cy={650} r={10} fill={c("#3b4248")} />)}
          <rect x={60} y={556} width={110} height={50} rx={8} fill={c("#d9643f")} />
          <rect x={46} y={566} width={138} height={10} rx={5} fill={c("#b84f30")} />
          {[0, 1, 2].map((k) => (
            <circle key={k} cx={100 + k * 20 + Math.sin((frame + k * 30) / 12) * 8} cy={540 - steam(k) * 120} r={10 + steam(k) * 14} fill="#ffffff" opacity={0.45 * (1 - steam(k))} />
          ))}
        </g>
        <g transform="translate(560 0)">
          {on && <Glow x={0} y={150} r={360} opacity={0.4} />}
          <rect x={-2} y={Y0} width={4} height={100 - Y0} fill={c("#555b60")} />
          <path d="M -60 150 Q -60 96 0 96 Q 60 96 60 150 Z" fill={c("#e46b5d")} />
          <ellipse cx={0} cy={152} rx={34} ry={8} fill={on ? ACCENT : c("#fff4d6")} />
        </g>
      </Layer>
      <Layer depth={1}>
        <rect x={X0} y={GROUND - 36} width={X1 - X0} height={Y1 - GROUND + 36} fill={c("#d29a72")} />
        <rect x={X0} y={GROUND - 40} width={X1 - X0} height={10} fill={c("#4c7f6a")} />
        {[930, 1000, 1090].map((y) => <rect key={y} x={X0} y={y} width={X1 - X0} height={4} fill={c("#b98260")} />)}
        {Array.from({ length: 14 }, (_, i) => (
          <path key={i} d={`M ${X0 + i * 200} ${GROUND - 30} L ${X0 + i * 200 - (960 - X0 - i * 200) * 0.3} ${Y1}`} stroke={c("#b98260")} strokeWidth={4} />
        ))}
      </Layer>
    </g>
  );
}

export const kitchen = { groundY: GROUND, horizonY: 400, wallY: 390, Back };
