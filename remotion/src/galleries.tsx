import { ACTIONS, BACKGROUNDS, EXPRESSIONS, GRADES, HATS, type ActionId, type BackgroundId, type CastMember, type ExpressionId, type GradeId, type HatId } from "@studio/schema";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { ACTION_LIB } from "./library/actions";
import { BACKGROUND_LIB } from "./library/backgrounds";
import { GRADE_LIB, GradeOverlay } from "./library/grades";
import { alive, blink } from "./rig/animate";
import { Figure } from "./rig/Figure";
import { C, H, INK, PAPER, W, hash01 } from "./theme";

/** Library previews for Remotion Studio: judge the look of every item at a glance. */

const label: React.CSSProperties = { fontFamily: "Fredoka, sans-serif", fontWeight: 700, color: INK, fontSize: 30 };
const CAST = (hat: HatId, color: string, beard = false): CastMember => ({ name: "", hat, color, beard, scale: 1 });

function Cell({ x, y, w, h, title, children }: { x: number; y: number; w: number; h: number; title: string; children: React.ReactNode }) {
  return (
    <svg x={x} y={y} width={w} height={h} overflow="hidden">
      <rect x={6} y={6} width={w - 12} height={h - 12} rx={18} fill="#fffaf0" stroke={C.wallShade} strokeWidth={3} />
      <path d={`M 30 ${h - 50} L ${w - 30} ${h - 50}`} stroke={C.wallShade} strokeWidth={4} strokeLinecap="round" />
      {children}
      <rect x={w / 2 - 110} y={h - 46} width={220} height={36} rx={10} fill="#fffaf0" />
      <text x={w / 2} y={h - 18} textAnchor="middle" style={{ ...label, fontSize: 26 }} fill={INK}>{title}</text>
    </svg>
  );
}

export function ActionGallery() {
  const frame = useCurrentFrame();
  const ids = Object.keys(ACTIONS) as ActionId[];
  const cols = 5;
  const w = W / cols;
  const h = H / Math.ceil(ids.length / cols);
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        {ids.map((id, i) => {
          const def = ACTION_LIB[id];
          const phase = hash01(id);
          const f = def.loop ? frame : frame % (def.frames + 45);
          const { pose, breath } = alive(def, f, phase);
          const prev = alive(def, f - 1, phase).pose;
          const x = (i % cols) * w;
          const y = Math.floor(i / cols) * h;
          return (
            <Cell key={id} x={x} y={y} w={w} h={h} title={id}>
              <g transform={`translate(${w / 2} ${h - 52}) scale(0.56)`}>
                <Figure
                  pose={pose} prevPose={prev} breath={breath} x={0} groundY={0} facing={1}
                  cast={CAST(id === "sneak" ? "beanie" : "keeper_cap", "#d0473d", id !== "sneak")}
                  expr={def.face ?? (id === "panic" ? "fear" : id === "celebrate" ? "happy" : id === "argue" ? "angry" : "neutral")}
                  silhouette={false} blink={blink(frame, phase)} tod="day" frame={frame}
                  attachments={id === "walk" ? [{ point: "hand_r", prop: "lantern" }] : []} fx={def.fx}
                />
              </g>
            </Cell>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
}

export function ExpressionGallery() {
  const frame = useCurrentFrame();
  const ids = Object.keys(EXPRESSIONS) as ExpressionId[];
  const hats = Object.keys(HATS) as HatId[];
  const colors = ["#d0473d", "#2f9e8f", "#e0a24e", "#5b6bd6"];
  const cols = 5;
  const w = W / cols;
  const h = H / 2;
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        {ids.map((id, i) => {
          const phase = hash01(id);
          const { pose, breath } = alive(ACTION_LIB.idle, frame, phase);
          const x = (i % cols) * w;
          const y = Math.floor(i / cols) * h;
          return (
            <Cell key={id} x={x} y={y} w={w} h={h} title={id}>
              <g transform={`translate(${w / 2 - 14} ${h + 150}) scale(1.25)`}>
                <Figure
                  pose={{ ...pose, gaze: 0.6 }} prevPose={pose} breath={breath} x={0} groundY={0} facing={1}
                  cast={CAST(hats[i % hats.length]!, colors[i % colors.length]!, i % 3 === 0)}
                  expr={id} silhouette={false} blink={0} tod="day" frame={frame} attachments={[]}
                />
              </g>
            </Cell>
          );
        })}
        <Cell x={4 * w} y={h} w={w} h={h} title="silhouette">
          <g transform={`translate(${w / 2 - 14} ${h + 150}) scale(1.25)`}>
            <Figure
              pose={alive(ACTION_LIB.idle, frame, 0.3).pose} prevPose={alive(ACTION_LIB.idle, frame, 0.3).pose} breath={1} x={0} groundY={0} facing={1}
              cast={CAST("keeper_cap", "#d0473d", true)} expr="neutral" silhouette blink={0} tod="day" frame={frame} attachments={[]}
            />
          </g>
        </Cell>
      </svg>
    </AbsoluteFill>
  );
}

const BG_SECONDS = 2;
export const BG_COMBOS: { bg: BackgroundId; grade: GradeId }[] = (Object.keys(BACKGROUNDS) as BackgroundId[]).flatMap((bg) =>
  (Object.keys(GRADES) as GradeId[]).map((grade) => ({ bg, grade })),
);
export const BG_GALLERY_FRAMES = BG_COMBOS.length * BG_SECONDS * 30;

function BackgroundCard({ bg, grade }: { bg: BackgroundId; grade: GradeId }) {
  const frame = useCurrentFrame();
  const def = BACKGROUND_LIB[bg];
  const tod = GRADE_LIB[grade].tod;
  return (
    <AbsoluteFill>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        <def.Back tod={tod} frame={frame} />
        {def.Front && <def.Front tod={tod} frame={frame} />}
      </svg>
      <GradeOverlay grade={grade} />
      <div style={{ ...label, position: "absolute", left: 40, top: 32, background: PAPER, padding: "8px 18px", borderRadius: 12 }}>
        {bg} · {grade}
      </div>
    </AbsoluteFill>
  );
}

export function BackgroundGallery() {
  return (
    <AbsoluteFill>
      {BG_COMBOS.map((c, i) => (
        <Sequence key={`${c.bg}-${c.grade}`} from={i * BG_SECONDS * 30} durationInFrames={BG_SECONDS * 30}>
          <BackgroundCard {...c} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
