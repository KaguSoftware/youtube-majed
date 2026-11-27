import type { ReactNode } from "react";
import { ACCENT, C, INK, PAPER, W, mix, tone, type TimeOfDay } from "../theme";
import { Glow } from "./backgrounds/common";
import { OUT, type PlacedArgs, type PropImpl } from "./prop-kit";
import { propTone } from "./prop-kit";

/**
 * Placed props: ground, wall and sky, drawn in world space at `x`.
 *
 * Every drawing is built in its own local space: origin on the ground (or the
 * wall / sky point) at the prop's x, y up is negative, facing RIGHT. `place()`
 * moves it there and mirrors it when `flip`. Sizes are in frame pixels at the
 * figure's scale (a standing figure is ~380px tall, hip ~175, knee ~90).
 * Seats draw their sitting surface at exactly `-seat`.
 */

type T = (hex: string) => string;
const toner = (tod: TimeOfDay): T => propTone(tod);
const lit = (tod: TimeOfDay) => tod !== "day";
const f2 = (n: number) => n.toFixed(2);

function place(x: number, y: number, flip: boolean, child: ReactNode) {
  return <g transform={`translate(${f2(x)} ${f2(y)}) scale(${flip ? -1 : 1} 1)`}>{child}</g>;
}

/** Soft contact shadow under a ground prop. */
const Shadow = ({ w, cx = 0 }: { w: number; cx?: number }) => <ellipse cx={cx} cy={2} rx={w / 2} ry={9} fill={INK} opacity={0.16} />;

/** A tube with an ink outline: the path twice, wide ink under a narrower colour. */
function Tube({ d, color, w = 9 }: { d: string; color: string; w?: number }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={INK} strokeWidth={w + 7} />
      <path d={d} stroke={color} strokeWidth={w} />
    </g>
  );
}

// ---------------------------------------------------------------- door

/** Point on the ajar door panel: u across (hinge -> free edge), v down. */
function doorPt(u: number, v: number): string {
  const x = -86 + u * 140;
  const top = -384 - u * 14;
  const bot = 0 + u * 6;
  return `${f2(x)},${f2(top + v * (bot - top))}`;
}
const doorQuad = (u0: number, v0: number, u1: number, v1: number) => [doorPt(u0, v0), doorPt(u1, v0), doorPt(u1, v1), doorPt(u0, v1)].join(" ");

function Door({ x, groundY, tod, flip }: PlacedArgs) {
  const t = toner(tod);
  return place(x, groundY, flip, (
    <g>
      <Shadow w={250} />
      {/* frame and the dark gap behind the open door */}
      <rect x={-108} y={-404} width={216} height={404} rx={6} fill={t(C.woodDark)} {...OUT} />
      <rect x={-86} y={-384} width={172} height={384} fill={t("#2b2540")} stroke={INK} strokeWidth={3} />
      {lit(tod) && <rect x={60} y={-380} width={22} height={378} fill={ACCENT} opacity={0.55} />}
      <rect x={-122} y={-16} width={44} height={16} rx={4} fill={t(C.woodDark)} {...OUT} />
      <rect x={78} y={-16} width={44} height={16} rx={4} fill={t(C.woodDark)} {...OUT} />
      {/* the panel, swung a little toward us on its left hinges */}
      <polygon points={doorQuad(0, 0, 1, 1)} fill={t("#b8443a")} {...OUT} />
      <polygon points={doorQuad(0.16, 0.06, 0.84, 0.44)} fill={t("#a23a31")} stroke={t("#7f2b25")} strokeWidth={4} strokeLinejoin="round" />
      <polygon points={doorQuad(0.16, 0.54, 0.84, 0.94)} fill={t("#a23a31")} stroke={t("#7f2b25")} strokeWidth={4} strokeLinejoin="round" />
      <rect x={-92} y={-330} width={12} height={34} rx={3} fill={t("#4a4452")} />
      <rect x={-92} y={-90} width={12} height={34} rx={3} fill={t("#4a4452")} />
      <circle cx={34} cy={-194} r={11} fill={t("#e3b04b")} {...OUT} strokeWidth={3} />
      <rect x={28} y={-176} width={10} height={16} rx={2} fill={t("#4a4452")} />
    </g>
  ));
}

// ---------------------------------------------------------------- car

/**
 * Side view, facing right, origin under the driver's hip. Body from -222 to
 * +148. The cabin path plus the window path, drawn evenodd, is the window
 * frame alone, so `front` can draw it over the driver.
 */
const CAR_CABIN = "M -206 -150 C -204 -270, -154 -336, -54 -338 C 10 -339, 44 -322, 58 -296 L 98 -152 Z";
const CAR_WINDOW = "M -188 -160 C -186 -258, -144 -318, -54 -320 C 4 -321, 32 -306, 44 -284 L 78 -160 Z";
const CAR_BODY = "M -222 -64 C -224 -112, -206 -152, -170 -158 L 100 -158 C 132 -152, 146 -122, 150 -90 C 152 -66, 148 -46, 134 -42 L -206 -42 C -218 -44, -222 -52, -222 -64 Z";
const CAR_WHEEL_R = 40;
const CAR_WHEELS = [-140, 76];

