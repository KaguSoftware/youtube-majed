import { random } from "remotion";
import { ACCENT } from "../../theme";
import { Layer } from "../camera";
import { Glow, Moon, SkyGradient, Stars, X0, X1, Y0, Y1, lit, t, useGid, type BgProps } from "./common";

/** Diner: teal walls over a red wainscot, big front window onto the street, menu board, counter, checkered floor. */
const GROUND = 885;
const TEAL = "#5aa7a2";
const RED = "#cc4a40";
const RED_DARK = "#a83a33";
const CHROME = "#d9e0e2";
const CREAM = "#f4ead6";

function FrontWindow({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const clip = useGid();
  const night = tod === "night";
  const [x, y, w, h] = [-120, 170, 1060, 400];
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={y} width={w} height={h} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <SkyGradient tod={tod} top={y} bottom={y + h} />
        {night && <Stars frame={frame} count={16} maxY={y + 160} seed="cafe" />}
        {night && <Moon x={x + 820} y={y + 60} r={26} />}
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const bx = x + i * 190 - 20;
          const by = y + 60 + random(`cafe-b${i}`) * 90;
          const col = ["#b9998d", "#9eaabc", "#c7ae84", "#a89dba", "#adb59a", "#c49e9b"][i]!;
          return (
            <g key={i}>
              <rect x={bx} y={by} width={180} height={h} fill={c(col)} />
              {[0, 1, 2, 3, 4, 5].map((k) => {
                const glow = lit(tod) && random(`cafe-w${i}-${k}`) > 0.45;
                return <rect key={k} x={bx + 30 + (k % 2) * 70} y={by + 30 + Math.floor(k / 2) * 70} width={44} height={44} fill={glow ? "#ffd98a" : c("#e6eef2")} opacity={glow ? 0.9 : 0.45} />;
              })}
            </g>
          );
        })}
        <rect x={x} y={y + h - 70} width={w} height={70} fill={c("#9d9890")} />
        <rect x={x} y={y + h - 74} width={w} height={8} fill={c("#c4beb3")} />
        <g transform={`translate(${x + 560} ${y + h - 70})`}>
          <rect x={-5} y={-260} width={10} height={260} fill={c("#3f4650")} />
          {lit(tod) && <Glow x={0} y={-260} r={90} opacity={0.6} />}
          <circle cx={0} cy={-264} r={16} fill={lit(tod) ? "#ffe9b0" : c("#e9e3d0")} />
        </g>
      </g>
      <rect x={x} y={y} width={w} height={h} fill={c(night ? "#20304f" : "#ffffff")} opacity={0.06} />
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={c(CHROME)} strokeWidth={18} />
      {[1, 2].map((k) => <rect key={k} x={x + (k * w) / 3 - 6} y={y} width={12} height={h} fill={c(CHROME)} />)}
      <path d={`M ${x + 300} ${y + 20} l 60 0 m -260 120 l 120 -120`} stroke="#ffffff" strokeWidth={10} opacity={0.18} strokeLinecap="round" />
      <rect x={x - 20} y={y + h} width={w + 40} height={20} rx={4} fill={c(RED_DARK)} />
      <rect x={x} y={y - 60} width={w} height={44} fill={c(RED)} />
      {Array.from({ length: 14 }, (_, i) => <rect key={i} x={x + i * 80} y={y - 60} width={40} height={44} fill={c(CREAM)} />)}
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod, true);
  const on = lit(tod);
  return (
    <g>
      <Layer depth={0.8}>
        <rect x={X0} y={Y0} width={X1 - X0} height={GROUND - Y0} fill={c(TEAL)} />
        <rect x={X0} y={Y0} width={X1 - X0} height={60 - Y0} fill={c("#3f8580")} />
        <rect x={X0} y={600} width={X1 - X0} height={GROUND - 600} fill={c(RED)} />
        <rect x={X0} y={594} width={X1 - X0} height={14} fill={c(CHROME)} />
        {Array.from({ length: 26 }, (_, i) => <rect key={i} x={X0 + i * 100} y={620} width={4} height={GROUND - 620} fill={c(RED_DARK)} />)}
        <FrontWindow tod={tod} frame={frame} />
        <g transform="translate(1120 180)">
          <rect x={0} y={0} width={560} height={230} rx={10} fill={c("#2e3a3a")} />
          <rect x={10} y={10} width={540} height={210} rx={6} fill="none" stroke={c("#c9a66b")} strokeWidth={4} />
          <rect x={200} y={28} width={160} height={22} rx={6} fill={on ? ACCENT : c("#f2c45c")} />
          {[0, 1, 2, 3].map((r) => (
            <g key={r}>
              <rect x={40} y={76 + r * 36} width={110 + random(`menu-${r}`) * 90} height={12} rx={6} fill={c(CREAM)} opacity={0.85} />
              <rect x={460} y={76 + r * 36} width={56} height={12} rx={6} fill={c("#f2a65c")} />
              <rect x={280} y={80 + r * 36} width={160} height={4} rx={2} fill={c(CREAM)} opacity={0.25} />
            </g>
          ))}
        </g>
        <g transform="translate(1040 0)">
          <rect x={0} y={598} width={X1 - 1040} height={34} rx={6} fill={c(CHROME)} />
          <rect x={20} y={632} width={X1 - 1060} height={GROUND - 632} fill={c("#e7dcc6")} />
          <rect x={20} y={660} width={X1 - 1060} height={30} fill={c(TEAL)} />
          {[90, 260, 600].map((cx, i) => (
            <g key={cx}>
              <rect x={cx} y={[548, 560, 540][i]} width={[60, 36, 46][i]} height={[50, 38, 58][i]} rx={8} fill={c(["#e9eef0", "#d0473d", "#f2c45c"][i]!)} />
            </g>
          ))}
          <path d="M 420 598 L 420 540 Q 420 520 450 520 L 520 520 Q 550 520 550 540 L 550 598 Z" fill={c("#bfc7ca")} />
          <ellipse cx={485} cy={514} rx={30} ry={8} fill={c("#a8b0b3")} />
        </g>
        {[1240, 1500, 1760].map((x, i) => (
          <g key={x}>
            {on && <Glow x={x} y={130} r={260} opacity={0.5} />}
            <rect x={x - 2} y={Y0} width={4} height={96 - Y0} fill={c("#3a3f44")} />
            <path d={`M ${x - 46} 140 Q ${x - 40} 96 ${x} 96 Q ${x + 40} 96 ${x + 46} 140 Z`} fill={c(i === 1 ? CREAM : RED)} />
            <ellipse cx={x} cy={141} rx={30} ry={7} fill={on ? ACCENT : c("#fff2cc")} />
          </g>
        ))}
      </Layer>
      <Layer depth={1}>
        <rect x={X0} y={GROUND - 36} width={X1 - X0} height={Y1 - GROUND + 36} fill={c(CREAM)} />
        {[0, 1, 2, 3, 4].map((r) => {
          const y0 = GROUND - 36 + [0, 36, 82, 140, 212][r]!;
          const y1 = GROUND - 36 + [36, 82, 140, 212, 300][r]!;
          return Array.from({ length: 30 }, (_, k) => {
            if ((k + r) % 2) return null;
            const xa = (x: number, y: number) => 960 + (x - 960) * (1 + (y - (GROUND - 36)) / 260);
            const u0 = X0 - 400 + k * 110;
            const u1 = u0 + 110;
            return <path key={`${r}-${k}`} d={`M ${xa(u0, y0)} ${y0} L ${xa(u1, y0)} ${y0} L ${xa(u1, y1)} ${y1} L ${xa(u0, y1)} ${y1} Z`} fill={c("#557880")} />;
          });
        })}
        <rect x={X0} y={GROUND - 40} width={X1 - X0} height={10} fill={c(RED_DARK)} />
      </Layer>
      <Layer depth={1}>
        {[1840, 2010].map((x) => (
          <g key={x}>
            <rect x={x - 8} y={780} width={16} height={130} fill={c(CHROME)} />
            <ellipse cx={x} cy={910} rx={46} ry={10} fill={c("#9aa3a6")} />
            <rect x={x - 62} y={752} width={124} height={34} rx={14} fill={c(RED)} />
          </g>
        ))}
      </Layer>
    </g>
  );
}

export const cafe = { groundY: GROUND, horizonY: 400, wallY: 380, Back };
