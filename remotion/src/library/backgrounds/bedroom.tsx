import { ACCENT } from "../../theme";
import { Layer } from "../camera";
import { Glow, Moon, SkyGradient, Stars, X0, X1, Y0, Y1, lit, t, useGid, type BgProps } from "./common";

/** Bedroom: dusty-blue walls, pink curtains and rug, wardrobe, poster, fairy lights. Floor left clear for a bed prop. */
const GROUND = 885;
const BLUE = "#9db3cb";
const BLUE_DOT = "#91a8c1";
const PINK = "#e2a2ad";
const PINK_DARK = "#c98390";
const CREAM = "#f1e6dc";

function CurtainWindow({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const clip = useGid();
  const [x, y, w, h] = [1180, 190, 300, 290];
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={y} width={w} height={h} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <SkyGradient tod={tod} top={y} bottom={y + h} />
        {tod === "night" && <Stars frame={frame} count={16} maxY={y + h} seed="bed" />}
        {tod === "night" && <Moon x={x + 200} y={y + 80} r={30} />}
        {[0, 1, 2, 3].map((i) => (
          <path key={i} d={`M ${x + i * 90 - 30} ${y + h} L ${x + i * 90 + 30} ${y + h - 100 - (i % 2) * 40} L ${x + i * 90 + 90} ${y + h} Z`} fill={c("#7d93b5")} />
        ))}
      </g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={c(CREAM)} strokeWidth={16} />
      <path d={`M ${x + w / 2} ${y} L ${x + w / 2} ${y + h} M ${x} ${y + h / 2} L ${x + w} ${y + h / 2}`} stroke={c(CREAM)} strokeWidth={8} />
      <rect x={x - 24} y={y + h + 4} width={w + 48} height={16} rx={4} fill={c(CREAM)} />
      <rect x={x - 90} y={y - 40} width={w + 180} height={12} rx={6} fill={c("#8a7a8c")} />
      {[-1, 1].map((s) => {
        const ex = s < 0 ? x - 80 : x + w + 80;
        const ix = s < 0 ? x + 16 : x + w - 16;
        return (
          <g key={s}>
            <path d={`M ${ex} ${y - 32} L ${ix} ${y - 32} Q ${ix - s * 12} ${y + 120} ${ex + s * 4} ${y + 220} Q ${ex - s * 6} ${y + 360} ${ex + s * 10} ${y + h + 60} L ${ex - s * 40} ${y + h + 60} Q ${ex - s * 30} ${y + 200} ${ex} ${y - 32} Z`} fill={c(PINK)} />
            <path d={`M ${ex - s * 10} ${y + 216} L ${ex + s * 40} ${y + 226}`} stroke={c(PINK_DARK)} strokeWidth={10} strokeLinecap="round" />
          </g>
        );
      })}
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const on = lit(tod);
  return (
    <g>
      <Layer depth={0.8}>
        <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill={c(BLUE)} />
        {Array.from({ length: 30 }, (_, i) =>
          Array.from({ length: 6 }, (_, r) => (
            <circle key={`${i}-${r}`} cx={X0 + i * 90 + (r % 2) * 45} cy={150 + r * 70} r={6} fill={c(BLUE_DOT)} />
          )),
        )}
        <rect x={X0} y={Y0} width={X1 - X0} height={80 - Y0} fill={c("#b4c5d8")} />
        <rect x={X0} y={76} width={X1 - X0} height={10} fill={c(CREAM)} />
        {Array.from({ length: 9 }, (_, k) => {
          const x = X0 + k * 300;
          return (
            <g key={k}>
              <path d={`M ${x} 100 Q ${x + 150} 160 ${x + 300} 100`} fill="none" stroke={c("#6f6a7e")} strokeWidth={3} />
              {[0.2, 0.4, 0.6, 0.8].map((u, j) => {
                const i = k * 4 + j;
                const col = ["#ffd98a", "#ffb3c1", "#a8e6ff"][i % 3]!;
                const tw = 0.7 + 0.3 * Math.sin(frame / 10 + i * 1.7);
                return <circle key={j} cx={x + 300 * u} cy={108 + 120 * u * (1 - u)} r={7} fill={on ? col : c(col)} opacity={on ? tw : 0.9} />;
              })}
            </g>
          );
        })}
        <rect x={X0} y={600} width={X1 - X0} height={GROUND - 600} fill={c("#879fbb")} />
        <rect x={X0} y={594} width={X1 - X0} height={12} fill={c(CREAM)} />
        <CurtainWindow tod={tod} frame={frame} />
        <g transform="translate(560 200)">
          <rect x={0} y={0} width={190} height={250} rx={4} fill={c("#3e4a6e")} />
          <circle cx={95} cy={92} r={52} fill={c("#f2b36b")} />
          <path d="M 0 250 L 0 190 L 60 140 L 110 190 L 150 160 L 190 196 L 190 250 Z" fill={c("#e27d8f")} />
          <rect x={24} y={206} width={142} height={12} rx={6} fill={c(CREAM)} />
          <rect x={44} y={226} width={100} height={8} rx={4} fill={c(CREAM)} opacity={0.7} />
          <circle cx={95} cy={8} r={6} fill={c("#d0473d")} />
        </g>
        <g transform="translate(-60 250)">
          <rect x={0} y={0} width={340} height={GROUND - 250} rx={8} fill={c("#d9b8b4")} />
          <rect x={-10} y={-18} width={360} height={24} rx={6} fill={c("#c49c99")} />
          <rect x={22} y={24} width={140} height={GROUND - 300} rx={6} fill={c("#e6c9c4")} />
          <rect x={178} y={24} width={140} height={GROUND - 300} rx={6} fill={c("#e6c9c4")} />
          <circle cx={150} cy={330} r={8} fill={c("#8a6a66")} />
          <circle cx={190} cy={330} r={8} fill={c("#8a6a66")} />
          <rect x={60} y={-74} width={90} height={56} rx={6} fill={c("#b6c9a7")} />
          <rect x={170} y={-60} width={70} height={42} rx={6} fill={c(PINK)} />
        </g>
        <g transform={`translate(1760 ${GROUND})`}>
          {on && <Glow x={0} y={-260} r={300} opacity={0.45} />}
          <rect x={-80} y={-170} width={160} height={170} rx={8} fill={c("#cfa9a6")} />
          <rect x={-80} y={-176} width={160} height={16} rx={6} fill={c("#b98d8a")} />
          <rect x={-64} y={-140} width={128} height={60} rx={5} fill={c("#dcbab6")} />
          <circle cx={0} cy={-110} r={6} fill={c("#8a6a66")} />
          <path d="M -24 -176 L 24 -176 L 14 -200 L -14 -200 Z" fill={c("#7d8fb0")} />
          <rect x={-4} y={-240} width={8} height={44} fill={c("#6f6a7e")} />
          <path d="M -46 -236 L 46 -236 L 30 -296 L -30 -296 Z" fill={on ? ACCENT : c("#f7e3b8")} />
        </g>
      </Layer>
      <Layer depth={1}>
        <rect x={X0} y={GROUND - 36} width={X1 - X0} height={Y1 - GROUND + 36} fill={c("#c9ad94")} />
        <rect x={X0} y={GROUND - 40} width={X1 - X0} height={10} fill={c(CREAM)} />
        {[925, 975, 1035, 1110].map((y, r) => (
          <g key={y}>
            <rect x={X0} y={y} width={X1 - X0} height={3} fill={c("#b0937a")} />
            {Array.from({ length: 8 }, (_, k) => (
              <rect key={k} x={X0 + (r % 2 ? 170 : 0) + k * 340} y={y - [70, 50, 60, 75][r]!} width={3} height={[70, 50, 60, 75][r]} fill={c("#b0937a")} />
            ))}
          </g>
        ))}
        <ellipse cx={960} cy={975} rx={360} ry={56} fill={c(PINK)} />
        <ellipse cx={960} cy={975} rx={300} ry={40} fill="none" stroke={c("#f1c7cd")} strokeWidth={8} />
      </Layer>
    </g>
  );
}

export const bedroom = { groundY: GROUND, horizonY: 400, wallY: 360, Back };