function CarBody({ x, tod, flip, interior }: { x: number; tod: TimeOfDay; flip: boolean; interior: boolean }) {
  const t = toner(tod);
  const paint = "#e8a43a";
  const paintDark = "#c9852a";
  const spin = ((flip ? -x : x) / CAR_WHEEL_R) * 57.3;
  return (
    <g>
      {interior && (
        <g>
          <path d={CAR_WINDOW} fill={t(C.glass)} />
          {/* rear bench, driver's seat back and headrest, dashboard, steering wheel */}
          <path d="M -178 -160 L -176 -220 C -176 -232, -150 -232, -150 -220 L -146 -160 Z" fill={t("#5b4d6e")} stroke={INK} strokeWidth={3} />
          <path d="M -86 -160 L -84 -246 C -84 -260, -46 -260, -46 -246 L -50 -160 Z" fill={t("#5b4d6e")} stroke={INK} strokeWidth={3} />
          <rect x={-80} y={-292} width={30} height={30} rx={10} fill={t("#5b4d6e")} stroke={INK} strokeWidth={3} />
          <path d="M 28 -160 L 34 -186 C 50 -192, 68 -192, 80 -172 L 82 -160 Z" fill={t("#3e3550")} />
          <path d="M 44 -184 L 60 -168" stroke={INK} strokeWidth={6} strokeLinecap="round" />
          <ellipse cx={42} cy={-190} rx={9} ry={30} transform="rotate(-24 42 -190)" fill="none" stroke={INK} strokeWidth={7} />
        </g>
      )}
      <Shadow w={400} cx={-36} />
      <path d={CAR_CABIN + " " + CAR_WINDOW} fillRule="evenodd" fill={t(paint)} {...OUT} />
      <rect x={-72} y={-318} width={14} height={160} fill={t(paint)} stroke={INK} strokeWidth={3} />
      <path d={CAR_BODY} fill={t(paint)} {...OUT} />
      {/* skirt, door seam, handle, mirror */}
      <path d="M -214 -74 L 144 -74" stroke={t(paintDark)} strokeWidth={10} strokeLinecap="round" />
      <path d="M -66 -156 L -64 -50 M 90 -150 C 94 -120, 96 -90, 92 -54" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <rect x={-46} y={-136} width={30} height={9} rx={4.5} fill={t("#5c5466")} />
      <path d="M 72 -166 L 92 -170 L 96 -186 L 76 -184 Z" fill={t(paint)} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      {/* glass glint over the windows */}
      <path d="M 0 -308 L 22 -308 L -26 -166 L -48 -166 Z" fill="#ffffff" opacity={0.22} />
      <path d="M -150 -270 L -136 -284 L -170 -172 L -182 -172 Z" fill="#ffffff" opacity={0.22} />
      {/* bumpers and lights */}
      <rect x={118} y={-62} width={40} height={18} rx={9} fill={t("#c8ced6")} {...OUT} strokeWidth={3} />
      <rect x={-232} y={-62} width={40} height={18} rx={9} fill={t("#c8ced6")} {...OUT} strokeWidth={3} />
      {lit(tod) && <Glow x={150} y={-104} r={90} opacity={0.6} />}
      <ellipse cx={142} cy={-106} rx={9} ry={14} fill={lit(tod) ? ACCENT : t("#fff3c4")} stroke={INK} strokeWidth={3} />
      <rect x={-226} y={-118} width={10} height={24} rx={4} fill={lit(tod) ? "#ff5a4e" : t("#d0473d")} stroke={INK} strokeWidth={3} />
      {/* wheels: arches, tyres, hubs that roll with x */}
      {CAR_WHEELS.map((cx) => (
        <g key={cx}>
          <path d={`M ${cx - 52} -42 A 52 52 0 0 1 ${cx + 52} -42 Z`} fill={t("#2a2533")} />
          <circle cx={cx} cy={-CAR_WHEEL_R} r={CAR_WHEEL_R} fill={t("#2f2a38")} {...OUT} />
          <g transform={`translate(${cx} ${-CAR_WHEEL_R}) rotate(${f2(spin)})`}>
            <circle r={20} fill={t("#d6dbe2")} stroke={INK} strokeWidth={3} />
            {[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={0} cy={-11} r={3.4} fill={t("#5c5466")} transform={`rotate(${a})`} />)}
            <circle r={5} fill={t(paint)} />
          </g>
        </g>
      ))}
    </g>
  );
}

// ---------------------------------------------------------------- fire

function flamePath(w: number, h: number, sway: number) {
  return `M ${f2(-w)} 0 C ${f2(-w)} ${f2(-h * 0.38)}, ${f2(-w * 0.45 + sway * 0.4)} ${f2(-h * 0.6)}, ${f2(sway)} ${f2(-h)} C ${f2(w * 0.45 + sway * 0.4)} ${f2(-h * 0.6)}, ${f2(w)} ${f2(-h * 0.38)}, ${f2(w)} 0 C ${f2(w * 0.6)} ${f2(w * 0.5)}, ${f2(-w * 0.6)} ${f2(w * 0.5)}, ${f2(-w)} 0 Z`;
}

function Fire({ x, groundY, tod, frame }: PlacedArgs) {
  const t = toner(tod);
  const night = tod === "night";
  const flick = (p: number) => 1 + 0.13 * Math.sin(frame * 0.55 + p) + 0.07 * Math.sin(frame * 1.37 + p * 2.1);
  const sway = (p: number, a: number) => a * Math.sin(frame * 0.31 + p);
  const tongues = [
    { dx: -34, w: 32, h: 104, p: 1.7, tilt: -14 },
    { dx: 34, w: 32, h: 112, p: 4.1, tilt: 12 },
    { dx: 0, w: 52, h: 148, p: 0, tilt: 0 },
  ];
  const glow = 0.92 + 0.08 * Math.sin(frame * 0.7);
  return place(x, groundY, false, (
    <g>
      <Glow x={0} y={-70} r={night ? 420 : tod === "dusk" ? 320 : 190} opacity={(night ? 0.55 : tod === "dusk" ? 0.42 : 0.2) * glow} color="#ff9a3c" />
      {lit(tod) && <ellipse cx={0} cy={4} rx={190} ry={26} fill="#ffb052" opacity={0.22 * glow} />}
      <Shadow w={180} />
      {/* logs */}
      <g transform="rotate(-13 0 -20)">
        <rect x={-84} y={-34} width={168} height={28} rx={14} fill={t(C.woodDark)} {...OUT} />
        <ellipse cx={70} cy={-20} rx={9} ry={12} fill={t(C.woodLight)} stroke={INK} strokeWidth={3} />
      </g>
      <g transform="rotate(13 0 -20)">
        <rect x={-84} y={-34} width={168} height={28} rx={14} fill={t(C.wood)} {...OUT} />
        <ellipse cx={-70} cy={-20} rx={9} ry={12} fill={t(C.woodLight)} stroke={INK} strokeWidth={3} />
      </g>
      {/* flames: three layers per tongue */}
      <g transform="translate(0 -26)">
        {tongues.map(({ dx, w, h, p, tilt }) => (
          <g key={p} transform={`translate(${dx} 0) rotate(${tilt})`}>
            <path d={flamePath(w, h * flick(p), sway(p, 12))} fill="#ec5b37" {...OUT} strokeWidth={3.5} />
            <path d={flamePath(w * 0.68, h * 0.7 * flick(p + 1), sway(p + 0.6, 9))} fill="#f8a03a" />
            <path d={flamePath(w * 0.38, h * 0.42 * flick(p + 2), sway(p + 1.2, 6))} fill="#ffe27a" />
          </g>
        ))}
      </g>
      {/* sparks */}
      {[0, 1, 2, 3, 4].map((i) => {
        const life = ((frame + i * 13) % 44) / 44;
        return <circle key={i} cx={f2(Math.sin(i * 2.3 + life * 5) * 34)} cy={f2(-120 - life * 170)} r={f2(4 * (1 - life))} fill="#ffd166" opacity={f2(1 - life)} />;
      })}
      {/* ring of stones */}
      {[-96, -62, -24, 18, 58, 94].map((sx, i) => (
        <ellipse key={sx} cx={sx} cy={-9 + (i % 2) * 3} rx={22} ry={13} fill={t(i % 2 ? C.rock : C.rockDark)} stroke={INK} strokeWidth={3} />
      ))}
    </g>
  ));
}

