"use client";
import type { PlayerRef } from "@remotion/player";
import { Flag, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import type { Timeline as TimelineData } from "@/lib/editor";
import { loopOf, sceneFrame, wordTime, type Selection } from "./model";

export const ZOOMS = [4, 8, 16, 32, 64, 128] as const;
const LABEL_W = 88;

export function timecode(frame: number, fps: number): string {
  const s = Math.floor(frame / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${String(Math.floor(frame % fps)).padStart(2, "0")}`;
}

const HATCH = { background: "repeating-linear-gradient(135deg, var(--color-caution) 0 3px, transparent 3px 6px)" };

type Props = {
  t: TimelineData;
  selection: Selection;
  onSelect: (s: Selection, frame?: number) => void;
  onSeek: (frame: number) => void;
  playerRef: RefObject<PlayerRef | null>;
  /** changes when the Player is mounted again (draft ⇄ render), so the playhead re-subscribes */
  playerKey: string;
  flagged: ReadonlySet<string>;
  editing: string | null;
  zoom: number;
  onZoom: (z: number) => void;
};

/**
 * Four tracks on one clock: scenes, voice lines (and their words when zoomed
 * in), sound effects, music and ambience. The playhead follows the Player
 * frame by frame without re-rendering the tracks. Inside a track, ←/→ move
 * between its items, Home/End jump to the ends; Enter keeps the selection and
 * moves on to the inspector.
 */
export function Timeline({ t, selection, onSelect, onSeek, playerRef, playerKey, flagged, editing, zoom, onZoom }: Props) {
  const fps = t.fps;
  const seconds = t.frames / fps;
  const width = Math.max(1, Math.ceil(seconds * zoom));
  const x = useCallback((s: number) => s * zoom, [zoom]);
  const scroller = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const frameRef = useRef(0);

  // the playhead: moved by transform on every frame the Player reports, never through React state
  const place = useCallback(
    (frame: number, follow: boolean) => {
      frameRef.current = frame;
      const px = (frame / fps) * zoom;
      if (head.current) head.current.style.transform = `translateX(${px}px)`;
      if (clock.current) clock.current.textContent = timecode(frame, fps);
      const sc = scroller.current;
      if (follow && sc && (px < sc.scrollLeft || px > sc.scrollLeft + sc.clientWidth - 48)) sc.scrollLeft = Math.max(0, px - 96);
    },
    [fps, zoom],
  );
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    place(p.getCurrentFrame(), false);
    const onFrame = (e: { detail: { frame: number } }) => place(e.detail.frame, p.isPlaying());
    const onSeeked = (e: { detail: { frame: number } }) => place(e.detail.frame, true);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("seeked", onSeeked);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("seeked", onSeeked);
    };
  }, [playerRef, playerKey, place]);
  // keep the playhead under the same frame when zooming
  useEffect(() => place(frameRef.current, true), [zoom, place]);

  // scrub on the ruler (and on empty track space)
  const scrubbing = useRef(false);
  const frameAt = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(t.frames - 1, Math.round(((e.clientX - r.left) / zoom) * fps)));
  };
  const scrub = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      scrubbing.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      onSeek(frameAt(e));
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => scrubbing.current && onSeek(frameAt(e)),
    onPointerUp: () => void (scrubbing.current = false),
  };

  const step = zoom >= 64 ? 1 : zoom >= 32 ? 2 : zoom >= 16 ? 5 : zoom >= 8 ? 10 : 30;
  const ticks = useMemo(() => Array.from({ length: Math.floor(seconds / step) + 1 }, (_, i) => i * step), [seconds, step]);
  const loops = useMemo(() => t.scenes.filter((s, i) => i === 0 || loopOf(s.lineIds[0]!) !== loopOf(t.scenes[i - 1]!.lineIds[0]!)).map((s) => ({ loop: loopOf(s.lineIds[0]!), at: s.start / fps })), [t, fps]);
  const userSfx = useMemo(() => t.scenes.flatMap((s) => s.sfx.map((c) => ({ scene: s.id, ...c, time: wordTime(t, c.at) }))).filter((c) => c.time !== undefined) as { scene: string; tag: string; at: string; time: number }[], [t]);
  const ruleCues = t.cues.filter((c) => c.kind === "riser" || c.kind === "hit" || c.kind === "whoosh");
  const beds = t.cues.filter((c) => c.kind === "music" || c.kind === "ambience");
  const showWords = zoom >= 64;

  const sel = (kind: string, id: string) => selection?.kind === kind && (selection.kind === "sfx" ? `${selection.scene}/${selection.tag}/${selection.at}` : selection.id) === id;
  const lineSelected = selection?.kind === "line" ? selection.id : null;

  return (
    <section aria-labelledby="timeline-h" className="select-none">
      <div className="flex items-center justify-between gap-4 pb-2">
        <h2 id="timeline-h" className="flex items-baseline gap-3">
          <span className="eyebrow text-faint">Timeline</span>
          <span ref={clock} className="tabular text-sm font-semibold text-text" aria-label="Playhead">
            {timecode(0, fps)}
          </span>
          <span className="tabular text-sm text-faint">of {timecode(t.frames, fps)}</span>
        </h2>
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="hidden items-center gap-1.5 md:inline-flex">
            <span aria-hidden className="inline-block h-2 w-5 rounded-sm" style={HATCH} /> needs drawing
          </span>
          <span className="hidden items-center gap-1.5 md:inline-flex">
            <Flag aria-hidden size={12} className="text-caution" /> flagged
          </span>
          <div className="flex items-center gap-1" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={zoom <= ZOOMS[0]} onClick={() => onZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom as never) - 1)]!)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-lifted hover:text-text disabled:opacity-40">
              <Minus aria-hidden size={14} />
            </button>
            <span className="tabular w-14 text-center">{zoom} px/s</span>
            <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={zoom >= ZOOMS.at(-1)!} onClick={() => onZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom as never) + 1)]!)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-lifted hover:text-text disabled:opacity-40">
              <Plus aria-hidden size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex overflow-hidden rounded-lg bg-raised ring-1 ring-hairline">
        <div className="shrink-0 border-r border-hairline text-xs font-semibold text-muted" style={{ width: LABEL_W }} aria-hidden>
          <div className="h-7 border-b border-hairline" />
          <div className="flex h-16 items-center px-3">Scenes</div>
          <div className={`flex items-center px-3 ${showWords ? "h-20" : "h-12"}`}>Voice</div>
          <div className="flex h-9 items-center px-3">Effects</div>
          <div className="flex h-10 items-center px-3">Music</div>
        </div>

        <div ref={scroller} className="relative min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-color:var(--color-edge)_transparent]">
          <div className="relative" style={{ width }}>
            {/* ruler */}
            <div className="relative h-7 cursor-ew-resize border-b border-hairline" {...scrub}>
              {ticks.map((s) => (
                <span key={s} className="pointer-events-none absolute top-0 h-full border-l border-hairline pl-1 pt-1 text-[11px] leading-none text-faint tabular" style={{ left: x(s) }}>
                  {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
                </span>
              ))}
              {loops.map((l) => (
                <span key={l.loop} className="pointer-events-none absolute bottom-0.5 rounded-sm bg-lifted px-1 text-[10px] font-semibold leading-tight text-muted" style={{ left: x(l.at) + 2 }}>
                  {l.loop}
                </span>
              ))}
            </div>

            {/* scenes */}
            <Track label="Scenes" className="h-16" scrub={scrub}>
              {t.scenes.map((s, i) => {
                const w = x(s.frames / fps);
                const on = sel("scene", s.id);
                const dirty = !s.drawn.preview;
                const c = s.chars[0];
                return (
                  <button
                    key={s.id}
                    type="button"
                    data-item
                    data-index={i}
                    tabIndex={on || (selection?.kind !== "scene" && i === 0) ? 0 : -1}
                    onClick={() => onSelect({ kind: "scene", id: s.id }, sceneFrame(s))}
                    aria-pressed={on}
                    aria-label={`${s.id}, ${s.bg}${c ? `, ${c.id} ${c.action}` : ""}, lines ${s.lineIds.join(" ")}${dirty ? ", needs drawing" : ""}${flagged.has(s.id) ? ", flagged" : ""}`}
                    className={`group absolute inset-y-1.5 overflow-hidden rounded-[5px] px-1.5 pt-2 text-left transition-colors duration-150 ${on ? "z-10 bg-lifted ring-2 ring-accent" : "bg-room ring-1 ring-inset ring-hairline hover:bg-lifted"} ${editing === s.id ? "outline-dashed outline-1 outline-offset-2 outline-accent" : ""}`}
                    style={{ left: x(s.start / fps) + 1, width: Math.max(2, w - 2) }}
                  >
                    {dirty && <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={HATCH} />}
                    {w > 30 && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold leading-none text-text tabular">
                        {s.id}
                        {flagged.has(s.id) && <Flag aria-hidden size={10} className="shrink-0 text-caution" />}
                      </span>
                    )}
                    {w > 64 && <span className="mt-1 block truncate text-[11px] leading-tight text-muted">{s.bg.replaceAll("_", " ")}</span>}
                    {w > 64 && c && <span className="block truncate text-[11px] leading-tight text-faint">{c.action.replaceAll("_", " ")}</span>}
                  </button>
                );
              })}
            </Track>

            {/* voice */}
            <Track label="Voice lines" className={showWords ? "h-20" : "h-12"} scrub={scrub}>
              {t.lines.map((l, i) => {
                const w = x(l.duration);
                const on = lineSelected === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    data-item
                    data-index={i}
                    tabIndex={on || (selection?.kind !== "line" && i === 0) ? 0 : -1}
                    onClick={() => onSelect({ kind: "line", id: l.id }, Math.round(l.offset * fps))}
                    aria-pressed={on}
                    aria-label={`${l.id}: ${l.text}${l.fx.length ? `, voice effect ${l.fx.map((f) => f.preset).join(", ")}` : ""}`}
                    title={`${l.id} · energy ${l.energy} · ${l.text}`}
                    className={`absolute top-1.5 h-8 overflow-hidden rounded-[5px] px-1.5 text-left transition-colors duration-150 ${on ? "z-10 bg-lifted ring-2 ring-accent" : "bg-room ring-1 ring-inset ring-hairline hover:bg-lifted"}`}
                    style={{ left: x(l.offset), width: Math.max(2, w - 1) }}
                  >
                    {w > 28 && (
                      <span className="flex items-center gap-1 pt-1 text-[11px] leading-none">
                        <span className="font-semibold text-text tabular">{l.id}</span>
                        {l.fx.length > 0 && <span className="rounded-sm bg-accent/15 px-0.5 text-[10px] font-semibold text-accent">fx</span>}
                      </span>
                    )}
                    {w > 70 && <span className="block truncate text-[11px] leading-snug text-muted">{l.text}</span>}
                  </button>
                );
              })}
              {showWords &&
                t.lines.flatMap((l) =>
                  l.words.map((wd, j) => {
                    const on = selection?.kind === "line" && selection.id === l.id && selection.word === j;
                    const fx = l.fx.some((f) => f.word === j);
                    return (
                      <button
                        key={`${l.id}:${j}`}
                        type="button"
                        tabIndex={-1}
                        onClick={() => onSelect({ kind: "line", id: l.id, word: j }, Math.round(wd.start * fps))}
                        aria-label={`Word ${j + 1} of ${l.id}: ${wd.text}`}
                        className={`absolute top-11 h-6 overflow-hidden whitespace-nowrap rounded-sm px-0.5 text-[11px] leading-6 ${on ? "z-10 bg-accent text-accent-ink" : fx ? "bg-accent/15 text-accent" : "text-muted hover:bg-lifted hover:text-text"}`}
                        style={{ left: x(wd.start), width: Math.max(4, x(wd.end - wd.start)) }}
                      >
                        {wd.text}
                      </button>
                    );
                  }),
                )}
            </Track>

            {/* effects: yours (on words, editable) and the mix rules' (risers, hits, whooshes) */}
            <Track label="Sound effects" className="h-9" scrub={scrub}>
              {ruleCues.map((c) => (
                <span key={c.id} title={c.reason} className="pointer-events-none absolute top-2 h-5 rounded-sm bg-lifted/70" style={{ left: x(c.start), width: Math.max(3, x(Math.min(c.length, 3))) }} />
              ))}
              {userSfx.map((c, i) => {
                const key = `${c.scene}/${c.tag}/${c.at}`;
                const on = sel("sfx", key);
                return (
                  <button
                    key={key}
                    type="button"
                    data-item
                    data-index={i}
                    tabIndex={on || (selection?.kind !== "sfx" && i === 0) ? 0 : -1}
                    onClick={() => onSelect({ kind: "sfx", scene: c.scene, tag: c.tag, at: c.at }, Math.round(c.time * fps))}
                    aria-pressed={on}
                    aria-label={`Sound effect ${c.tag} on ${c.at}`}
                    className={`absolute top-1.5 flex h-6 items-center gap-1 whitespace-nowrap rounded-full pl-1 pr-2 text-[11px] font-semibold transition-colors duration-150 ${on ? "z-10 bg-accent text-accent-ink" : "bg-room text-text ring-1 ring-inset ring-edge hover:bg-lifted"}`}
                    style={{ left: x(c.time) - 4 }}
                  >
                    <span aria-hidden className={`size-2 rotate-45 ${on ? "bg-accent-ink" : "bg-accent"}`} />
                    {zoom >= 8 && c.tag.replaceAll("_", " ")}
                  </button>
                );
              })}
            </Track>

            {/* music and ambience: placed by the mix rules, shown for timing */}
            <Track label="Music and ambience" className="h-10" scrub={scrub}>
              {beds.map((c) => (
                <span
                  key={c.id}
                  title={c.reason}
                  className={`pointer-events-none absolute overflow-hidden whitespace-nowrap rounded-sm px-1.5 text-[11px] ${c.kind === "music" ? "top-1 h-5 bg-lifted leading-5 text-muted" : "top-7 h-1.5 bg-hairline"}`}
                  style={{ left: x(c.start) + 1, width: Math.max(2, x(c.length) - 2) }}
                >
                  {c.kind === "music" ? c.asset.split("/").pop()!.replace(/^placeholder_/, "").replaceAll("_", " ") : ""}
                </span>
              ))}
            </Track>

            <div ref={head} aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-20 w-0">
              <div className="absolute inset-y-0 -left-px w-0.5 bg-accent" />
              <div className="absolute -left-[5px] top-0 size-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-accent" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type Scrub = { onPointerDown: (e: PointerEvent<HTMLDivElement>) => void; onPointerMove: (e: PointerEvent<HTMLDivElement>) => void; onPointerUp: () => void };

function Track({ label, className, scrub: s, children }: { label: string; className: string; scrub: Scrub; children: React.ReactNode }) {
  // ←/→ between this track's items, Home/End to the ends; the item is selected and the Player seeks to it
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) || e.altKey || e.metaKey) return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-item]")];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, at + (e.key === "ArrowLeft" ? -1 : 1)));
    items[next]?.focus();
    items[next]?.click();
    items[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  return (
    <div role="group" aria-label={label} onKeyDown={onKeyDown} className={`relative border-b border-hairline last:border-b-0 ${className}`} {...s}>
      {children}
    </div>
  );
}
