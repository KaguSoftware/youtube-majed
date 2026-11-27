import { random } from "remotion";
import { Layer } from "../camera";
import { Glow, OutdoorSky, X0, X1, Y1, lit, t, type BgProps } from "./common";

/** Flat city rooftop: low ledge, water tower, vents, a skyline that lights up at night. */
const GROUND = 885;
const HORIZON = 620;
const LEDGE = 745;
const WARM = "#ffd98a";

type Tone = (hex: string) => string;

function Skyline({ seed, n, base, hMin, hMax, color, win, c, on, frame, spires, share }: {
  seed: string; n: number; base: number; hMin: number; hMax: number; color: string; win: number; c: Tone; on: boolean; frame: number; spires?: boolean; share: number;
}) {
  const step = (X1 - X0) / n;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const w = step * (0.75 + random(`${seed}w${i}`) * 0.5);
        const x = X0 + i * step + random(`${seed}x${i}`) * step * 0.3 - w * 0.1;
        const h = hMin + random(`${seed}h${i}`) * (hMax - hMin);
        const top = base - h;
        const cols = Math.max(2, Math.floor((w - 20) / (win * 2)));
        const rows = Math.floor((h - 30) / (win * 2.2));
        const mast = spires && random(`${seed}m${i}`) > 0.6;
        return (
          <g key={i}>
            <rect x={x} y={top} width={w} height={h + 200} fill={c(color)} />
            {random(`${seed}r${i}`) > 0.5 && <rect x={x + w * 0.2} y={top - 24} width={w * 0.6} height={24} fill={c(color)} />}
            {mast && <rect x={x + w / 2 - 3} y={top - 110} width={6} height={110} fill={c(color)} />}
            {mast && <circle cx={x + w / 2} cy={top - 112} r={6} fill={Math.sin(frame * 0.15 + i) > 0 ? "#ff4a3d" : c(color)} />}
            {Array.from({ length: cols * rows }, (_, k) => {
              const cx = k % cols;
              const cy = Math.floor(k / cols);
              const r = random(`${seed}win${i}-${k}`);
              const glow = on && r > 1 - share && !(r > 0.97 && Math.sin(frame * 0.1 + k) > 0.6);
              return (
                <rect key={k} x={x + 14 + cx * ((w - 28) / cols)} y={top + 20 + cy * win * 2.2} width={win} height={win * 1.3}
                  fill={glow ? (r > 1 - share * 0.2 ? "#bfe6ff" : WARM) : c("#c9d6e6")} opacity={glow ? 0.9 : 0.25} />
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

function WaterTower({ c, on }: { c: Tone; on: boolean }) {
  const wood = c("#8d6b4f");
  const steel = c("#4d5560");
  return (
    <g transform="translate(1720 0)">
      {[-90, -30, 30, 90].map((x) => (
        <path key={x} d={`M ${x * 0.85} 600 L ${x} ${GROUND - 20}`} stroke={steel} strokeWidth={12} />
      ))}
      <path d={`M -80 690 L 80 690 M -86 780 L 86 780 M -76 690 L 82 780 M 76 690 L -82 780`} stroke={steel} strokeWidth={6} />
      <rect x={-110} y={600} width={220} height={18} fill={steel} />
      <path d="M -105 600 L -112 400 L 112 400 L 105 600 Z" fill={wood} />
      {[-70, -35, 0, 35, 70].map((x) => <path key={x} d={`M ${x} 404 L ${x * 0.97} 598`} stroke={c("#7a5b42")} strokeWidth={4} />)}
      {[450, 530].map((y) => <rect key={y} x={-113} y={y} width={226} height={9} fill={steel} />)}
      <path d="M -126 404 L 0 300 L 126 404 Z" fill={c("#6a5140")} />
      <path d="M -126 404 L 126 404 L 120 414 L -120 414 Z" fill={steel} />
      <path d="M 70 620 L 70 860 M 96 620 L 96 860" stroke={steel} strokeWidth={5} />
      {[650, 690, 730, 770, 810, 850].map((y) => <path key={y} d={`M 70 ${y} L 96 ${y}`} stroke={steel} strokeWidth={4} />)}
      {on && <Glow x={-130} y={640} r={260} opacity={0.45} />}
      <rect x={-140} y={628} width={20} height={26} rx={6} fill={on ? WARM : c("#e6dcc0")} />
    </g>
  );
}

function Back({ tod, frame }: BgProps) {
  const c = t(tod);
  const on = lit(tod);
  const span = X1 - X0;
  const planeX = ((frame * 2.4) % span) + X0;
  const spin = frame * 8;
  return (
    <g>
      <OutdoorSky tod={tod} frame={frame} horizon={HORIZON} sunX={1300} />
      {tod === "night" && (
        <Layer depth={0.1}>
          <circle cx={planeX} cy={150} r={4} fill={frame % 20 < 4 ? "#ff6b5b" : "#fff8e1"} />
        </Layer>
      )}
      <Layer depth={0.2}>
        {on && <Glow x={960} y={HORIZON + 80} r={1100} opacity={0.22} color="#ff9f6b" />}
        <Skyline seed="far" n={20} base={LEDGE + 20} hMin={190} hMax={380} color="#a8b5c9" win={9} c={c} on={on} frame={frame} share={0.5} />
      </Layer>
      <Layer depth={0.38}>
        <Skyline seed="mid" n={11} base={LEDGE + 40} hMin={150} hMax={360} color="#7f8daa" win={13} c={c} on={on} frame={frame} spires share={0.32} />
      </Layer>
      <Layer depth={0.9}>
        <rect x={X0} y={LEDGE} width={span} height={GROUND - LEDGE} fill={c("#aca69c")} />
        <rect x={X0} y={LEDGE - 14} width={span} height={20} fill={c("#cbc5b9")} />
        {Array.from({ length: 18 }, (_, i) => (
          <rect key={i} x={X0 + i * 150} y={LEDGE + 6} width={4} height={GROUND - LEDGE} fill={c("#9a948a")} />
        ))}
        <rect x={X0} y={LEDGE + 6} width={span} height={12} fill={c("#8f897f")} opacity={0.6} />
      </Layer>
      <Layer depth={1}>
        <rect x={X0} y={GROUND - 40} width={span} height={Y1 - GROUND + 40} fill={c("#97938b")} />
        {[930, 1010, 1110].map((y) => <path key={y} d={`M ${X0} ${y} L ${X1} ${y}`} stroke={c("#86827a")} strokeWidth={5} />)}
        {Array.from({ length: 50 }, (_, i) => (
          <circle key={i} cx={X0 + random(`gv${i}`) * span} cy={GROUND - 20 + random(`gvy${i}`) * 240} r={2 + random(`gvr${i}`) * 3} fill={c("#7d7970")} />
        ))}
        <g>
          <rect x={-120} y={700} width={420} height={GROUND - 690} rx={8} fill={c("#c2c6c8")} />
          <rect x={250} y={700} width={50} height={GROUND - 690} fill={c("#a8adb0")} />
          {[730, 750, 770, 790].map((y) => <rect key={y} x={-100} y={y} width={120} height={8} rx={3} fill={c("#9aa0a4")} />)}
          <circle cx={150} cy={790} r={70} fill={c("#8d9397")} />
          <g transform={`rotate(${spin} 150 790)`} fill={c("#5f666b")}>
            {[0, 120, 240].map((a) => <path key={a} d="M 150 790 Q 175 750 150 728 Q 135 760 150 790 Z" transform={`rotate(${a} 150 790)`} />)}
          </g>
          <circle cx={150} cy={790} r={70} fill="none" stroke={c("#5f666b")} strokeWidth={6} />
          <path d={`M 0 700 L 0 640 Q 0 610 30 610 L 120 610`} stroke={c("#8d9397")} strokeWidth={22} fill="none" />
        </g>
        <g transform="translate(900 0)">
          <rect x={-10} y={GROUND - 110} width={20} height={80} fill={c("#8d9397")} />
          <path d={`M -42 ${GROUND - 104} Q 0 ${GROUND - 150} 42 ${GROUND - 104} Z`} fill={c("#a8adb0")} />
        </g>
        <g transform="translate(1100 0)">
          <rect x={-12} y={GROUND - 90} width={24} height={60} fill={c("#8d9397")} />
          <ellipse cx={0} cy={GROUND - 110} rx={36} ry={30} fill={c("#b7bcbf")} />
          {[-1, 0, 1].map((k) => (
            <path key={k} d={`M ${k * 16 + Math.sin(frame * 0.3 + k) * 4} ${GROUND - 138} L ${k * 16 + Math.sin(frame * 0.3 + k) * 4} ${GROUND - 82}`} stroke={c("#8d9397")} strokeWidth={4} />
          ))}
        </g>
        <WaterTower c={c} on={on} />
      </Layer>
    </g>
  );
}

export const rooftop = { groundY: GROUND, horizonY: HORIZON, wallY: 380, Back };