// ---------------------------------------------------------------- furniture

function Table({ x, groundY, tod, flip }: PlacedArgs) {
  const t = toner(tod);
  return place(x, groundY, flip, (
    <g>
      <Shadow w={280} />
      <rect x={-118} y={-112} width={18} height={112} rx={4} fill={t(C.woodDark)} {...OUT} />
      <rect x={100} y={-112} width={18} height={112} rx={4} fill={t(C.woodDark)} {...OUT} />
      <rect x={-124} y={-114} width={248} height={18} rx={4} fill={t(C.wood)} {...OUT} strokeWidth={3} />
      <rect x={-140} y={-128} width={280} height={18} rx={6} fill={t(C.woodLight)} {...OUT} />
    </g>
  ));
}

function Desk({ x, groundY, tod, flip, frame }: PlacedArgs) {
  const t = toner(tod);
  const on = lit(tod);
  const scr = on ? "#a9e6ff" : t("#d4ecf6");
  const line = on ? "#3b6f9a" : t("#5d7f99");
  const blink = Math.floor(frame / 12) % 2 === 0;
  return place(x, groundY, flip, (
    <g>
      <Shadow w={360} />
      {/* drawer pedestal and leg */}
      <rect x={-166} y={-112} width={96} height={112} rx={4} fill={t(C.wood)} {...OUT} />
      <rect x={-156} y={-100} width={76} height={40} rx={4} fill={t(C.woodLight)} stroke={INK} strokeWidth={3} />
      <rect x={-156} y={-52} width={76} height={40} rx={4} fill={t(C.woodLight)} stroke={INK} strokeWidth={3} />
      <rect x={-128} y={-84} width={20} height={6} rx={3} fill={INK} />
      <rect x={-128} y={-36} width={20} height={6} rx={3} fill={INK} />
      <rect x={146} y={-112} width={18} height={112} rx={4} fill={t(C.woodDark)} {...OUT} />
      <rect x={-176} y={-128} width={352} height={18} rx={6} fill={t(C.woodLight)} {...OUT} />
      {/* monitor, turned a little toward the sitter (-x) */}
      {on && <Glow x={40} y={-215} r={200} opacity={0.5} color="#9fdcff" />}
      <path d="M 30 -130 L 50 -130 L 46 -160 L 34 -160 Z" fill={t("#4a4452")} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <rect x={6} y={-136} width={68} height={10} rx={4} fill={t("#4a4452")} stroke={INK} strokeWidth={3} />
      <path d="M -42 -276 L 118 -288 L 118 -150 L -42 -160 Z" fill={t("#3a3546")} {...OUT} />
      <path d="M -32 -266 L 108 -277 L 108 -160 L -32 -169 Z" fill={scr} />
      {[0, 1, 2, 3, 4].map((i) => {
        const y0 = -250 + i * 17;
        const len = [80, 56, 96, 40, 70][i]!;
        return <path key={i} d={`M ${-18 + (i % 2) * 12} ${y0 - i * 0.2} L ${-18 + (i % 2) * 12 + len} ${y0 - 6 - i * 0.2}`} stroke={line} strokeWidth={6} strokeLinecap="round" />;
      })}
      {blink && <rect x={56} y={-176} width={10} height={14} fill={line} />}
      {/* keyboard and mouse on the sitter's side */}
      <path d="M -150 -128 L -146 -138 L -50 -138 L -46 -128 Z" fill={t("#e6e2ea")} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M -138 -133 L -58 -133" stroke={t("#9a94a6")} strokeWidth={3} strokeDasharray="6 4" />
      <ellipse cx={-22} cy={-133} rx={10} ry={6} fill={t("#e6e2ea")} stroke={INK} strokeWidth={3} />
    </g>
  ));
}

function Chair({ x, groundY, tod, flip }: PlacedArgs) {
  const t = toner(tod);
  return place(x, groundY, flip, (
    <g>
      <Shadow w={130} />
      {/* back leg + back post (sitter's back is toward -x) */}
      <path d="M -56 0 L -50 -92 L -58 -232 L -42 -232 L -34 -92 L -40 0 Z" fill={t(C.woodDark)} {...OUT} />
      <rect x={-64} y={-232} width={30} height={60} rx={8} fill={t(C.wood)} {...OUT} />
      <rect x={-62} y={-160} width={26} height={14} rx={5} fill={t(C.wood)} {...OUT} strokeWidth={3} />
      {/* front leg, rung, seat */}
      <rect x={40} y={-90} width={16} height={90} rx={4} fill={t(C.woodDark)} {...OUT} />
      <path d="M -40 -36 L 42 -36" stroke={INK} strokeWidth={13} strokeLinecap="round" />
      <path d="M -40 -36 L 42 -36" stroke={t(C.woodDark)} strokeWidth={6} strokeLinecap="round" />
      <rect x={-62} y={-92} width={128} height={16} rx={6} fill={t(C.woodLight)} {...OUT} />
    </g>
  ));
}

function Stool({ x, groundY, tod }: PlacedArgs) {
  const t = toner(tod);
  const metal = t("#5c6370");
  return place(x, groundY, false, (
    <g>
      <Shadow w={120} />
      <Tube d="M 0 -110 L 0 -4" color={t("#454b57")} w={7} />
      <Tube d="M -26 -108 L -46 0 M 26 -108 L 46 0" color={metal} w={8} />
      <Tube d="M -38 -44 L 38 -44" color={metal} w={6} />
      <rect x={-50} y={-120} width={100} height={22} rx={11} fill={t("#c94f4f")} {...OUT} />
      <path d="M -40 -114 L 40 -114" stroke={t("#e07a6c")} strokeWidth={4} strokeLinecap="round" />
    </g>
  ));
}

