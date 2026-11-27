"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { button, field } from "@/components/ui";
import { useFilmSource, type FilmSource } from "@/components/use-film-source";

import type { Cue } from "@/lib/cuts";

import type { ActionState } from "./actions";
import { keepWarm, requestEdit, requestRepaint, stopEdit } from "./edit-actions";
import { SoundLane, Sounds, type Staged, type UploadView } from "./sounds";

/** `look`: why a person should check this shot, in plain words (lib/cuts.ts). */
export type Mark = { id: string; start: number; end: number; text: string; look: string[] };
export type CutView = {
  version: number;
  source: FilmSource | null;
  sheet: { url: string; cols: number; rows: number; thumb: [number, number]; shots: string[] } | null;
  marks: Mark[];
  changed: string[];
  /** Where the change in this cut starts, to show it first. */
  focus: number | null;
  change: { request: string; summary: string } | null;
  duration: number;
  sounds: Cue[];
};
/** A shot's full-size still, for the frames grid. */
export type Frame = { id: string; still: string | null };
/** `repaint`: frames marked in the grid, painted again without Claude.
 *  `sounds`: sounds placed in the studio, mixed in without Claude. */
export type LiveEdit = { id: string; request: string; at: number | null; chunked: boolean; repaint: boolean;
  sounds: boolean };

