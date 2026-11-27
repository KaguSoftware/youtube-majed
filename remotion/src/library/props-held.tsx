import { useId, type ReactNode } from "react";
import { ACCENT, C, FIGURE_SCALE, INK, PAPER, tone, type TimeOfDay } from "../theme";
import { Glow } from "./backgrounds/common";
import { OUT, type HeldArgs, type PlacedArgs, type PropImpl } from "./prop-kit";
import { propTone } from "./prop-kit";

/**
 * Held props (and hand-or-ground props). Drawn in figure space: facing right,
 * y down, the hand at `at`. Each drawing is a component built around the grip
 * point at (0, 0); `hand()` moves it to the hand and turns it by the swing.
 * Things that hang from the hand take the full swing, things held up or in
 * front take a fraction of it. Placed versions stand on the ground at the
 * figure's scale, so a suitcase is the same size in the hand and on the floor.
 */

type Tod = { tod: TimeOfDay };
type Anim = Tod & { frame: number };
type T = (hex: string) => string;
const toner = (tod: TimeOfDay): T => propTone(tod);
const lit = (tod: TimeOfDay) => tod !== "day";

/** Unique, SVG-safe id for gradients, masks and clips (props render many times per frame). */
function useSvgId(prefix: string) {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** Moves a drawing to the hand and rotates it by `swing * k` (+ a fixed tilt). */
function hand({ at, swing }: HeldArgs, k: number, child: ReactNode, tilt = 0) {
  return <g transform={`translate(${at.x.toFixed(2)} ${at.y.toFixed(2)}) rotate(${(swing * k + tilt).toFixed(2)})`}>{child}</g>;
}

/** World-space placement on the ground: `baseY` is the drawing's lowest point in its own coords. */
function ground({ x, groundY, flip }: PlacedArgs, baseY: number, child: ReactNode, size = 1) {
  const s = FIGURE_SCALE * size;
  return (
    <g transform={`translate(${x} ${groundY}) scale(${flip ? -s : s} ${s}) translate(0 ${-baseY})`}>
      <ellipse cx={0} cy={baseY + 2} rx={52} ry={7} fill={INK} opacity={0.18} />
      {child}
    </g>
  );
}

/** Flame with three layers, flickering with the frame. Base at (0, 0), pointing up. */
function Flame({ frame, size = 1, seed = 0 }: { frame: number; size?: number; seed?: number }) {
  const f = frame + seed;
  const h = 1 + Math.sin(f * 1.7) * 0.08 + Math.sin(f * 0.53) * 0.06;
  const lean = Math.sin(f * 0.9) * 3 + Math.sin(f * 2.3) * 1.5;
  const layer = (w: number, ht: number, fill: string) => (
    <path d={`M ${-w} 0 C ${-w} ${-ht * 0.45}, ${lean * 0.5} ${-ht * 0.6}, ${lean} ${-ht} C ${w * 0.9} ${-ht * 0.55}, ${w} ${-ht * 0.35}, ${w} 0 C ${w} ${w * 0.9}, ${-w} ${w * 0.9}, ${-w} 0 Z`} fill={fill} />
  );
  return (
    <g transform={`scale(${size} ${size * h})`}>
      {layer(13, 44, "#ff7b2e")}
      {layer(9, 32, "#ffb238")}
      {layer(5, 19, "#fff1b8")}
    </g>
  );
}

/* ---------------------------------------------------------------- held up / in front */

function Phone({ tod, frame }: Anim) {
  const t = toner(tod);
  const on = lit(tod);
  const screen = on ? "#bfeaff" : "#8fd3f4";
  const blink = Math.floor(frame / 12) % 3;
  return (
    <g>
      {on && <Glow x={0} y={-16} r={46} opacity={0.5} color="#bfeaff" />}
      <rect x={-13} y={-40} width={26} height={46} rx={6} fill={t("#2b2f3d")} {...OUT} />
      <rect x={-9} y={-34} width={18} height={32} rx={2.5} fill={screen} />
      <rect x={-6} y={-30} width={10} height={6} rx={3} fill="#ffffff" />
      <rect x={-3} y={-21} width={9} height={6} rx={3} fill="#4f9dde" />
      {[0, 1, 2].map((i) => <circle key={i} cx={-4 + i * 4} cy={-9} r={1.4} fill={i === blink ? "#4f9dde" : "#ffffff"} />)}
      <path d="M -4 -37 L 4 -37" stroke="#6b7184" strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}

/** A fan of three flat things pivoting at the hand. */
function Fan({ angles, children }: { angles: number[]; children: (i: number) => ReactNode }) {
  return <g>{angles.map((a, i) => <g key={i} transform={`rotate(${a})`}>{children(i)}</g>)}</g>;
}

function Money({ tod }: Tod) {
  const t = toner(tod);
  return (
    <Fan angles={[-28, -4, 20]}>
      {() => (
        <g>
          <rect x={-15} y={-60} width={30} height={58} rx={3} fill={t("#6cc070")} {...OUT} />
          <rect x={-9} y={-53} width={18} height={44} rx={8} fill="none" stroke={t("#3c8a45")} strokeWidth={2.5} />
          <circle cx={0} cy={-31} r={7} fill={t("#a8dca0")} stroke={t("#2e6b36")} strokeWidth={2.5} />
          <circle cx={0} cy={-51} r={2.5} fill={t("#2e6b36")} />
          <circle cx={0} cy={-11} r={2.5} fill={t("#2e6b36")} />
        </g>
      )}
    </Fan>
  );
}

function Cards({ tod }: Tod) {
  const t = toner(tod);
  const suit = ["♠", "♦", "♥"];
  return (
    <Fan angles={[-30, -6, 18]}>
      {(i) => (
        <g>
          <rect x={-16} y={-58} width={32} height={46} rx={5} fill={t("#ffffff")} {...OUT} />
          <text x={0} y={-25} textAnchor="middle" fontFamily="Fredoka, sans-serif" fontWeight={700} fontSize={i === 2 ? 26 : 20} fill={t(i === 0 ? INK : C.red)}>
            {suit[i]}
          </text>
          <text x={-11} y={-45} fontFamily="Fredoka, sans-serif" fontWeight={700} fontSize={10} fill={t(i === 0 ? INK : C.red)}>A</text>
        </g>
      )}
    </Fan>
  );
}

function Book({ tod }: Tod) {
  const t = toner(tod);
  const lines = (x0: number, x1: number) =>
    [-12, -4, 4, 12].map((y) => <path key={y} d={`M ${x0} ${y} L ${x1} ${y}`} stroke={t("#b9ad96")} strokeWidth={2.5} strokeLinecap="round" />);
  return (
    <g transform="translate(26 -26) rotate(-8)">
      <path d="M -40 -24 L 0 -20 L 40 -24 L 40 26 L 0 30 L -40 26 Z" fill={t("#c0392b")} {...OUT} />
      <path d="M -35 -24 Q -16 -30 0 -21 L 0 25 Q -16 17 -35 21 Z" fill={t(PAPER)} {...OUT} strokeWidth={3} />
      <path d="M 35 -24 Q 16 -30 0 -21 L 0 25 Q 16 17 35 21 Z" fill={t("#ffffff")} {...OUT} strokeWidth={3} />
      {lines(-28, -7)}
      {lines(7, 28)}
    </g>
  );
}

function Mug({ tod, frame }: Anim) {
  const t = toner(tod);
  const steam = (dx: number, ph: number) => {
    const k = ((frame + ph) % 45) / 45;
    const y = -24 - k * 26;
    const w = Math.sin((frame + ph) / 6) * 4;
    return (
      <path key={ph} d={`M ${dx} ${y} C ${dx + 6 + w} ${y - 8}, ${dx - 6 + w} ${y - 14}, ${dx + w} ${y - 22}`} fill="none" stroke={t("#ffffff")} strokeWidth={4} strokeLinecap="round" opacity={0.8 * Math.sin(k * Math.PI)} />
    );
  };
  return (
    <g>
      {steam(16, 0)}
      {steam(26, 22)}
      <path d="M 8 -8 C -6 -8, -6 10, 8 10" fill="none" {...OUT} strokeWidth={9} />
      <path d="M 8 -8 C -6 -8, -6 10, 8 10" fill="none" stroke={t(C.red)} strokeWidth={4} strokeLinecap="round" />
      <path d="M 6 -18 L 38 -18 L 36 14 C 36 18, 33 20, 29 20 L 15 20 C 11 20, 8 18, 8 14 Z" fill={t(C.red)} {...OUT} />
      <ellipse cx={22} cy={-18} rx={16} ry={3.5} fill={t("#5a3420")} stroke={INK} strokeWidth={3} />
      <path d="M 22 4 C 16 -2, 18 -8, 22 -4 C 26 -8, 28 -2, 22 4 Z" fill={t("#ffffff")} />
    </g>
  );
}

function Letter({ tod }: Tod) {
  const t = toner(tod);
  return (
    <g transform="rotate(-10)">
      <g transform="translate(18 -6) rotate(14)">
        <rect x={-6} y={-30} width={52} height={34} rx={3} fill={t("#e9d3a6")} {...OUT} />
        <path d="M -6 -30 L 20 -10 L 46 -30" fill="none" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      </g>
      <rect x={-4} y={-66} width={44} height={56} rx={3} fill={t("#ffffff")} {...OUT} />
      {[-54, -45, -36, -27].map((y, i) => <path key={y} d={`M 4 ${y} L ${i === 3 ? 22 : 32} ${y}`} stroke={t("#8a8fa3")} strokeWidth={2.5} strokeLinecap="round" />)}
      <circle cx={28} cy={-20} r={8} fill={t(C.red)} stroke={INK} strokeWidth={3} />
      <path d="M 25 -20 L 31 -20 M 28 -23 L 28 -17" stroke={t(C.redDark)} strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}

function Key({ tod }: Tod) {
  const t = toner(tod);
  const gold = t("#e8b83a");
  // Pinched just ahead of the bow, so the ring shows behind the hand.
  return (
    <g transform="rotate(-24)">
      <path d="M -6 -5 L 58 -5 L 58 5 L -6 5 Z" fill={gold} {...OUT} />
      <path d="M 40 5 L 40 18 L 48 18 L 48 12 L 54 12 L 54 22 L 60 22 L 60 5" fill={gold} {...OUT} />
      <circle cx={-22} cy={0} r={16} fill={gold} {...OUT} />
      <circle cx={-22} cy={0} r={6} fill="none" stroke={INK} strokeWidth={3.5} />
      <path d="M 12 -1 L 36 -1" stroke={t("#fff0b0")} strokeWidth={2.5} strokeLinecap="round" />
    </g>
  );
}

function MapSheet({ tod }: Tod) {
  const t = toner(tod);
  return (
    <g transform="translate(46 -30) rotate(-6)">
      <path d="M -48 -32 L -16 -28 L 16 -32 L 48 -28 L 48 32 L 16 28 L -16 32 L -48 28 Z" fill={t("#f1e0b0")} {...OUT} />
      <path d="M -16 -28 L 16 -32 L 16 28 L -16 32 Z" fill={t("#e2cd95")} />
      <path d="M -40 -18 C -34 -26, -22 -22, -24 -12 C -26 -2, -38 -6, -40 -18 Z" fill={t("#8cc47a")} />
      <path d="M 24 8 C 30 -2, 44 2, 42 14 C 40 24, 26 22, 24 8 Z" fill={t("#7fb7e0")} />
      <path d="M -36 18 C -20 6, -8 20, 6 4 C 16 -8, 22 -16, 30 -18" fill="none" stroke={t(C.red)} strokeWidth={3.5} strokeDasharray="1 7" strokeLinecap="round" />
      <path d="M 26 -24 L 36 -14 M 36 -24 L 26 -14" stroke={t(C.red)} strokeWidth={5} strokeLinecap="round" />
      <path d="M -16 -28 L -16 32 M 16 -32 L 16 28" stroke={INK} strokeWidth={2} opacity={0.35} />
      <path d="M -48 -32 L -16 -28 L 16 -32 L 48 -28 L 48 32 L 16 28 L -16 32 L -48 28 Z" fill="none" {...OUT} />
    </g>
  );
}

function Newspaper({ tod }: Tod) {
  const t = toner(tod);
  const col = (x0: number, x1: number, ys: number[]) =>
    ys.map((y) => <path key={`${x0}-${y}`} d={`M ${x0} ${y} L ${x1} ${y}`} stroke={t("#9a9aa6")} strokeWidth={2.5} strokeLinecap="round" />);
  return (
    <g transform="translate(50 -32) rotate(-5)">
      <path d="M -52 -38 L 0 -34 L 52 -38 L 52 36 L 0 40 L -52 36 Z" fill={t("#f2f0e8")} {...OUT} />
      <rect x={-46} y={-30} width={42} height={18} rx={2} fill={t("#2f3142")} />
      <path d="M -40 -21 L -10 -21" stroke={t("#f2f0e8")} strokeWidth={5} strokeLinecap="round" />
      <rect x={-46} y={-6} width={18} height={16} fill={t("#b8c4d6")} />
      {col(-24, -6, [-4, 2, 8])}
      {col(-46, -6, [17, 23, 29])}
      <rect x={6} y={-30} width={40} height={8} rx={2} fill={t("#2f3142")} />
      <rect x={6} y={-16} width={20} height={20} fill={t("#e4b7a0")} />
      {col(30, 46, [-14, -8, -2, 4])}
      {col(6, 46, [12, 18, 24, 30])}
      <path d="M 0 -34 L 0 40" stroke={INK} strokeWidth={2.5} opacity={0.4} />
    </g>
  );
}

function Flowers({ tod }: Tod) {
  const t = toner(tod);
  const bloom = (x: number, y: number, petal: string, r: number) => (
    <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
      {[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={0} cy={-r} r={r * 0.75} fill={t(petal)} stroke={INK} strokeWidth={2.5} transform={`rotate(${a})`} />)}
      <circle r={r * 0.55} fill={t("#ffd23f")} stroke={INK} strokeWidth={2.5} />
    </g>
  );
  return (
    <g transform="rotate(22)">
      <path d="M -16 -34 C -26 -44, -18 -54, -8 -46 M 18 -36 C 30 -46, 24 -56, 12 -48" fill={t("#4f9a4a")} {...OUT} strokeWidth={3} />
      {bloom(-12, -52, "#ff6b8b", 9)}
      {bloom(14, -54, "#9b6bff", 9)}
      {bloom(0, -66, C.red, 10)}
      {bloom(-20, -38, "#ffb238", 7)}
      {bloom(22, -40, "#ff6b8b", 7)}
      <path d="M -26 -36 L 26 -36 L 4 22 L -4 22 Z" fill={t("#f7d9e3")} {...OUT} />
      <path d="M -26 -36 L -8 -22 L 6 -36" fill="none" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" opacity={0.5} />
      <path d="M -9 0 L 9 0" stroke={t("#d63a6a")} strokeWidth={6} strokeLinecap="round" />
    </g>
  );
}

function Magnifier({ tod }: Tod) {
  const t = toner(tod);
  return (
    <g transform="rotate(40)">
      <path d="M 0 22 L 0 -22" stroke={INK} strokeWidth={14} strokeLinecap="round" />
      <path d="M 0 22 L 0 -22" stroke={t(C.woodDark)} strokeWidth={7} strokeLinecap="round" />
      <rect x={-6} y={-32} width={12} height={12} rx={2} fill={t("#c9ccd6")} {...OUT} strokeWidth={3} />
      <circle cx={0} cy={-62} r={30} fill={t("#cfeefa")} fillOpacity={0.55} stroke={INK} strokeWidth={13} />
      <circle cx={0} cy={-62} r={30} fill="none" stroke={t("#e8b83a")} strokeWidth={6} />
      <path d="M -16 -70 A 18 18 0 0 1 -4 -80" fill="none" stroke="#ffffff" strokeWidth={4} strokeLinecap="round" opacity={0.9} />
    </g>
  );
}

function Torch({ tod, frame }: Anim) {
  const t = toner(tod);
  const on = lit(tod);
  const pulse = 1 + Math.sin(frame * 0.8) * 0.05;
  return (
    <g transform="rotate(14)">
      {on && <Glow x={0} y={-88} r={190 * pulse} opacity={tod === "night" ? 0.5 : 0.35} />}
      {on && <Glow x={0} y={-88} r={60} opacity={0.6} color="#ffb238" />}
      <path d="M -6 36 L -8 -58 L 8 -58 L 6 36 Z" fill={t(C.wood)} {...OUT} />
      <path d="M -2 30 L -3 -50" stroke={t(C.woodLight)} strokeWidth={2.5} strokeLinecap="round" />
      <path d="M -12 -56 L 12 -56 L 14 -76 L -14 -76 Z" fill={t("#7a5a40")} {...OUT} />
      <path d="M -13 -63 L 13 -63 M -13 -70 L 13 -70" stroke={t("#5a3f2c")} strokeWidth={3} />
      <g transform="translate(0 -74)">
        <Flame frame={frame} size={1.45} />
      </g>
    </g>
  );
}

function Sword({ tod }: Tod) {
  const t = toner(tod);
  return (
    <g transform="rotate(38)">
      <path d="M -8 -14 L -8 -122 L 0 -142 L 8 -122 L 8 -14 Z" fill={t("#dfe6ee")} {...OUT} />
      <path d="M 0 -18 L 0 -124" stroke={t("#9aa7b8")} strokeWidth={3} strokeLinecap="round" />
      <path d="M 3 -20 L 3 -118" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" opacity={0.8} />
      <rect x={-26} y={-16} width={52} height={10} rx={5} fill={t("#e8b83a")} {...OUT} />
      <rect x={-5.5} y={-8} width={11} height={30} rx={3} fill={t("#7a3b2e")} {...OUT} strokeWidth={3.5} />
      <circle cx={0} cy={26} r={8} fill={t("#e8b83a")} {...OUT} strokeWidth={3.5} />
    </g>
  );
}

function Sandwich({ tod }: Tod) {
  const t = toner(tod);
  const mask = useSvgId("bite");
  const bites = [
    [50, -36, 12],
    [60, -24, 11],
  ] as const;
  return (
    <g transform="translate(10 -18) rotate(-12)">
      <defs>
        <mask id={mask}>
          <rect x={-40} y={-80} width={140} height={120} fill="#ffffff" />
          {bites.map(([x, y, r]) => <circle key={x} cx={x} cy={y} r={r} fill="#000000" />)}
        </mask>
      </defs>
      <g mask={`url(#${mask})`}>
        <rect x={-8} y={2} width={66} height={14} rx={5} fill={t("#c98d4a")} {...OUT} strokeWidth={3.5} />
        <rect x={-3} y={5} width={56} height={6} rx={3} fill={t("#f6deaa")} />
        <rect x={-6} y={-6} width={56} height={10} rx={3} fill={t("#e2483c")} {...OUT} strokeWidth={3} />
        <path d="M -8 -10 L 54 -10 L 52 -2 L -6 -2 Z" fill={t("#ffd23f")} {...OUT} strokeWidth={3} />
        <path d="M -10 -12 Q -4 -20, 2 -12 Q 8 -20, 14 -12 Q 20 -20, 26 -12 Q 32 -20, 38 -12 Q 44 -20, 50 -12 Q 56 -20, 58 -12 L 56 -8 L -8 -8 Z" fill={t("#6cc04a")} {...OUT} strokeWidth={3} />
        <path d="M -8 -14 L -8 -30 Q -8 -38, 0 -38 L 50 -38 Q 58 -38, 58 -30 L 58 -14 Z" fill={t("#c98d4a")} {...OUT} />
        <rect x={-3} y={-34} width={56} height={16} rx={4} fill={t("#f6deaa")} />
      </g>
      <clipPath id={`${mask}-in`}>
        <rect x={-10} y={-40} width={70} height={58} />
      </clipPath>
      <g clipPath={`url(#${mask}-in)`} mask={`url(#${mask})`}>
        {bites.map(([x, y, r]) => <circle key={x} cx={x} cy={y} r={r + 1.5} fill="none" stroke={INK} strokeWidth={3.5} />)}
      </g>
    </g>
  );
}

function Flashlight({ tod, frame }: Anim) {
  const t = toner(tod);
  const on = lit(tod);
  const beam = useSvgId("beam");
  const flick = 0.92 + Math.sin(frame * 0.5) * 0.04;
  return (
    <g transform="rotate(-6)">
      {on && (
        <g>
          <defs>
            <linearGradient id={beam} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.75 * flick} />
              <stop offset="60%" stopColor={ACCENT} stopOpacity={0.22 * flick} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d="M 46 -12 L 360 -95 Q 380 0, 360 95 L 46 12 Z" fill={`url(#${beam})`} />
          <Glow x={50} y={0} r={40} opacity={0.7} color="#fff6d0" />
        </g>
      )}
      <rect x={-18} y={-8} width={44} height={16} rx={4} fill={t("#3b5bdb")} {...OUT} />
      <path d="M -10 -8 L -10 8 M -2 -8 L -2 8" stroke={t("#2a3f9c")} strokeWidth={3} />
      <path d="M 24 -9 L 42 -15 L 42 15 L 24 9 Z" fill={t("#3b5bdb")} {...OUT} />
      <ellipse cx={44} cy={0} rx={5} ry={15} fill={on ? "#fffbe6" : t("#ffe9a8")} {...OUT} strokeWidth={3.5} />
      <rect x={6} y={-13} width={8} height={6} rx={2} fill={t(C.red)} stroke={INK} strokeWidth={2.5} />
    </g>
  );
}

/** Hook handle at the hand; shaft leans back so the canopy (~216 wide) sits over the head when the hand is near the shoulder. */
function Umbrella({ tod }: Tod) {
  const t = toner(tod);
  const clip = useSvgId("canopy");
  const top = -228;
  const rim = -158;
  const scallops = Array.from({ length: 6 }, (_, i) => {
    const x0 = 108 - i * 36;
    return `Q ${x0 - 18} ${rim - 16}, ${x0 - 36} ${rim}`;
  }).join(" ");
  const canopy = `M -108 ${rim} C -108 ${top + 30}, -50 ${top}, 0 ${top} C 50 ${top}, 108 ${top + 30}, 108 ${rim} ${scallops} Z`;
  const panel = (x0: number, x1: number) => (
    <path key={x0} d={`M 0 ${top} C ${x0 * 0.45} ${top + 6}, ${x0} ${rim - 40}, ${x0} ${rim} L ${x1} ${rim} C ${x1} ${rim - 40}, ${x1 * 0.45} ${top + 6}, 0 ${top} Z`} fill={t("#f2f0e8")} />
  );
  const shaft = `M 0 ${top} L 0 18 C 0 32, -18 32, -18 20`;
  return (
    <g transform="rotate(-12)">
      <defs>
        <clipPath id={clip}>
          <path d={canopy} />
        </clipPath>
      </defs>
      <path d={shaft} fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" />
      <path d={shaft} fill="none" stroke={t("#5a3f2c")} strokeWidth={3.5} strokeLinecap="round" />
      <path d={canopy} fill={t(C.red)} />
      <g clipPath={`url(#${clip})`}>
        {panel(-72, -36)}
        {panel(0, 36)}
        {panel(72, 108)}
      </g>
      <path d={canopy} fill="none" {...OUT} />
      <path d={`M 0 ${top} L 0 ${top - 12}`} {...OUT} strokeWidth={6} />
    </g>
  );
}

function Balloon({ tod, frame, swing }: Anim & { swing: number }) {
  const t = toner(tod);
  const sway = Math.sin(frame / 20) * 10 - swing * 1.4;
  const bx = 8 + sway;
  const by = -218 + Math.sin(frame / 15) * 4;
  return (
    <g>
      <path d={`M 0 0 C ${10 + sway * 0.2} -60, ${-10 + sway * 0.6} -130, ${bx} ${by + 48}`} fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
      <g transform={`translate(${bx} ${by}) rotate(${sway * 0.5})`}>
        <path d="M -6 52 L 6 52 L 0 44 Z" fill={t(C.red)} {...OUT} strokeWidth={3} />
        <path d="M 0 46 C -24 46, -38 20, -38 -4 C -38 -30, -20 -44, 0 -44 C 20 -44, 38 -30, 38 -4 C 38 20, 24 46, 0 46 Z" fill={t("#e63946")} {...OUT} />
        <path d="M -22 -18 C -20 -28, -12 -34, -4 -35" fill="none" stroke="#ffffff" strokeWidth={6} strokeLinecap="round" opacity={0.75} />
      </g>
    </g>
  );
}

/* ---------------------------------------------------------------- hanging from the hand */

function Briefcase({ tod }: Tod) {
  const t = toner(tod);
  return (
    <g>
      <path d="M -14 14 L -14 2 C -14 -6, 14 -6, 14 2 L 14 14" fill="none" {...OUT} strokeWidth={9} />
      <path d="M -14 14 L -14 2 C -14 -6, 14 -6, 14 2 L 14 14" fill="none" stroke={t("#5a3a24")} strokeWidth={4} strokeLinecap="round" />
      <rect x={-36} y={12} width={72} height={52} rx={7} fill={t(C.woodDark)} {...OUT} />
      <path d="M -36 28 L 36 28" stroke={t("#6b4529")} strokeWidth={4} />
      <rect x={-22} y={23} width={10} height={10} rx={2} fill={t("#e8b83a")} stroke={INK} strokeWidth={2.5} />
      <rect x={12} y={23} width={10} height={10} rx={2} fill={t("#e8b83a")} stroke={INK} strokeWidth={2.5} />
      <path d="M -30 58 L 30 58" stroke={t("#a87450")} strokeWidth={3} strokeLinecap="round" opacity={0.7} />
    </g>
  );
}

/** Suitcase with its handle at (0, 0) and its base at y = 78. */
function Suitcase({ tod }: Tod) {
  const t = toner(tod);
  return (
    <g>
      <path d="M -12 14 L -12 2 C -12 -6, 12 -6, 12 2 L 12 14" fill="none" {...OUT} strokeWidth={9} />
      <path d="M -12 14 L -12 2 C -12 -6, 12 -6, 12 2 L 12 14" fill="none" stroke={t("#2f3142")} strokeWidth={4} strokeLinecap="round" />
      <rect x={-42} y={12} width={84} height={62} rx={9} fill={t("#e07a3f")} {...OUT} />
      <path d="M -22 14 L -22 72 M 22 14 L 22 72" stroke={t("#b85a28")} strokeWidth={6} />
      <circle cx={-31} cy={32} r={8} fill={t("#4cc2c4")} stroke={INK} strokeWidth={2.5} />
      <rect x={-6} y={44} width={22} height={14} rx={2} fill={t("#ffd23f")} stroke={INK} strokeWidth={2.5} transform="rotate(-14 5 51)" />
      <path d="M 32 52 L 34.5 57 L 40 57.5 L 36 61 L 37 66.5 L 32 64 L 27 66.5 L 28 61 L 24 57.5 L 29.5 57 Z" fill={t("#ffffff")} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={-30} cy={76} r={4} fill={INK} />
      <circle cx={30} cy={76} r={4} fill={INK} />
    </g>
  );
}

/** Cardboard box centred at (0, 0), 92 x 70. */
function Box({ tod }: Tod) {
  const t = toner(tod);
  return (
    <g>
      <rect x={-46} y={-35} width={92} height={70} rx={4} fill={t("#c9955a")} {...OUT} />
      <path d="M -46 -20 L 46 -20" stroke={t("#a97840")} strokeWidth={3} />
      <rect x={-9} y={-35} width={18} height={34} fill={t("#e9cf92")} stroke={INK} strokeWidth={2.5} />
      <path d="M 18 8 L 26 0 L 34 8 M 26 1 L 26 18" fill="none" stroke={t("#7a5530")} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M -36 10 L -14 10 M -36 18 L -20 18" stroke={t("#7a5530")} strokeWidth={3} strokeLinecap="round" />
      <rect x={-46} y={-35} width={92} height={70} rx={4} fill="none" {...OUT} />
    </g>
  );
}

/** Gift box centred at (0, 0), body 60 x 48, bow above. */
function Gift({ tod }: Tod) {
  const t = toner(tod);
  const ribbon = t("#ffd23f");
  return (
    <g>
      <rect x={-30} y={-18} width={60} height={42} rx={3} fill={t("#e63980")} {...OUT} />
      <rect x={-34} y={-30} width={68} height={14} rx={3} fill={t("#ff5c9a")} {...OUT} />
      <rect x={-6} y={-30} width={12} height={54} fill={ribbon} stroke={INK} strokeWidth={2.5} />
      <path d="M 0 -30 C -10 -50, -30 -46, -22 -34 C -18 -30, -8 -30, 0 -30 Z" fill={ribbon} {...OUT} strokeWidth={3} />
      <path d="M 0 -30 C 10 -50, 30 -46, 22 -34 C 18 -30, 8 -30, 0 -30 Z" fill={ribbon} {...OUT} strokeWidth={3} />
      <circle cx={0} cy={-31} r={5} fill={ribbon} stroke={INK} strokeWidth={3} />
    </g>
  );
}

/**
 * Money sack tied at the neck (0, 0), sack below to y = 88, bills poking out
 * on top. `flip` un-mirrors the $ on the ground; held props don't know which
 * way the figure faces, so a left-facing holder shows it mirrored.
 */
function MoneyBag({ tod, flip = false }: Tod & { flip?: boolean }) {
  const t = toner(tod);
  return (
    <g>
      {[-14, 0, 13].map((x, i) => (
        <rect key={x} x={x - 7} y={-20} width={14} height={24} rx={2} fill={t("#6cc070")} stroke={INK} strokeWidth={3} transform={`rotate(${(i - 1) * 18} ${x} 4)`} />
      ))}
      <path d="M -12 4 C -18 12, -44 30, -44 58 C -44 80, -24 88, 0 88 C 24 88, 44 80, 44 58 C 44 30, 18 12, 12 4 Z" fill={t("#d9b277")} {...OUT} />
      <path d="M -16 4 C -18 -2, -8 -4, 0 -2 C 8 -4, 18 -2, 16 4 C 18 10, 8 10, 0 8 C -8 10, -18 10, -16 4 Z" fill={t("#d9b277")} {...OUT} strokeWidth={3.5} />
      <path d="M -14 8 L 14 8" stroke={t("#8a5d3d")} strokeWidth={6} strokeLinecap="round" />
      <text transform={flip ? "scale(-1 1)" : undefined} x={0} y={70} textAnchor="middle" fontFamily="Fredoka, sans-serif" fontWeight={700} fontSize={38} fill={t("#2e7d32")} stroke={INK} strokeWidth={1.5}>$</text>
    </g>
  );
}

/** Chamberstick: finger ring at (0, 0), dish to the right, candle on it, flame on top. Lowest point y = 8. */
function Candle({ tod, frame }: Anim) {
  const t = toner(tod);
  const on = lit(tod);
  // A lit candle lights its own wax: warm instead of re-toned.
  const wax = on ? "#f7e3b5" : t("#fbf1d6");
  const drip = on ? "#e9cd92" : t("#efe0b4");
  return (
    <g>
      {on && <Glow x={26} y={-66} r={150 + Math.sin(frame * 0.9) * 5} opacity={tod === "night" ? 0.45 : 0.32} />}
      <circle cx={-2} cy={-2} r={8} fill="none" {...OUT} strokeWidth={8} />
      <circle cx={-2} cy={-2} r={8} fill="none" stroke={t("#e8b83a")} strokeWidth={3.5} />
      <path d="M 0 0 C 0 6, 52 6, 52 0 L 52 -2 L 0 -2 Z" fill={t("#e8b83a")} {...OUT} strokeWidth={3.5} />
      <ellipse cx={26} cy={-3} rx={26} ry={6} fill={t("#f2c85a")} {...OUT} strokeWidth={3.5} />
      <rect x={18} y={-10} width={16} height={8} rx={2} fill={t("#e8b83a")} stroke={INK} strokeWidth={3} />
      <path d="M 17 -10 L 17 -52 C 21 -55, 31 -55, 35 -52 L 35 -10 Z" fill={wax} {...OUT} strokeWidth={3.5} />
      <path d="M 30 -53 C 30 -46, 33 -44, 33 -40" fill="none" stroke={drip} strokeWidth={4} strokeLinecap="round" />
      <path d="M 26 -54 L 26 -60" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
      <g transform="translate(26 -60)">
        <Flame frame={frame} size={0.6} seed={7} />
      </g>
    </g>
  );
}

/* ---------------------------------------------------------------- registry */

export const HELD_PROPS = {
  phone: { held: (a) => hand(a, 0.2, <Phone tod={a.tod} frame={a.frame} />, -8) },
  money: { held: (a) => hand(a, 0.25, <Money tod={a.tod} />, 18) },
  cards: { held: (a) => hand(a, 0.25, <Cards tod={a.tod} />, 16) },
  book: { held: (a) => hand(a, 0.15, <Book tod={a.tod} />) },
  mug: { held: (a) => hand(a, 0.2, <Mug tod={a.tod} frame={a.frame} />) },
  letter: { held: (a) => hand(a, 0.2, <Letter tod={a.tod} />) },
  key: { held: (a) => hand(a, 0.3, <Key tod={a.tod} />) },
  map: { held: (a) => hand(a, 0.15, <MapSheet tod={a.tod} />) },
  umbrella: { held: (a) => hand(a, 0.15, <Umbrella tod={a.tod} />) },
  flashlight: { held: (a) => hand(a, 0.2, <Flashlight tod={a.tod} frame={a.frame} />) },
  briefcase: { held: (a) => hand(a, 1, <Briefcase tod={a.tod} />) },
  newspaper: { held: (a) => hand(a, 0.15, <Newspaper tod={a.tod} />) },
  balloon: { held: (a) => hand(a, 0, <Balloon tod={a.tod} frame={a.frame} swing={a.swing} />) },
  flowers: { held: (a) => hand(a, 0.3, <Flowers tod={a.tod} />) },
  magnifier: { held: (a) => hand(a, 0.25, <Magnifier tod={a.tod} />) },
  torch: { held: (a) => hand(a, 0.3, <Torch tod={a.tod} frame={a.frame} />) },
  sword: { held: (a) => hand(a, 0.25, <Sword tod={a.tod} />) },
  food: { held: (a) => hand(a, 0.2, <Sandwich tod={a.tod} />) },
  suitcase: {
    held: (a) => hand(a, 1, <Suitcase tod={a.tod} />),
    placed: (p) => ground(p, 80, <Suitcase tod={p.tod} />),
  },
  box: {
    held: (a) => hand(a, 0.15, <g transform="translate(26 -30)"><Box tod={a.tod} /></g>),
    placed: (p) => ground(p, 35, <Box tod={p.tod} />),
  },
  gift: {
    held: (a) => hand(a, 0.2, <g transform="translate(22 -26)"><Gift tod={a.tod} /></g>),
    placed: (p) => ground(p, 24, <Gift tod={p.tod} />, 1.2),
  },
  money_bag: {
    held: (a) => hand(a, 1, <MoneyBag tod={a.tod} />),
    placed: (p) => ground(p, 88, <MoneyBag tod={p.tod} flip={p.flip} />),
  },
  candle: {
    held: (a) => hand(a, 0.3, <Candle tod={a.tod} frame={a.frame} />),
    placed: (p) => ground(p, 8, <g transform="translate(-26 0)"><Candle tod={p.tod} frame={p.frame} /></g>, 1.5),
  },
} satisfies Record<string, PropImpl>;