function Bench({ x, groundY, tod }: PlacedArgs) {
  const t = toner(tod);
  const iron = t("#363a46");
  return place(x, groundY, false, (
    <g>
      <Shadow w={320} />
      {/* back planks behind the seat */}
      <rect x={-150} y={-196} width={300} height={22} rx={6} fill={t(C.wood)} {...OUT} />
      <rect x={-150} y={-160} width={300} height={22} rx={6} fill={t(C.wood)} {...OUT} />
      {/* cast-iron ends */}
      {[-118, 118].map((ex) => {
        const s = ex < 0 ? -1 : 1;
        return (
          <g key={ex} fill="none" stroke={iron} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round">
            <path d={`M ${ex - s * 4} -206 L ${ex} -84 L ${ex + s * 6} -10 C ${ex + s * 8} -2, ${ex + s * 18} -2, ${ex + s * 20} -8`} />
            <path d={`M ${ex} -84 L ${ex + s * 10} -122 C ${ex + s * 14} -134, ${ex + s * 28} -132, ${ex + s * 26} -118`} />
          </g>
        );
      })}
      {/* seat: top plank and front plank, top surface at -84 */}
      <rect x={-156} y={-92} width={312} height={12} rx={5} fill={t(C.woodLight)} {...OUT} strokeWidth={3} />
      <rect x={-156} y={-82} width={312} height={16} rx={5} fill={t(C.wood)} {...OUT} />
    </g>
  ));
}

function Sofa({ x, groundY, tod }: PlacedArgs) {
  const t = toner(tod);
  const base = "#3a8f86";
  const light = "#56aaa0";
  const dark = "#2c7069";
  return place(x, groundY, false, (
    <g>
      <Shadow w={360} />
      <rect x={-150} y={-20} width={14} height={20} rx={3} fill={t(C.woodDark)} {...OUT} strokeWidth={3} />
      <rect x={136} y={-20} width={14} height={20} rx={3} fill={t(C.woodDark)} {...OUT} strokeWidth={3} />
      <rect x={-150} y={-206} width={300} height={150} rx={34} fill={t(dark)} {...OUT} />
      <rect x={-128} y={-188} width={126} height={110} rx={22} fill={t(base)} stroke={INK} strokeWidth={3} />
      <rect x={2} y={-188} width={126} height={110} rx={22} fill={t(base)} stroke={INK} strokeWidth={3} />
      <rect x={-160} y={-64} width={320} height={46} rx={12} fill={t(dark)} {...OUT} />
      <rect x={-134} y={-80} width={134} height={30} rx={12} fill={t(light)} {...OUT} strokeWidth={3.5} />
      <rect x={0} y={-80} width={134} height={30} rx={12} fill={t(light)} {...OUT} strokeWidth={3.5} />
      <rect x={-184} y={-134} width={54} height={116} rx={24} fill={t(base)} {...OUT} />
      <rect x={130} y={-134} width={54} height={116} rx={24} fill={t(base)} {...OUT} />
    </g>
  ));
}

function Crate({ x, groundY, tod }: PlacedArgs) {
  const t = toner(tod);
  const nail = (cx: number, cy: number) => <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={3} fill={INK} />;
  return place(x, groundY, false, (
    <g>
      <Shadow w={140} />
      <rect x={-62} y={-88} width={124} height={88} rx={4} fill={t(C.woodLight)} {...OUT} />
      <path d="M -50 -60 L -50 -28 M 50 -60 L 50 -28" stroke={t(C.wood)} strokeWidth={3} />
      <path d="M -54 -26 L 54 -64" stroke={INK} strokeWidth={22} strokeLinecap="round" />
      <path d="M -54 -26 L 54 -64" stroke={t(C.wood)} strokeWidth={15} strokeLinecap="round" />
      <rect x={-62} y={-88} width={124} height={20} rx={3} fill={t(C.wood)} {...OUT} />
      <rect x={-62} y={-20} width={124} height={20} rx={3} fill={t(C.wood)} {...OUT} />
      {[nail(-52, -78), nail(52, -78), nail(-52, -10), nail(52, -10)]}
    </g>
  ));
}

function Rock({ x, groundY, tod, flip }: PlacedArgs) {
  const t = toner(tod);
  return place(x, groundY, flip, (
    <g>
      <Shadow w={270} />
      <path d="M -122 0 C -132 -44, -110 -92, -56 -100 C -14 -106, 46 -106, 80 -96 C 118 -82, 134 -40, 126 0 Z" fill={t(C.rock)} {...OUT} />
      <path d="M 126 0 C 134 -40, 118 -82, 80 -96 C 104 -70, 108 -30, 90 0 Z" fill={t(C.rockDark)} />
      <path d="M -122 0 C -126 -20, -122 -34, -112 -46 C -96 -30, -60 -16, 90 0 Z" fill={t(C.rockDark)} opacity={0.55} />
      <path d="M -60 -88 C -30 -94, 10 -96, 40 -92" fill="none" stroke={t("#b9bfc9")} strokeWidth={6} strokeLinecap="round" />
      <path d="M 20 -64 L 34 -44 L 26 -26 M 34 -44 L 52 -38" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M -122 0 C -132 -44, -110 -92, -56 -100 C -14 -106, 46 -106, 80 -96 C 118 -82, 134 -40, 126 0 Z" fill="none" {...OUT} />
      <ellipse cx={150} cy={-10} rx={20} ry={12} fill={t(C.rock)} stroke={INK} strokeWidth={3} />
      <path d="M -96 0 C -94 -14, -88 -22, -80 -24 M -88 0 C -84 -12, -76 -16, -70 -14" fill="none" stroke={t(C.grassDark)} strokeWidth={5} strokeLinecap="round" />
    </g>
  ));
}

// ---------------------------------------------------------------- outdoor things

function Plant({ x, groundY, tod, frame, flip }: PlacedArgs) {
  const t = toner(tod);
  const sway = Math.sin(frame / 38) * 1.6;
  const leaves = [
    { a: -62, l: 96 },
    { a: -34, l: 132 },
    { a: -8, l: 150 },
    { a: 16, l: 140 },
    { a: 44, l: 116 },
    { a: 70, l: 88 },
    { a: -86, l: 70 },
  ];
  return place(x, groundY, flip, (
    <g>
      <Shadow w={110} />
      <g transform={`translate(0 -78) rotate(${f2(sway)})`}>
        {leaves.map(({ a, l }, i) => (
          <g key={a} transform={`rotate(${a})`}>
            <path d={`M 0 0 C ${-l * 0.32} ${-l * 0.3}, ${-l * 0.26} ${-l * 0.8}, 0 ${-l} C ${l * 0.26} ${-l * 0.8}, ${l * 0.32} ${-l * 0.3}, 0 0 Z`} fill={t(i % 2 ? "#4f9a5a" : "#5fae62")} {...OUT} strokeWidth={3.5} />
            <path d={`M 0 -6 L 0 ${-l * 0.85}`} stroke={t("#3c7a48")} strokeWidth={3} strokeLinecap="round" />
          </g>
        ))}
      </g>
      <path d="M -40 -70 L 40 -70 L 32 0 L -32 0 Z" fill={t("#c8643b")} {...OUT} />
      <rect x={-48} y={-86} width={96} height={20} rx={6} fill={t("#d97a4c")} {...OUT} />
    </g>
  ));
}