/** "1:24" from seconds. */
export function tc(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const SEEN = (projectId: string) => `ytm:edit-pending:${projectId}`;

/**
 * The film, and the one thing the user does to it: ask for a change.
 * The player is the page (web/PRODUCT.md, the footage is the hero); under it
 * the shot strip, which is also the scrubber; under that the request.
 * While Claude works the request turns into its progress, and when the new
 * cut arrives the player opens on the change. Last, every frame of the film,
 * to mark the ones that came out wrong and paint them again. Between the
 * two, the sounds: what is on the film, and the library to add from.
 */
export function EditingRoom({ projectId, viewing, earlier, isCurrent, live, frames, uploads }: {
  projectId: string;
  viewing: CutView;
  /** The cut this one was made from, for comparing. */
  earlier: CutView | null;
  isCurrent: boolean;
  live: LiveEdit | null;
  /** Only for the film as it is, with no change being made. */
  frames: Frame[] | null;
  /** The studio's own sounds; likewise. */
  uploads: UploadView[] | null;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [side, setSide] = useState<"this" | "earlier">("this");
  const [resume, setResume] = useState<{ time: number; playing: boolean } | null>(null);
  const [time, setTime] = useState(0);
  const [staged, setStaged] = useState<Staged[]>([]);
  const shown = side === "earlier" && earlier ? earlier : viewing;
  useFilmSource(video, shown.source, resume);

  // Opening on the change: after an edit finishes, the page re-renders with
  // the new cut; start it a moment before the shot that changed.
  useEffect(() => {
    let pending: string | null = null;
    try { pending = sessionStorage.getItem(SEEN(projectId)); } catch { /* private mode */ }
    if (!pending || !isCurrent || String(viewing.version) === pending) return;
    try { sessionStorage.removeItem(SEEN(projectId)); } catch { /* private mode */ }
    if (viewing.focus !== null) {
      const t = Math.max(0, viewing.focus - 1.5);
      const v = video.current;
      if (v) {
        if (v.readyState >= 1) v.currentTime = t;
        else v.addEventListener("loadedmetadata", () => { v.currentTime = t; }, { once: true });
      }
    }
  }, [projectId, viewing.version, viewing.focus, isCurrent]);

  // Keep the studio machine listening closely while this page is open, so a
  // change starts within seconds (lib/doorbell.ts).
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") keepWarm().catch(() => {}); };
    tick();
    const id = setInterval(tick, 4 * 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, []);

  const switchTo = (next: "this" | "earlier") => {
    if (next === side) return;
    const v = video.current;
    setResume(v ? { time: v.currentTime, playing: !v.paused } : null);
    setSide(next);
  };

  const seek = useCallback((t: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = t;
    setTime(t);
  }, []);

  return (
    <section aria-label="The film" className="flex flex-col gap-4">
      {earlier && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="radiogroup" aria-label="Which cut to play" className="inline-flex rounded-md bg-raised p-0.5 text-sm">
            {(["this", "earlier"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={side === k}
                onClick={() => switchTo(k)}
                className={"h-8 rounded-[5px] px-3 font-semibold transition-colors duration-150 " +
                  (side === k ? "bg-lifted text-text" : "text-muted hover:text-text")}
              >
                {k === "this" ? "With the change" : "Before it"}
              </button>
            ))}
          </div>
          <p className="text-xs text-faint">Switching keeps your place in the film.</p>
        </div>
      )}

      <div className="relative">
        {shown.source ? (
          <video
            ref={video}
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onSeeked={(e) => setTime(e.currentTarget.currentTime)}
            className="aspect-video w-full rounded-sm bg-raised"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-sm bg-raised p-8 text-center text-sm text-muted">
            This cut was made without the media store, so it plays only on the studio machine.
          </div>
        )}
        {side === "earlier" && (
          <span className="pointer-events-none absolute left-3 top-3 rounded-sm bg-room/85 px-2 py-1 text-xs font-semibold text-text">
            Before the change
          </span>
        )}
      </div>

      <ShotStrip cut={shown} time={time} onSeek={seek} highlight={side === "this" ? viewing.changed : []} />
      <SoundLane cues={shown.sounds} staged={side === "this" ? staged : []} duration={shown.duration} onSeek={seek} />

      <WorthALook marks={shown.marks} time={time} onSeek={seek} canAsk={isCurrent && !live} />

      {isCurrent && (
        live
          ? <EditProgress projectId={projectId} live={live} fromVersion={viewing.version} />
          : <ChangeRequest projectId={projectId} time={time} chunked={!!viewing.source && viewing.source.kind === "hls"} />
      )}

      {isCurrent && !live && uploads && viewing.source && (
        <Sounds projectId={projectId} video={video} time={time} duration={viewing.duration} cues={viewing.sounds}
          uploads={uploads} staged={side === "this" ? staged : []} onStage={setStaged} onSeek={seek} />
      )}

      {isCurrent && !live && frames && frames.length > 0 && (
        <Frames projectId={projectId} frames={frames} cut={viewing} />
      )}
    </section>
  );
}

/**
 * Every shot of the cut, as wide as it is long, read out of the contact
 * sheet. Doubles as the scrubber: a shot seeks to its start. Shots this cut
 * changed carry a bar and say so to screen readers.
 */
function ShotStrip({ cut, time, onSeek, highlight }: {
  cut: CutView; time: number; onSeek: (t: number) => void; highlight: string[];
}) {
  const { sheet, marks, duration } = cut;
  if (!marks.length || !duration) return null;
  const changed = new Set(highlight);
  const index = new Map(sheet?.shots.map((id, i) => [id, i]) ?? []);
  const [tw, th] = sheet?.thumb ?? [16, 9];
  return (
    <div className="relative">
      <ol className="flex h-12 gap-px" aria-label="Shots">
        {marks.map((m) => {
          const i = index.get(m.id);
          const col = i !== undefined && sheet ? i % sheet.cols : 0;
          const row = i !== undefined && sheet ? Math.floor(i / sheet.cols) : 0;
          const on = time >= m.start && time < m.end;
          return (
            <li key={m.id} style={{ flexGrow: m.end - m.start, flexBasis: 0 }}
              className="relative min-w-0 overflow-visible first:[&>button]:rounded-l-sm last:[&>button]:rounded-r-sm">
              <button
                type="button"
                onClick={() => onSeek(m.start)}
                title={`${tc(m.start)}  ${m.text}`}
                aria-label={`Shot at ${tc(m.start)}${changed.has(m.id) ? ", changed in this cut" : ""}${
                  m.look.length ? ", worth a look" : ""}: ${m.text}`}
                aria-current={on ? "time" : undefined}
                className={"group relative block h-full w-full overflow-hidden bg-raised " +
                  (on ? "" : "opacity-70 hover:opacity-100")}
              >
                {sheet && i !== undefined && (
                  <span
                    aria-hidden
                    className="absolute left-1/2 top-0 h-full -translate-x-1/2"
                    style={{
                      aspectRatio: `${tw} / ${th}`,
                      backgroundImage: `url(${sheet.url})`,
                      backgroundSize: `${sheet.cols * 100}% ${sheet.rows * 100}%`,
                      backgroundPosition: `${sheet.cols > 1 ? (col / (sheet.cols - 1)) * 100 : 0}% ${
                        sheet.rows > 1 ? (row / (sheet.rows - 1)) * 100 : 0}%`,
                    }}
                  />
                )}
              </button>
              {changed.has(m.id) && <span aria-hidden className="absolute inset-x-0 -bottom-1.5 h-0.5 bg-text" />}
              {m.look.length > 0 && <LookBadge small className="pointer-events-none absolute right-0.5 top-0.5 sm:right-1 sm:top-1" />}
            </li>
          );
        })}
      </ol>
      <span
        aria-hidden
        className="pointer-events-none absolute -top-1 bottom-0 w-0.5 rounded-full bg-accent"
        style={{ left: `${Math.min(100, (time / duration) * 100)}%` }}
      />
    </div>
  );
}

/** The mark on a shot worth checking: a shape as well as a colour. */
function LookBadge({ className = "", small = false }: { className?: string; small?: boolean }) {
  // Small in the strip on a phone, where a shot can be narrower than the mark.
  const size = small ? "size-3 text-[9px] sm:size-4 sm:text-[11px]" : "size-4 text-[11px]";
  return (
    <span aria-hidden
      className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-caution font-bold leading-none text-accent-ink ${className}`}>
      !
    </span>
  );
}

/**
 * Shots the studio machine was not sure about: a picture that never passed
 * its checks, narration the aligner could not clearly hear. Each one jumps
 * the film there. Nothing is blocked; the person decides.
 */
function WorthALook({ marks, time, onSeek, canAsk }: {
  marks: Mark[]; time: number; onSeek: (t: number) => void; canAsk: boolean;
}) {
  const flagged = marks.filter((m) => m.look.length);
  if (!flagged.length) return null;
  return (
    <section aria-labelledby="worth-a-look" className="flex flex-col gap-2 pt-2">
      <h2 id="worth-a-look" className="eyebrow text-muted">
        Worth a look before this goes out
      </h2>
      <ul className="flex flex-col divide-y divide-hairline">
        {flagged.map((m) => {
          const on = time >= m.start && time < m.end;
          return (
            <li key={m.id} className="flex items-start gap-4 py-2.5">
              <button
                type="button"
                onClick={() => onSeek(m.start)}
                aria-label={`Go to the shot at ${tc(m.start)}`}
                aria-current={on ? "time" : undefined}
                className={"inline-flex shrink-0 items-center gap-2 rounded-sm px-1.5 py-0.5 text-sm font-semibold transition-colors duration-150 hover:bg-raised " +
                  (on ? "bg-raised text-text" : "text-text")}
              >
                <LookBadge />
                <span className="tabular w-10 text-left">{tc(m.start)}</span>
              </button>
              <p className="max-w-[75ch] pt-0.5 text-sm text-muted">{m.look.join(" ")}</p>
            </li>
          );
        })}
      </ul>
      {canAsk && (
        <p className="text-xs text-faint">
          If one looks wrong, mark it under Every frame to paint it again, or describe the change below. If it looks right, leave it.
        </p>
      )}
    </section>
  );
}

/** The request: one field, the playhead riding along as "at 1:24". */
function ChangeRequest({ projectId, time, chunked }: { projectId: string; time: number; chunked: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(requestEdit.bind(null, projectId), {});
  const [at, setAt] = useState<number | null>(null);
  const [withTime, setWithTime] = useState(true);
  // Before the film has been played or moved, the playhead says nothing about
  // which shot is meant, and "at 0:00" would mislead Claude.
  const form = useRef<HTMLFormElement>(null);
  // The playhead is taken when the user starts writing, not as they type:
  // the moment they stopped on is the one they mean.
  const stamp = at ?? time;
  const meaningful = stamp > 0.5;

  return (
    <form
      ref={form}
      action={action}
      className="flex flex-col gap-3 border-t border-hairline pt-6"
    >
      <label htmlFor="request" className="title-card text-title">What should change?</label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <textarea
            id="request"
            name="request"
            rows={2}
            required
            minLength={4}
            maxLength={1000}
            onFocus={() => setAt(time)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                form.current?.requestSubmit();
              }
            }}
            placeholder="The mood at 1:24 doesn't match. The lamp in the grain store looks modern. Hold the opening shot longer."
            aria-describedby="request-help"
            aria-invalid={state.error ? true : undefined}
            className={`${field} min-h-20 resize-y`}
          />
          <input type="hidden" name="at" value={withTime && meaningful ? stamp.toFixed(2) : ""} />
        </div>
        <button type="submit" disabled={pending} className={`${button.primary} sm:mt-0.5`}>
          {pending ? "Sending…" : "Make the change"}
        </button>
      </div>
      <div id="request-help" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        {!meaningful ? (
          <span>Play or pause on a shot and it is sent with your note, so &ldquo;this shot&rdquo; works.</span>
        ) : withTime ? (
          <span className="inline-flex items-center gap-2">
            <span>Sent with the moment you are on, <span className="tabular text-text">{tc(stamp)}</span>, so &ldquo;this shot&rdquo; works.</span>
            <button type="button" onClick={() => setWithTime(false)} className="text-faint underline underline-offset-2 hover:text-text">
              Leave it out
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setWithTime(true)} className="text-faint underline underline-offset-2 hover:text-text">
            Send the moment you are on
          </button>
        )}
        <span className="text-faint">
          {chunked ? "Usually ready in under a minute." : "The first change to this film takes about two minutes while it is prepared for editing."}
        </span>
      </div>
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}

/** pipeline/editor.py MAX_REPAINT. */
const MAX_REPAINT = 12;

/**
 * Every frame of the film at a size where a wrong hand shows. Click marks a
 * frame; the marked ones are painted again together, from the same
 * description, as one new cut (so one undo). Anything that needs a different
 * picture, not another try at the same one, goes in the change box above.
 */
function Frames({ projectId, frames, cut }: { projectId: string; frames: Frame[]; cut: CutView }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(requestRepaint.bind(null, projectId), {});
  const [marked, setMarked] = useState<string[]>([]);
  const marks = useMemo(() => new Map(cut.marks.map((m) => [m.id, m])), [cut.marks]);
  const toggle = (id: string) =>
    setMarked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  // In film order, whatever order they were clicked in.
  const ordered = frames.filter((f) => marked.includes(f.id));
  const tooMany = ordered.length > MAX_REPAINT;

  return (
    <form action={action} aria-labelledby="every-frame" className="flex flex-col gap-4 border-t border-hairline pt-6">
      <div className="flex flex-col gap-1">
        <h2 id="every-frame" className="eyebrow text-muted">Every frame <span className="tabular text-faint">({frames.length})</span></h2>
        <p className="max-w-[75ch] text-sm text-muted">
          Click the frames that came out wrong, like a hand melting into the bed, then paint them again. Each
          one is painted fresh from the same description, so it shows the same moment, drawn differently.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {frames.map((f) => {
          const m = marks.get(f.id);
          const on = marked.includes(f.id);
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => toggle(f.id)}
                aria-pressed={on}
                aria-label={`Frame at ${m ? tc(m.start) : f.id}${m?.look.length ? ", worth a look" : ""}${m ? `: ${m.text}` : ""}`}
                title={m?.text}
                className={"group relative block aspect-[832/480] w-full overflow-hidden rounded-sm bg-raised " +
                  "transition-shadow duration-150 ease-out-quart focus-visible:outline-2 focus-visible:outline-offset-2 " +
                  "focus-visible:outline-accent " +
                  (on ? "ring-2 ring-accent ring-offset-2 ring-offset-room" : "")}
              >
                {f.still ? (
                  // eslint-disable-next-line @next/next/no-img-element -- presigned media
                  <img src={f.still} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                ) : cut.sheet ? (
                  <span aria-hidden className="block size-full" style={sprite(cut.sheet, f.id)} />
                ) : null}
                <span className={"absolute left-1.5 top-1.5 rounded-sm px-1.5 py-0.5 text-xs font-semibold " +
                  "transition-opacity duration-150 ease-out-quart " +
                  (on ? "bg-accent text-accent-ink" : "bg-room/85 text-text opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")}>
                  {on ? "Paint again" : "Mark"}
                </span>
                {m && (
                  <span className="tabular absolute bottom-1.5 left-1.5 rounded-sm bg-room/85 px-1.5 py-0.5 text-xs text-text">
                    {tc(m.start)}
                  </span>
                )}
                {m && m.look.length > 0 && <LookBadge className="absolute right-1.5 top-1.5" />}
              </button>
              {on && <input type="hidden" name="shot" value={f.id} />}
            </li>
          );
        })}
      </ul>

      {(ordered.length > 0 || state.error) && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-md bg-lifted px-4 py-3 ring-1 ring-hairline motion-safe:animate-[fadein_200ms_var(--ease-out-quart)]">
          <div className="min-w-0 text-sm" aria-live="polite">
            {ordered.length > 0 ? (
              <p className="text-text">
                <span className="font-semibold">{ordered.length} marked</span>
                <span className="tabular text-muted">
                  {" "}at {ordered.map((f) => (marks.get(f.id) ? tc(marks.get(f.id)!.start) : f.id)).join(", ")}
                </span>
              </p>
            ) : null}
            {tooMany ? (
              <p className="text-danger">Up to {MAX_REPAINT} at a time. Unmark {ordered.length - MAX_REPAINT}.</p>
            ) : state.error ? (
              <p role="alert" className="text-danger">{state.error}</p>
            ) : (
              <p className="text-faint">About 15 seconds a frame, then the film is cut again.</p>
            )}
          </div>
          <div className="flex gap-2">
            {ordered.length > 0 && (
              <button type="button" onClick={() => setMarked([])} className={button.quiet}>Clear</button>
            )}
            <button type="submit" disabled={pending || tooMany || ordered.length === 0} className={button.primary}>
              {pending ? "Sending…" : `Paint ${ordered.length === 1 ? "it" : ordered.length} again`}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

/** One shot's frame out of the contact sheet, by background position. */
function sprite(sheet: NonNullable<CutView["sheet"]>, id: string): CSSProperties {
  const i = Math.max(0, sheet.shots.indexOf(id));
  const col = i % sheet.cols;
  const row = Math.floor(i / sheet.cols);
  return {
    backgroundImage: `url(${sheet.url})`,
    backgroundSize: `${sheet.cols * 100}% ${sheet.rows * 100}%`,
    backgroundPosition: `${sheet.cols > 1 ? (col / (sheet.cols - 1)) * 100 : 0}% ${
      sheet.rows > 1 ? (row / (sheet.rows - 1)) * 100 : 0}%`,
  };
}

type Ev = { id: string; kind: string; data: Record<string, unknown>; at: string; url?: string };

/** One of Claude's tool calls, in the studio's words. */
function step(e: Ev): string | null {
  const d = e.data as { tool?: string; ok?: boolean; args?: Record<string, unknown>; result?: string };
  if (!d.ok) return null;
  const when = /(\d+:\d{2})(?:\.\d)?/.exec(d.result ?? "")?.[1];
  const at = when ? ` at ${when}` : "";
  switch (d.tool) {
    case "resolve_timecode": return `Finding the shot${at}`;
    case "view_shot": return `Looking at the shot${at}`;
    case "set_shot_mood": return `New mood for the shot${at}: ${d.args?.mood}`;
    case "edit_shot_image": return `Retouching the shot${at}`;
    case "regenerate_shot": return `Repainting the shot${at}`;
    case "nudge_shot_boundary": return `Moving the cut${at}`;
    case "split_shot": return `Splitting the shot${at} in two`;
    case "merge_shots": return `Joining two shots${at}`;
    case "add_sound": return `Placing ${(d.result ?? "").split(" at ")[0]}${at}`;
    case "remove_sound": return `Taking ${(d.result ?? "").split(" at ")[0]} off${at}`;
    default: return null;
  }
}

const PHASES = [
  { key: "understanding", label: "Claude reads your note and finds the shot", repaint: "Finding the marked frames",
    sounds: "Placing the sounds" },
  { key: "painting", label: "Painting" },
  { key: "cutting", label: "Cutting it into the film", sounds: "Mixing them into the film" },
];

/** The change being made, live: Claude's steps, then the new frames, then
 *  the cut. On done the page re-renders with the new cut. */
function EditProgress({ projectId, live, fromVersion }: { projectId: string; live: LiveEdit; fromVersion: number }) {
  const router = useRouter();
  const [events, setEvents] = useState<Ev[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [started] = useState(() => Date.now());

  useEffect(() => {
    try { sessionStorage.setItem(SEEN(projectId), String(fromVersion)); } catch { /* private mode */ }
    const es = new EventSource(`/api/films/${projectId}/events?job=${live.id}`);
    es.addEventListener("progress", (m) => {
      const ev = JSON.parse((m as MessageEvent).data) as Ev;
      setEvents((prev) => (prev.some((e) => e.id === ev.id) ? prev : [...prev, ev]));
      if (ev.kind === "failed") {
        try { sessionStorage.removeItem(SEEN(projectId)); } catch { /* private mode */ }
      }
      if (ev.kind === "done" || ev.kind === "failed") router.refresh();
    });
    es.addEventListener("end", () => es.close());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { es.close(); clearInterval(tick); };
  }, [projectId, live.id, fromVersion, router]);

  const view = useMemo(() => {
    const stage = [...events].reverse().find((e) => e.kind === "stage")?.data.stage as string | undefined;
    const steps = events.filter((e) => e.kind === "tool").map(step).filter((s): s is string => !!s);
    const frames = events.filter((e) => e.kind === "shot" && e.url);
    const outcome = [...events].reverse().find((e) => e.kind === "done" || e.kind === "failed");
    const claimed = events.some((e) => e.kind === "claimed");
    return { stage, steps, frames, outcome, claimed };
  }, [events]);

  // Sounds change no picture, so there is no painting to wait for.
  const phases = live.sounds ? PHASES.filter((p) => p.sounds) : PHASES;
  const phase = phases.findIndex((p) => p.key === view.stage);
  const seconds = Math.round((now - started) / 1000);

  return (
    <div className="flex flex-col gap-5 border-t border-hairline pt-6" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="title-card text-title">
          <span className="mr-3 inline-block size-2.5 rounded-full bg-accent align-middle motion-safe:animate-pulse" aria-hidden />
          {view.outcome?.kind === "done" ? "Done. Opening the new cut" : live.repaint ? "Painting again"
            : live.sounds ? "Mixing in the sounds" : "Making the change"}
        </p>
        <form action={stopEdit.bind(null, projectId)}>
          <button type="submit" className={button.quiet}>Stop</button>
        </form>
      </div>
      {live.repaint || live.sounds ? (
        <p className="max-w-[65ch] text-lg text-text">{live.request}</p>
      ) : (
        <p className="max-w-[65ch] text-lg text-text">&ldquo;{live.request}&rdquo;
          {live.at !== null && <span className="text-muted"> at {tc(live.at)}</span>}
        </p>
      )}
      <ol className={"grid gap-2 " + (phases.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")} aria-label="Steps">
        {phases.map((p, i) => {
          const label = live.repaint && p.repaint ? p.repaint : live.sounds && p.sounds ? p.sounds : p.label;
          const done = phase > i || view.outcome?.kind === "done";
          const current = phase === i && !view.outcome;
          return (
            <li key={p.key} aria-current={current ? "step" : undefined} className="flex flex-col gap-2">
              <span className={"h-1 rounded-full " + (done ? "bg-muted" : current ? "bg-accent" : "bg-hairline")} />
              <span className={"text-xs " + (current ? "text-text" : done ? "text-muted" : "text-faint")}>{label}</span>
            </li>
          );
        })}
      </ol>
      <ul className="flex flex-col gap-1 text-sm text-muted">
        {!view.claimed && <li>Waiting for the studio machine…</li>}
        {view.steps.map((s, i) => (
          <li key={i} className={i === view.steps.length - 1 && phase === 0 ? "text-text" : ""}>{s}</li>
        ))}
      </ul>
      {view.frames.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {view.frames.map((f) => (
            // eslint-disable-next-line @next/next/no-img-element -- presigned media
            <img key={f.id} src={f.url} alt={`New frame for ${String(f.data.shot)}`}
              className="aspect-[832/480] w-56 rounded-sm object-cover motion-safe:animate-[fadein_400ms_var(--ease-out-quart)]" />
          ))}
        </div>
      )}
      <p className="tabular text-xs text-faint">
        {seconds} s{live.chunked ? ", usually under a minute" : ", about two minutes this first time"}
      </p>
    </div>
  );
}
