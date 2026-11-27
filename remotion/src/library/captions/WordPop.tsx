import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Chunk } from "../../scene/timeline";
import { isPortrait, useView } from "../../scene/view";
import { ACCENT, INK } from "../../theme";
import { captionBox, wordRow } from "./box";

/**
 * Caption style "word_pop": 1–3 big words at a time, each popping in as it is
 * spoken; the word being spoken is highlighted.
 */
export function WordPop({ chunks }: { chunks: Chunk[] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const portrait = isPortrait(useView());
  const chunk = chunks.find((c) => frame >= c.start && frame < c.end);
  if (!chunk) return null;
  const base = portrait ? { ...baseStyle, fontSize: 84, WebkitTextStroke: `13px ${INK}` } : baseStyle;

  return (
    <AbsoluteFill style={captionBox(portrait)}>
      <div style={wordRow(portrait, 26)}>
        {chunk.words.map((w, i) => {
          if (frame < w.start) return <span key={i} style={{ ...base, opacity: 0 }}>{w.text}</span>;
          const pop = spring({ frame: frame - w.start, fps, config: { damping: 11, stiffness: 260, mass: 0.55 } });
          const active = frame < w.end;
          const scale = 0.55 + 0.45 * pop + (active ? 0.06 : 0);
          return (
            <span
              key={i}
              style={{
                ...base,
                color: active ? ACCENT : "#ffffff",
                transform: `translateY(${(1 - pop) * 26}px) scale(${scale}) rotate(${active ? -2 : 0}deg)`,
                opacity: Math.min(1, (frame - w.start + 1) / 3),
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

const baseStyle: React.CSSProperties = {
  display: "inline-block",
  fontFamily: "Fredoka, sans-serif",
  fontWeight: 700,
  fontSize: 88,
  lineHeight: 1,
  letterSpacing: 0.5,
  WebkitTextStroke: `14px ${INK}`,
  paintOrder: "stroke fill",
  filter: "drop-shadow(0 7px 0 rgba(0,0,0,0.28))",
  transformOrigin: "50% 80%",
  whiteSpace: "nowrap",
};