function TrashCan({ x, groundY, tod }: PlacedArgs) {
  const t = toner(tod);
  return place(x, groundY, false, (
    <g>
      <Shadow w={110} />
      <path d="M -44 -116 L 44 -116 L 38 0 L -38 0 Z" fill={t("#9aa3ad")} {...OUT} />
      {[-24, -8, 8, 24].map((rx) => (
        <path key={rx} d={`M ${rx} -106 L ${rx * 0.88} -8`} stroke={t("#7b848f")} strokeWidth={6} strokeLinecap="round" />
      ))}
      <path d="M -44 -116 L 44 -116" stroke={t("#c3cad2")} strokeWidth={4} />
      <g transform="rotate(-6 0 -120)">
        <path d="M -16 -132 C -16 -148, 16 -148, 16 -132" fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />
        <path d="M -52 -116 C -50 -136, 50 -136, 52 -116 Z" fill={t("#b3bbc4")} {...OUT} />
      </g>
    </g>
  ));
}

function Bicycle({ x, groundY, tod, flip }: PlacedArgs) {
  const t = toner(tod);
  const frameC = t(C.red);
  const R = 56;
  const wheel = (cx: number) => (
    <g key={cx}>
      <circle cx={cx} cy={-R} r={R - 7} fill="none" stroke={t("#b8bec7")} strokeWidth={3} />
      {[0, 30, 60, 90, 120, 150].map((a) => (
        <path key={a} d={`M ${cx} ${-R - 48} L ${cx} ${-R + 48}`} stroke={t("#9aa3ad")} strokeWidth={2} transform={`rotate(${a} ${cx} ${-R})`} />
      ))}
      <circle cx={cx} cy={-R} r={R - 3} fill="none" stroke={INK} strokeWidth={8} />
      <circle cx={cx} cy={-R} r={6} fill={t("#d6dbe2")} stroke={INK} strokeWidth={3} />
    </g>
  );
  return place(x, groundY, flip, (
    <g>
      <Shadow w={290} />
      {wheel(-92)}
      {wheel(92)}
      <Tube d="M -36 -52 L -54 0" color={t("#5c6370")} w={4} />
      <Tube d="M -92 -56 L -6 -52 L -30 -148 Z M -6 -52 L 66 -134 L -27 -140" color={frameC} w={9} />
      <Tube d="M 60 -150 L 70 -124 L 92 -56" color={t("#c9ced6")} w={6} />
      <Tube d="M -30 -148 L -34 -166" color={t("#c9ced6")} w={5} />
      <path d="M -60 -170 C -50 -178, -16 -176, -12 -168 C -24 -162, -50 -162, -60 -170 Z" fill={t("#3a3546")} {...OUT} strokeWidth={3} />
      <Tube d="M 60 -150 L 56 -172 L 32 -176" color={t("#c9ced6")} w={5} />
      <rect x={22} y={-182} width={20} height={12} rx={5} fill={t("#3a3546")} stroke={INK} strokeWidth={3} />
      <circle cx={-6} cy={-52} r={14} fill={t("#d6dbe2")} stroke={INK} strokeWidth={3} />
      <Tube d="M -6 -52 L 10 -24" color={t("#5c6370")} w={4} />
      <rect x={2} y={-26} width={20} height={7} rx={3} fill={t("#3a3546")} stroke={INK} strokeWidth={2.5} />
    </g>
  ));
}

function Tent({ x, groundY, tod, flip }: PlacedArgs) {
  const t = toner(tod);
  const cloth = "#e8743b";
  const shade = "#c55a2a";
  return place(x, groundY, flip, (
    <g>
      <Shadow w={330} cx={-20} />
      {/* guy lines and pegs */}
      <path d="M -126 -150 L -186 0 M 62 -200 L 176 0" stroke={INK} strokeWidth={2.5} />
      <path d="M -186 0 L -190 -14 M 176 0 L 180 -14" stroke={INK} strokeWidth={5} strokeLinecap="round" />
      {/* side panel going back to the left */}
      <path d="M 50 -214 L -126 -196 L -158 -4 L -64 0 Z" fill={t(shade)} {...OUT} />
      <path d="M 50 -214 L -126 -196" stroke={t("#f2a36b")} strokeWidth={5} strokeLinecap="round" />
      {/* front with its dark open doorway */}
      <path d="M 50 -214 L -64 0 L 164 0 Z" fill={t(cloth)} {...OUT} />
      <path d="M 50 -180 L 4 0 L 96 0 Z" fill={t("#2b2540")} />
      {lit(tod) && <path d="M 50 -150 L 18 0 L 82 0 Z" fill={ACCENT} opacity={0.35} />}
      {/* flaps tied back to each side */}
      <path d="M 50 -180 L 4 0 L -18 0 C -6 -50, 14 -120, 50 -180 Z" fill={t("#f39257")} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M 50 -180 L 96 0 L 122 0 C 108 -60, 84 -128, 50 -180 Z" fill={t("#f39257")} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M 50 -214 L 50 -236" stroke={INK} strokeWidth={6} strokeLinecap="round" />
    </g>
  ));
}

function Ladder({ x, groundY, tod, flip }: PlacedArgs) {
  const t = toner(tod);
  const rails = (x0b: number, x1b: number, x0t: number, x1t: number, top: number, color: string, rungs: boolean) => (
    <g>
      {rungs &&
        Array.from({ length: 8 }, (_, i) => {
          const y = -38 - i * 40;
          const k = -y / -top;
          const xa = x0b + (x0t - x0b) * k;
          const xb = x1b + (x1t - x1b) * k;
          return <rect key={i} x={f2(xa)} y={y - 6} width={f2(xb - xa)} height={12} rx={4} fill={t(C.wood)} stroke={INK} strokeWidth={3} />;
        })}
      <path d={`M ${x0b - 7} 0 L ${x0t - 7} ${top} L ${x0t + 7} ${top} L ${x0b + 7} 0 Z`} fill={color} {...OUT} />
      <path d={`M ${x1b - 7} 0 L ${x1t - 7} ${top} L ${x1t + 7} ${top} L ${x1b + 7} 0 Z`} fill={color} {...OUT} />
    </g>
  );
  return place(x, groundY, flip, (
    <g>
      <Shadow w={170} cx={-20} />
      {/* back legs of the stepladder, splayed behind */}
      {rails(-96, -6, -46, 26, -318, t(C.woodDark), false)}
      <path d="M -60 -150 L 24 -150" stroke={t(C.woodDark)} strokeWidth={6} />
      {rails(-48, 52, -38, 38, -330, t(C.woodLight), true)}
      <rect x={-50} y={-344} width={100} height={18} rx={5} fill={t(C.wood)} {...OUT} />
    </g>
  ));
}

