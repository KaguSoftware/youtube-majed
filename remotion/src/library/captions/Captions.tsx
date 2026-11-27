import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Chunk } from "../../scene/timeline";
import { SAFE_WIDTH, isPortrait, useView } from "../../scene/view";
import { ACCENT, INK } from "../../theme";
import { captionBox, wordRow } from "./box";
import { WordPop } from "./WordPop";

/**
 * Caption styles. Each scene picks one (`caption`); the timeline cuts its
 * words into chunks sized for that style. All styles stay above SAFE_BOTTOM.
 */

const font: React.CSSProperties = { fontFamily: "Fredoka, sans-serif", fontWeight: 700, lineHeight: 1, whiteSpace: "nowrap" };

/** "karaoke": a whole line; spoken words light up, the current one bounces. */
function Karaoke({ chunk }: { chunk: Chunk }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - chunk.start, fps, config: { damping: 16, stiffness: 200 } });
  const portrait = isPortrait(useView());
  return (
    <AbsoluteFill style={captionBox(portrait)}>
      <div style={{ ...wordRow(portrait, 20), transform: `translateY(${(1 - enter) * 30}px)`, opacity: enter }}>
        {chunk.words.map((w, i) => {
          const said = frame >= w.start;
          const now = said && frame < w.end;
          const bump = now ? spring({ frame: frame - w.start, fps, config: { damping: 9, stiffness: 300, mass: 0.4 } }) : 0;
          return (
            <span
              key={i}
              style={{
                ...font,
                fontSize: portrait ? 78 : 72,
                color: said ? ACCENT : "#ffffff",
                WebkitTextStroke: `12px ${INK}`,
                paintOrder: "stroke fill",
                filter: "drop-shadow(0 6px 0 rgba(0,0,0,0.28))",
                transform: `translateY(${-bump * 10}px)`,
                display: "inline-block",
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

/** "subtitle": quiet sentence-case text in a dark rounded box. */
function Subtitle({ chunk }: { chunk: Chunk }) {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [chunk.start, chunk.start + 4, chunk.end - 3, chunk.end], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const portrait = isPortrait(useView());
  return (
    <AbsoluteFill style={captionBox(portrait, 10)}>
      <div style={{ ...font, ...(portrait ? { whiteSpace: "normal", textAlign: "center", maxWidth: SAFE_WIDTH, lineHeight: 1.18 } : {}), fontSize: portrait ? 52 : 50, color: "#ffffff", background: "rgba(16,14,30,0.72)", padding: "14px 30px 18px", borderRadius: 16, opacity: o, letterSpacing: 0.4 }}>
        {chunk.words.map((w) => w.text).join(" ")}
      </div>
    </AbsoluteFill>
  );
}

/** "punch": one huge word slammed in low in the frame (clear of faces in close-ups). */
function Punch({ chunk }: { chunk: Chunk }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const w = chunk.words[0]!;
  const slam = spring({ frame: frame - w.start, fps, config: { damping: 10, stiffness: 320, mass: 0.6 } });
  const scale = interpolate(slam, [0, 1], [2.4, 1]);
  const portrait = isPortrait(useView());
  return (
    <AbsoluteFill style={captionBox(portrait, 40)}>
      <span
        style={{
          ...font,
          fontSize: portrait ? 140 : 190,
          color: ACCENT,
          WebkitTextStroke: `${portrait ? 18 : 22}px ${INK}`,
          paintOrder: "stroke fill",
          filter: "drop-shadow(0 12px 0 rgba(0,0,0,0.3))",
          transform: `scale(${scale}) rotate(${(1 - slam) * -8 - 3}deg)`,
          opacity: Math.min(1, slam * 3),
          textTransform: "uppercase",
          display: "inline-block",
        }}
      >
        {w.text.replace(/[,.;:]$/, "")}
      </span>
    </AbsoluteFill>
  );
}

export function Captions({ chunks }: { chunks: Chunk[] }) {
  const frame = useCurrentFrame();
  const chunk = chunks.find((c) => frame >= c.start && frame < c.end);
  if (!chunk) return null;
  if (chunk.style === "word_pop") return <WordPop chunks={[chunk]} />;
  if (chunk.style === "karaoke") return <Karaoke chunk={chunk} />;
  if (chunk.style === "subtitle") return <Subtitle chunk={chunk} />;
  return <Punch chunk={chunk} />;
}