function TreasureChest({ x, groundY, tod, frame, flip }: PlacedArgs) {
  const t = toner(tod);
  const gold = t("#f2c335");
  const goldDark = t("#d49a1e");
  const glint = (gx: number, gy: number, p: number) => {
    const s = Math.max(0, Math.sin(frame * 0.18 + p));
    const r = 4 + 12 * s;
    return (
      <path key={p} d={`M ${gx} ${f2(gy - r)} L ${f2(gx + r * 0.25)} ${f2(gy - r * 0.25)} L ${f2(gx + r)} ${gy} L ${f2(gx + r * 0.25)} ${f2(gy + r * 0.25)} L ${gx} ${f2(gy + r)} L ${f2(gx - r * 0.25)} ${f2(gy + r * 0.25)} L ${f2(gx - r)} ${gy} L ${f2(gx - r * 0.25)} ${f2(gy - r * 0.25)} Z`} fill="#fffbe6" opacity={0.35 + 0.65 * s} />
    );
  };
  return place(x, groundY, flip, (
    <g>
      {lit(tod) && <Glow x={0} y={-100} r={170} opacity={0.4} color="#ffd166" />}
      <Shadow w={210} />
      {/* open lid, its inside facing us */}
      <path d="M -84 -92 L -78 -168 C -60 -200, 60 -200, 78 -168 L 84 -92 Z" fill={t("#6e4128")} {...OUT} />
      <path d="M -66 -100 L -62 -160 C -46 -184, 46 -184, 62 -160 L 66 -100 Z" fill={t("#4f2c1a")} />
      <path d="M -80 -128 L 80 -128" stroke={t("#5c5466")} strokeWidth={8} />
      {/* heap of gold over the rim */}
      <path d="M -82 -88 C -70 -120, -40 -128, -14 -122 C 10 -136, 50 -126, 64 -110 C 76 -104, 82 -96, 82 -88 Z" fill={gold} {...OUT} strokeWidth={3.5} />
      {[[-50, -108], [-20, -118], [12, -124], [40, -112], [-34, -96], [24, -100], [58, -98]].map(([cx, cy]) => (
        <ellipse key={`${cx}`} cx={cx} cy={cy} rx={11} ry={5} fill="none" stroke={goldDark} strokeWidth={3} />
      ))}
      <circle cx={-4} cy={-108} r={7} fill={t("#d0473d")} stroke={INK} strokeWidth={2.5} />
      <circle cx={44} cy={-122} r={6} fill={t("#4f8fd6")} stroke={INK} strokeWidth={2.5} />
      {/* chest body with iron bands and lock */}
      <rect x={-90} y={-92} width={180} height={92} rx={8} fill={t(C.wood)} {...OUT} />
      <path d="M -90 -60 L 90 -60" stroke={t(C.woodDark)} strokeWidth={4} />
      <path d="M -90 -30 L 90 -30" stroke={t(C.woodDark)} strokeWidth={4} />
      <rect x={-70} y={-92} width={16} height={92} fill={t("#5c5466")} stroke={INK} strokeWidth={3} />
      <rect x={54} y={-92} width={16} height={92} fill={t("#5c5466")} stroke={INK} strokeWidth={3} />
      <rect x={-90} y={-96} width={180} height={14} rx={6} fill={t("#5c5466")} {...OUT} strokeWidth={3.5} />
      <rect x={-14} y={-82} width={28} height={32} rx={5} fill={gold} {...OUT} strokeWidth={3} />
      <circle cx={0} cy={-70} r={4} fill={INK} />
      <path d="M 0 -70 L 0 -60" stroke={INK} strokeWidth={3} />
      {/* spilled coins */}
      {[[104, -6], [124, -4], [-108, -5], [114, -14]].map(([cx, cy]) => (
        <ellipse key={`${cx},${cy}`} cx={cx} cy={cy} rx={12} ry={6} fill={gold} stroke={INK} strokeWidth={2.5} />
      ))}
      {glint(-40, -126, 0)}
      {glint(30, -136, 2.1)}
      {glint(70, -100, 4.2)}
    </g>
  ));
}

function Tv({ x, groundY, tod, frame, flip }: PlacedArgs) {
  const t = toner(tod);
  const on = lit(tod);
  const flick = 0.82 + 0.1 * Math.sin(frame * 0.9) + 0.08 * Math.sin(frame * 2.7 + 1);
  const scr = on ? mix("#6fc6f2", "#e8f8ff", 0.35 * flick) : t(mix("#8fb3c6", "#c9e2ee", 0.4 * flick));
  const bar = ((frame * 4) % 120) - 4;
  return place(x, groundY, flip, (
    <g>
      {on && <Glow x={-10} y={-200} r={300} opacity={0.42 * flick} color="#8fd3ff" />}
      <Shadow w={200} />
      {/* stand */}
      <Tube d="M -60 -100 L -76 0 M 60 -100 L 76 0" color={t(C.woodDark)} w={9} />
      <rect x={-84} y={-112} width={168} height={18} rx={5} fill={t(C.wood)} {...OUT} />
      {/* antenna */}
      <path d="M 0 -270 L -50 -340 M 0 -270 L 46 -350" stroke={INK} strokeWidth={4} strokeLinecap="round" />
      <circle cx={-50} cy={-340} r={5} fill={INK} />
      <circle cx={46} cy={-350} r={5} fill={INK} />
      <path d="M -22 -268 C -22 -286, 22 -286, 22 -268 Z" fill={t("#4a4452")} {...OUT} strokeWidth={3} />
      {/* cabinet, curved screen, knobs */}
      <rect x={-112} y={-272} width={224} height={164} rx={22} fill={t("#8a5d3d")} {...OUT} />
      <rect x={-98} y={-258} width={150} height={136} rx={26} fill={t("#2f2a38")} />
      <rect x={-90} y={-250} width={134} height={120} rx={22} fill={scr} />
      <g opacity={0.5}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path key={i} d={`M -80 ${-238 + i * 19} L 34 ${-238 + i * 19}`} stroke={on ? "#ffffff" : t("#e9f4f9")} strokeWidth={2} opacity={0.4} />
        ))}
        {bar > 0 && bar < 112 && <rect x={-88} y={-248 + bar} width={130} height={8} fill="#ffffff" opacity={0.6} />}
      </g>
      <path d="M -72 -238 C -60 -246, -40 -246, -28 -244" fill="none" stroke="#ffffff" strokeWidth={5} strokeLinecap="round" opacity={0.55} />
      <circle cx={82} cy={-226} r={13} fill={t("#d6c2a6")} stroke={INK} strokeWidth={3} />
      <circle cx={82} cy={-186} r={13} fill={t("#d6c2a6")} stroke={INK} strokeWidth={3} />
      <path d="M 82 -226 L 82 -236 M 82 -186 L 90 -192" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      {[0, 1, 2].map((i) => <path key={i} d={`M 68 ${-150 + i * 9} L 96 ${-150 + i * 9}`} stroke={INK} strokeWidth={3} strokeLinecap="round" />)}
    </g>
  ));
}

// ---------------------------------------------------------------- wall

function Painting({ x, wallY, tod }: PlacedArgs) {
  const t = toner(tod);
  return (
    <g transform={`translate(${x} ${wallY})`}>
      <path d="M -30 -84 L 0 -112 L 30 -84" fill="none" stroke={INK} strokeWidth={3} />
      <circle cx={0} cy={-112} r={4} fill={INK} />
      <rect x={-124} y={-88} width={248} height={176} rx={6} fill={t("#d9a441")} {...OUT} />
      <rect x={-106} y={-70} width={212} height={140} fill={t("#a9d4ec")} stroke={t("#a87a26")} strokeWidth={4} />
      <circle cx={52} cy={-30} r={18} fill={t("#ffd166")} />
      <path d="M -104 30 C -60 -10, -20 -6, 10 20 C 40 -4, 80 -14, 104 10 L 104 68 L -104 68 Z" fill={t("#79b06a")} />
      <path d="M -104 50 C -40 26, 40 30, 104 46 L 104 68 L -104 68 Z" fill={t("#5a9259")} />
      <rect x={-58} y={2} width={7} height={26} fill={t(C.woodDark)} />
      <circle cx={-54} cy={-2} r={17} fill={t("#3f7a5c")} />
      <path d="M -10 -44 q 6 -6 12 0 q 6 -6 12 0" fill="none" stroke={t("#4a4452")} strokeWidth={2.5} strokeLinecap="round" />
    </g>
  );
}

function WantedPoster({ x, wallY, tod }: PlacedArgs) {
  const t = toner(tod);
  const paper = t("#f1dfb4");
  const ink = t("#4a3426");
  return (
    <g transform={`translate(${x} ${wallY}) rotate(-3)`}>
      <path d="M -80 -106 L 80 -106 L 80 92 L 64 104 L 48 94 L 30 106 L 12 95 L -6 106 L -24 94 L -42 105 L -60 95 L -80 104 Z" fill={paper} {...OUT} />
      <text x={0} y={-66} textAnchor="middle" fontFamily="Fredoka, sans-serif" fontWeight={700} fontSize={36} fill={ink}>WANTED</text>
      <rect x={-46} y={-54} width={92} height={86} fill={t("#e2c890")} stroke={ink} strokeWidth={3} />
      <circle cx={0} cy={-22} r={20} fill={ink} />
      <path d="M -34 32 C -34 4, 34 4, 34 32 Z" fill={ink} />
      <text x={0} y={-12} textAnchor="middle" fontFamily="Fredoka, sans-serif" fontWeight={700} fontSize={28} fill={paper}>?</text>
      <text x={0} y={56} textAnchor="middle" fontFamily="Fredoka, sans-serif" fontWeight={700} fontSize={17} fill={ink}>REWARD</text>
      <text x={0} y={82} textAnchor="middle" fontFamily="Fredoka, sans-serif" fontWeight={700} fontSize={24} fill={t(C.redDark)}>$5,000</text>
      <circle cx={0} cy={-94} r={6} fill={t(C.red)} stroke={INK} strokeWidth={2.5} />
    </g>
  );
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const CAL_PERIOD = 18; // frames per page
const CAL_FLIP = 9; // frames the turning page takes

function CalendarPage({ m, t }: { m: number; t: T }) {
  const circled = (m * 11 + 9) % 30;
  return (
    <g>
      <rect x={-66} y={-70} width={132} height={150} rx={4} fill={t(PAPER)} {...OUT} strokeWidth={3} />
      <rect x={-66} y={-70} width={132} height={40} rx={4} fill={t(C.red)} stroke={INK} strokeWidth={3} />
      <text x={0} y={-40} textAnchor="middle" fontFamily="Fredoka, sans-serif" fontWeight={700} fontSize={28} fill={t(PAPER)}>{MONTHS[m % 12]}</text>
      {Array.from({ length: 30 }, (_, i) => {
        const cx = -48 + (i % 6) * 19.2;
        const cy = -14 + Math.floor(i / 6) * 19;
        return (
          <g key={i}>
            <rect x={cx - 5} y={cy - 5} width={10} height={10} rx={2} fill={t("#cfc6b6")} />
            {i === circled && <circle cx={cx} cy={cy} r={10} fill="none" stroke={t(C.red)} strokeWidth={3} />}
          </g>
        );
      })}
    </g>
  );
}

function Calendar({ x, wallY, tod, frame }: PlacedArgs) {
  const t = toner(tod);
  const page = Math.floor(frame / CAL_PERIOD);
  const into = frame % CAL_PERIOD;
  const turning = into < CAL_FLIP && frame >= CAL_PERIOD;
  // The turning page is the previous month folding up over the top edge.
  const k = turning ? into / CAL_FLIP : 1;
  const sy = Math.cos(k * Math.PI);
  return (
    <g transform={`translate(${x} ${wallY})`}>
      <path d="M -24 -78 L 0 -100 L 24 -78" fill="none" stroke={INK} strokeWidth={3} />
      <circle cx={0} cy={-100} r={4} fill={INK} />
      <rect x={-62} y={-66} width={132} height={150} rx={4} fill={t("#d8cfbf")} stroke={INK} strokeWidth={3} />
      <CalendarPage m={page} t={t} />
      {turning && (
        <g transform={`translate(0 -70) scale(1 ${f2(sy)}) translate(0 70)`}>
          {sy > 0 ? <CalendarPage m={page - 1} t={t} /> : <rect x={-66} y={-70} width={132} height={150} rx={4} fill={t("#e8dfcd")} {...OUT} strokeWidth={3} />}
        </g>
      )}
      <rect x={-70} y={-78} width={140} height={14} rx={5} fill={t("#4a4452")} {...OUT} strokeWidth={3} />
      {[-40, -14, 14, 40].map((rx) => <circle key={rx} cx={rx} cy={-71} r={3} fill={t("#c3cad2")} />)}
    </g>
  );
}

// ---------------------------------------------------------------- sky

/** Keeps a drifting sky prop inside a band around the frame, wrapping round. */
function wrapX(v: number, pad = 360) {
  const span = W + pad * 2;
  return ((((v + pad) % span) + span) % span) - pad;
}

function Plane({ x, skyY, tod, frame, flip }: PlacedArgs) {
  const t = toner(tod);
  const px = wrapX(x + (flip ? -1 : 1) * frame * 3);
  const py = skyY + Math.sin(frame / 40) * 4;
  const on = lit(tod);
  return place(px, py, flip, (
    <g transform="scale(0.9)">
      <path d="M -116 2 L -260 0" stroke="#ffffff" strokeWidth={6} strokeLinecap="round" opacity={0.35} />
      <path d="M 4 -10 L -34 -40 L -18 -40 L 32 -10 Z" fill={t("#c3cad2")} {...OUT} strokeWidth={3} />
      <path d="M -104 -6 L -136 -56 L -112 -56 L -74 -10 Z" fill={t(C.red)} {...OUT} strokeWidth={3} />
      <path d="M -112 -10 L 96 -14 C 124 -14, 136 0, 128 8 C 120 16, 104 18, 92 18 L -100 18 C -114 16, -122 4, -112 -10 Z" fill={t("#f6f4f0")} {...OUT} strokeWidth={3.5} />
      <path d="M -108 10 L 120 10" stroke={t("#3f6fb5")} strokeWidth={5} />
      {Array.from({ length: 11 }, (_, i) => <circle key={i} cx={-70 + i * 15} cy={-2} r={3.4} fill={on ? ACCENT : t("#4a6a8a")} />)}
      <path d="M 104 -8 L 118 -6 L 120 0 L 104 0 Z" fill={t("#4a6a8a")} />
      <path d="M -4 10 L -46 50 L -26 50 L 34 10 Z" fill={t("#dfe3e8")} {...OUT} strokeWidth={3} />
      <rect x={-8} y={22} width={30} height={12} rx={6} fill={t("#9aa3ad")} stroke={INK} strokeWidth={3} />
      {on && <circle cx={-128} cy={-54} r={4} fill="#ff5a4e" opacity={0.5 + 0.5 * Math.sin(frame / 5)} />}
    </g>
  ));
}

const FLOCK = [
  [0, 0, 1],
  [-56, 26, 0.85],
  [-104, 48, 0.75],
  [-52, -24, 0.9],
  [-100, -44, 0.8],
  [-150, 14, 0.7],
] as const;

function Birds({ x, skyY, tod, frame, flip }: PlacedArgs) {
  const dir = flip ? -1 : 1;
  const bx = wrapX(x + dir * frame * 1.6);
  const color = tod === "night" ? "#0e1226" : INK;
  return (
    <g transform={`translate(${f2(bx)} ${skyY + 40}) scale(${dir} 1)`}>
      {FLOCK.map(([dx, dy, s], i) => {
        const flap = Math.sin(frame * 0.42 + i * 1.3);
        const ty = -14 * flap;
        const w = 24;
        const by = dy + Math.sin(frame / 18 + i) * 4;
        return (
          <path
            key={i}
            transform={`translate(${dx} ${f2(by)}) scale(${s})`}
            d={`M ${-w} ${f2(ty)} Q ${-w * 0.45} ${f2(ty * 0.3 - 6)} 0 4 Q ${w * 0.45} ${f2(ty * 0.3 - 6)} ${w} ${f2(ty)}`}
            fill="none"
            stroke={color}
            strokeWidth={4.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------- sign

function Sign({ x, groundY, tod, flip }: PlacedArgs) {
  const t = toner(tod);
  return place(x, groundY, flip, (
    <g>
      <Shadow w={90} />
      <rect x={-11} y={-318} width={22} height={318} rx={4} fill={t(C.woodDark)} {...OUT} />
      <path d="M -44 -296 L 104 -296 L 136 -270 L 104 -244 L -44 -244 Z" fill={t(C.woodLight)} {...OUT} />
      <path d="M -30 -278 L 70 -278 M -20 -262 L 90 -262" stroke={t(C.wood)} strokeWidth={3} strokeLinecap="round" />
      <path d="M 44 -226 L -104 -226 L -136 -200 L -104 -174 L 44 -174 Z" fill={t(C.wood)} {...OUT} />
      <path d="M 30 -208 L -70 -208 M 20 -192 L -90 -192" stroke={t(C.woodDark)} strokeWidth={3} strokeLinecap="round" />
      <circle cx={0} cy={-270} r={4} fill={INK} />
      <circle cx={0} cy={-200} r={4} fill={INK} />
      <path d="M -22 0 C -20 -14, -14 -20, -8 -22 M 12 0 C 14 -12, 20 -18, 26 -18" fill="none" stroke={t(C.grassDark)} strokeWidth={5} strokeLinecap="round" />
    </g>
  ));
}

// ---------------------------------------------------------------- registry

export const PLACED_PROPS = {
  door: { placed: Door },
  car: {
    placed: ({ x, groundY, tod, flip }) => place(x, groundY, flip, <CarBody x={x} tod={tod} flip={flip} interior />),
    front: ({ x, groundY, tod, flip }) => place(x, groundY, flip, <CarBody x={x} tod={tod} flip={flip} interior={false} />),
    vehicle: true,
    seat: 72,
  },
  sign: { placed: Sign },
  fire: { placed: Fire },
  table: { placed: Table, besideSeat: true },
  desk: { placed: Desk, besideSeat: true },
  chair: { placed: Chair, seat: 92 },
  stool: { placed: Stool, seat: 120 },
  bench: { placed: Bench, seat: 84 },
  sofa: { placed: Sofa, seat: 80 },
  crate: { placed: Crate, seat: 88 },
  rock: { placed: Rock, seat: 100 },
  plant: { placed: Plant },
  trash_can: { placed: TrashCan },
  bicycle: { placed: Bicycle },
  tent: { placed: Tent },
  ladder: { placed: Ladder },
  treasure_chest: { placed: TreasureChest },
  tv: { placed: Tv },
  painting: { placed: Painting },
  wanted_poster: { placed: WantedPoster },
  calendar: { placed: Calendar },
  plane: { placed: Plane },
  birds: { placed: Birds },
} satisfies Record<string, PropImpl>;
