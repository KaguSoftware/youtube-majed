"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { button, field } from "@/components/ui";
import { PlayIcon, StopIcon } from "@/components/voice-picker";
import type { Cue } from "@/lib/cuts";
import { CREDITED, GROUPS, MAX_UPLOAD_SECONDS, STOCK, UPLOAD, VOLUMES, soundSample, type VolumeId } from "@/lib/sounds";

import type { ActionState } from "./actions";
import { deleteSound, requestSounds, uploadSound } from "./edit-actions";

/** One of the studio's uploaded sounds (lib/sound-library.ts). */
export type UploadView = { id: number; name: string; seconds: number; by: string | null; url: string | null };

/** A sound in the picker: stock or uploaded, with where to hear it. */
type Entry = { id: string; name: string; group: string; seconds: number; url: string | null; credited: boolean;
  upload?: UploadView };
/** A sound placed in the studio, not yet mixed into the film. */
export type Staged = { key: number; sound: string; name: string; url: string | null; at: number; volume: VolumeId };

const YOURS = "Yours";
const gainOf = (v: VolumeId | number) => (typeof v === "number" ? v : VOLUMES.find((x) => x.id === v)?.gain ?? 1);

/** "1:24.3": placing a sound is finer work than finding a shot. */
export function tcFine(seconds: number): string {
  // In whole tenths first: 84.3 is 84.29999 in binary, and must read 1:24.3.
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const whole = Math.floor(tenths / 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${tenths % 10}`;
}

/**
 * Plays sounds through Web Audio: a preview on its own, and the placed but
 * unmixed sounds in time with the film, so the timing can be heard before
 * the change is made. Gains follow pipeline/sfx.py VOLUMES and the player's
 * own volume, so a sound previews about as loud against the voice as it
 * will be mixed. Plain, not React: it listens to the video element itself.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private previewing: AudioBufferSourceNode | null = null;
  private along: AudioBufferSourceNode[] = [];
  private video: HTMLVideoElement | null = null;
  private staged: Staged[] = [];

  private audio(): AudioContext {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private load(url: string): Promise<AudioBuffer> {
    let b = this.buffers.get(url);
    if (!b) {
      b = fetch(url).then((r) => r.arrayBuffer()).then((data) => this.audio().decodeAudioData(data));
      b.catch(() => this.buffers.delete(url));
      this.buffers.set(url, b);
    }
    return b;
  }

  private source(buffer: AudioBuffer, gain: number): AudioBufferSourceNode {
    const ac = this.audio();
    const v = this.video;
    const g = ac.createGain();
    g.gain.value = gain * (v ? (v.muted ? 0 : v.volume) : 1);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.connect(g).connect(ac.destination);
    return src;
  }

  async preview(url: string, onEnd: () => void): Promise<void> {
    this.stopPreview();
    try {
      const src = this.source(await this.load(url), 1);
      src.onended = () => { if (this.previewing === src) { this.previewing = null; onEnd(); } };
      this.previewing = src;
      src.start();
    } catch {
      onEnd();
    }
  }

  stopPreview(): void {
    try { this.previewing?.stop(); } catch { /* already ended */ }
    this.previewing = null;
  }

  // Every placed sound scheduled against the film's clock while it plays,
  // and all of it dropped the moment it pauses or seeks.
  private stopAlong = (): void => {
    for (const s of this.along) { try { s.stop(); } catch { /* already ended */ } }
    this.along = [];
  };

  private schedule = async (): Promise<void> => {
    this.stopAlong();
    const v = this.video;
    if (!v || v.paused || v.playbackRate !== 1 || !this.staged.length) return;
    const ac = this.audio();
    const at0 = v.currentTime;
    const t0 = ac.currentTime;
    const mine: AudioBufferSourceNode[] = [];
    this.along = mine;
    await Promise.all(this.staged.filter((s) => s.url).map(async (s) => {
      const buffer = await this.load(s.url!).catch(() => null);
      if (!buffer || this.along !== mine || s.at + buffer.duration < at0) return;
      const src = this.source(buffer, gainOf(s.volume));
      const wait = s.at - at0 - (ac.currentTime - t0);
      if (wait >= 0) src.start(ac.currentTime + wait);
      else src.start(0, -wait);
      mine.push(src);
    }));
  };

  attach(v: HTMLVideoElement): void {
    this.video = v;
    for (const e of ["play", "playing", "seeked", "ratechange"]) v.addEventListener(e, this.schedule);
    v.addEventListener("pause", this.stopAlong);
    v.addEventListener("seeking", this.stopAlong);
    if (!v.paused) this.schedule();
  }

  detach(): void {
    const v = this.video;
    if (v) {
      for (const e of ["play", "playing", "seeked", "ratechange"]) v.removeEventListener(e, this.schedule);
      v.removeEventListener("pause", this.stopAlong);
      v.removeEventListener("seeking", this.stopAlong);
    }
    this.stopAlong();
    this.video = null;
  }

  setStaged(staged: Staged[]): void {
    this.staged = staged;
    if (this.video && !this.video.paused) this.schedule();
  }

  close(): void {
    this.stopPreview();
    this.detach();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

function useSoundPlayer(video: RefObject<HTMLVideoElement | null>, staged: Staged[]) {
  const [engine] = useState(() => new SoundEngine());
  const [previewing, setPreviewing] = useState<string | null>(null);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    engine.attach(v);
    return () => engine.detach();
  }, [engine, video]);
  useEffect(() => { engine.setStaged(staged); }, [engine, staged]);
  useEffect(() => () => engine.close(), [engine]);

  const togglePreview = (id: string, url: string | null) => {
    engine.stopPreview();
    if (previewing === id || !url) {
      setPreviewing(null);
      return;
    }
    setPreviewing(id);
    engine.preview(url, () => setPreviewing((cur) => (cur === id ? null : cur)));
  };
  return { previewing, togglePreview };
}

/**
 * Sound effects: everything on the film now, the studio's library to add
 * from, and what has been placed but not yet mixed in. The playhead is the
 * cursor: move the film to the moment, hear a sound, place it there. Placed
 * sounds play along with the film; "Mix them in" makes one cut of all of
 * them, so one undo.
 */
export function Sounds({ projectId, video, time, duration, cues, uploads, staged, onStage, onSeek }: {
  projectId: string;
  video: RefObject<HTMLVideoElement | null>;
  time: number;
  duration: number;
  cues: Cue[];
  uploads: UploadView[];
  staged: Staged[];
  onStage: (next: Staged[]) => void;
  onSeek: (t: number) => void;
}) {
  const [removing, setRemoving] = useState<string[]>([]);
  // A cut made from these leaves nothing placed or marked.
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, form) => {
    const out = await requestSounds(projectId, prev, form);
    if (out.ok) { onStage([]); setRemoving([]); }
    return out;
  }, {});
  const [group, setGroup] = useState<string>(GROUPS[0]);
  const [search, setSearch] = useState("");
  const keyRef = useRef(1);
  const { previewing, togglePreview } = useSoundPlayer(video, staged);

  const library = useMemo<Entry[]>(() => [
    ...STOCK.map((s) => ({ id: s.id, name: s.name, group: s.group, seconds: s.seconds, url: soundSample(s.id),
      credited: CREDITED.includes(s.id) })),
    ...uploads.map((u) => ({ id: `${UPLOAD}${u.id}`, name: u.name, group: YOURS, seconds: u.seconds, url: u.url,
      credited: false, upload: u })),
  ], [uploads]);

  const q = search.trim().toLowerCase();
  const shown = q ? library.filter((e) => e.name.toLowerCase().includes(q) || e.group.toLowerCase().includes(q))
    : library.filter((e) => e.group === group);
  const at = Math.min(time, Math.max(0, duration - 0.05));

  const place = (e: Entry) => {
    onStage([...staged, { key: keyRef.current++, sound: e.id, name: e.name, url: e.url, at, volume: "normal" as VolumeId }]
      .sort((a, b) => a.at - b.at));
  };
  const change = (key: number, patch: Partial<Staged>) =>
    onStage(staged.map((s) => (s.key === key ? { ...s, ...patch } : s)).sort((a, b) => a.at - b.at));
  const toggleRemove = (id: string) =>
    setRemoving((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const count = staged.length + removing.length;

  return (
    <section aria-labelledby="sounds" className="flex flex-col gap-5 border-t border-hairline pt-6">
      <div className="flex flex-col gap-1">
        <h2 id="sounds" className="title-card text-title">Sounds</h2>
        <p className="max-w-[70ch] text-sm text-muted">
          Move the film to the moment, play a sound to hear it, then place it there. Placed sounds play along with
          the film so you can check the timing before they are mixed in.
        </p>
      </div>

      {cues.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow text-muted">On the film now</h3>
          <ul className="flex flex-col divide-y divide-hairline">
            {cues.map((c) => {
              const off = removing.includes(c.id);
              const vol = VOLUMES.find((v) => Math.abs(v.gain - c.volume) < 0.01);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <button type="button" onClick={() => onSeek(Math.max(0, c.at - 1.5))}
                    aria-label={`Go to ${c.name} at ${tcFine(c.at)}`}
                    className="tabular w-16 rounded-sm px-1.5 py-0.5 text-left text-sm font-semibold text-text hover:bg-raised">
                    {tcFine(c.at)}
                  </button>
                  <span className={"min-w-0 flex-1 text-sm " + (off ? "text-faint line-through" : "text-text")}>
                    {c.name}
                    {vol && vol.id !== "normal" && <span className="text-muted no-underline">, {vol.label.toLowerCase()}</span>}
                  </span>
                  <button type="button" onClick={() => toggleRemove(c.id)} aria-pressed={off} className={button.quiet}>
                    {off ? "Keep it" : "Take off"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="group" aria-label="Sound groups" className="flex flex-wrap gap-1">
            {[...GROUPS, YOURS].map((g) => {
              const on = !q && group === g;
              return (
                <button key={g} type="button" aria-pressed={on} onClick={() => { setGroup(g); setSearch(""); }}
                  className={"h-8 rounded-md px-3 text-sm font-semibold transition-colors duration-150 " +
                    (on ? "bg-lifted text-text" : "text-muted hover:bg-raised hover:text-text")}>
                  {g}
                </button>
              );
            })}
          </div>
          <label className="sm:w-56">
            <span className="sr-only">Search sounds</span>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sounds" className={`${field} h-9 py-1.5 text-sm`} />
          </label>
        </div>

        {shown.length > 0 ? (
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3" aria-label={q ? `Sounds matching ${search}` : `${group} sounds`}>
            {shown.map((e) => (
              <SoundRow key={e.id} entry={e} at={at} showGroup={!!q} sounding={previewing === e.id}
                onPreview={() => togglePreview(e.id, e.url)} onPlace={() => place(e)} />
            ))}
          </ul>
        ) : q ? (
          <p className="py-2 text-sm text-muted">No sound is called that. Try a shorter word, like &ldquo;laugh&rdquo; or &ldquo;horn&rdquo;.</p>
        ) : null}

        {!q && group === YOURS && <AddYourOwn empty={uploads.length === 0} />}
      </div>

      {(count > 0 || state.error) && (
        <form action={action}
          className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-md bg-lifted px-4 py-3 ring-1 ring-hairline motion-safe:animate-[fadein_200ms_var(--ease-out-quart)]">
          {staged.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="Placed, not yet mixed in">
              {staged.map((s) => (
                <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <input type="hidden" name="add" value={JSON.stringify({ sound: s.sound, at: Number(s.at.toFixed(2)), volume: s.volume })} />
                  <span className="min-w-0 basis-full truncate text-sm font-semibold text-text sm:basis-0 sm:flex-1">{s.name}</span>
                  <span className="inline-flex items-center">
                    <button type="button" onClick={() => change(s.key, { at: Math.max(0, s.at - 0.1) })}
                      aria-label={`${s.name} a tenth of a second earlier`} className={`${button.quiet} h-8 w-8 px-0 text-lg`}>‹</button>
                    <button type="button" onClick={() => onSeek(Math.max(0, s.at - 1.5))}
                      aria-label={`Go to ${s.name} at ${tcFine(s.at)}`}
                      className="tabular w-14 rounded-sm py-1 text-center text-sm text-text hover:bg-raised">
                      {tcFine(s.at)}
                    </button>
                    <button type="button" onClick={() => change(s.key, { at: Math.min(duration - 0.05, s.at + 0.1) })}
                      aria-label={`${s.name} a tenth of a second later`} className={`${button.quiet} h-8 w-8 px-0 text-lg`}>›</button>
                  </span>
                  <label className="inline-flex items-center gap-2 text-sm text-muted">
                    <span className="sr-only">Volume of {s.name}</span>
                    <select value={s.volume} onChange={(e) => change(s.key, { volume: e.target.value as VolumeId })}
                      className="h-8 rounded-md bg-raised px-2 text-sm text-text ring-1 ring-inset ring-edge focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                      {VOLUMES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                  </label>
                  <button type="button" onClick={() => onStage(staged.filter((x) => x.key !== s.key))}
                    aria-label={`Do not add ${s.name}`} className={`${button.quiet} h-8 px-2`}>Remove</button>
                </li>
              ))}
            </ul>
          )}
          {removing.map((id) => <input key={id} type="hidden" name="remove" value={id} />)}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-hairline pt-3">
            <div className="min-w-0 text-sm" aria-live="polite">
              <p className="text-text">
                {[staged.length && `${staged.length} to add`, removing.length && `${removing.length} to take off`]
                  .filter(Boolean).join(", ")}
              </p>
              {state.error ? (
                <p role="alert" className="text-danger">{state.error}</p>
              ) : (
                <p className="text-faint">
                  No frame is redrawn, so this is quick.
                  {removing.length > 0 && " Sounds being taken off still play until it is done."}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { onStage([]); setRemoving([]); }} className={button.quiet}>Clear</button>
              <button type="submit" disabled={pending || count === 0} className={button.primary}>
                {pending ? "Sending…" : staged.length ? "Mix them in" : "Take them off"}
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

function SoundRow({ entry, at, showGroup, sounding, onPreview, onPlace }: {
  entry: Entry; at: number; showGroup: boolean; sounding: boolean; onPreview: () => void; onPlace: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li className={"flex items-stretch rounded-md ring-1 ring-inset transition-[box-shadow,background-color] duration-150 ease-out-quart " +
      (sounding ? "bg-lifted ring-accent" : "ring-edge hover:bg-raised")}>
      <button type="button" onClick={onPreview} disabled={!entry.url} aria-pressed={sounding}
        aria-label={sounding ? `Stop ${entry.name}` : `Play ${entry.name}`}
        className={"flex min-w-0 flex-1 items-center gap-3 rounded-l-md py-2 pl-3 pr-2 text-left " +
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:opacity-50"}>
        <span className={"shrink-0 " + (sounding ? "text-accent" : "text-muted")}>{sounding ? <StopIcon /> : <PlayIcon />}</span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-text">{entry.name}</span>
          <span className="truncate text-xs text-faint">
            <span className="tabular">{entry.seconds.toFixed(1)} s</span>
            {showGroup && `, ${entry.group}`}
            {entry.credited && ", credited on YouTube"}
            {entry.upload?.by && `, from ${entry.upload.by}`}
          </span>
        </span>
      </button>
      {entry.upload && (
        confirm ? (
          <form action={deleteSound.bind(null, entry.upload.id)} className="flex items-center">
            <button type="submit" className="px-2 text-xs font-semibold text-danger hover:underline">Delete</button>
            <button type="button" onClick={() => setConfirm(false)} className="px-2 text-xs text-muted hover:text-text">Keep</button>
          </form>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} aria-label={`Delete ${entry.name} from the library`}
            title="Delete from the library. Films that use it keep it."
            className="px-2 text-xs text-faint hover:text-text">Delete</button>
        )
      )}
      <button type="button" onClick={onPlace} aria-label={`Place ${entry.name} at ${tcFine(at)}`}
        className="tabular shrink-0 rounded-r-md border-l border-hairline px-3 text-sm font-semibold text-muted transition-colors duration-150 hover:bg-accent hover:text-accent-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
        + {tcFine(at)}
      </button>
    </li>
  );
}

/** A sound of the studio's own: chosen, named, measured here, stored there. */
function AddYourOwn({ empty }: { empty: boolean }) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, data) => {
    const out = await uploadSound(prev, data);
    if (out.ok) { form.current?.reset(); setName(""); setSeconds(null); }
    return out;
  }, {});

  const choose = (file: File | undefined) => {
    setSeconds(null);
    setProblem(null);
    if (!file) return;
    if (!name) setName(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 60));
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (!Number.isFinite(probe.duration)) return setProblem("That file could not be played as audio.");
      if (probe.duration > MAX_UPLOAD_SECONDS) {
        return setProblem(`That sound is ${Math.round(probe.duration)} seconds. Trim it to ${MAX_UPLOAD_SECONDS} or less.`);
      }
      setSeconds(probe.duration);
    };
    probe.onerror = () => { URL.revokeObjectURL(url); setProblem("That file could not be played as audio."); };
    probe.src = url;
  };

  return (
    <form ref={form} action={action} className="flex flex-col gap-3 rounded-md bg-raised p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-text">{empty ? "No sounds of the studio’s own yet. Add one." : "Add a sound"}</p>
        <p className="max-w-[70ch] text-xs text-muted">
          MP3, WAV, OGG or M4A, up to {MAX_UPLOAD_SECONDS} seconds and 2 MB. Everyone in the studio can use it. A clip
          from a film, show or song can get the video claimed on YouTube, so add only sounds you may publish.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-muted sm:flex-1">
          File
          <input type="file" name="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" required
            onChange={(e) => choose(e.target.files?.[0])}
            className="text-sm text-text file:mr-3 file:h-9 file:cursor-pointer file:rounded-md file:border-0 file:bg-lifted file:px-3 file:text-sm file:font-semibold file:text-text hover:file:bg-hairline" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted sm:w-64">
          Name
          <input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required
            placeholder="Bruh" className={`${field} h-9 py-1.5 text-sm`} />
        </label>
        <input type="hidden" name="seconds" value={seconds ?? ""} />
        <button type="submit" disabled={pending || seconds === null} className={button.secondary}>
          {pending ? "Adding…" : "Add to the library"}
        </button>
      </div>
      {(problem || state.error) && <p role="alert" className="text-sm text-danger">{problem ?? state.error}</p>}
      {state.ok && !problem && <p className="text-sm text-ok" aria-live="polite">Added. It is in the list above.</p>}
    </form>
  );
}

/** Where the film's sounds sit, under the shot strip: on the film, and
 *  placed but not yet mixed in. Each one seeks there. */
export function SoundLane({ cues, staged, duration, onSeek }: {
  cues: Cue[]; staged: Staged[]; duration: number; onSeek: (t: number) => void;
}) {
  if (!duration || (!cues.length && !staged.length)) return null;
  const marks = [
    ...cues.map((c) => ({ key: c.id, name: c.name, at: c.at, placed: false })),
    ...staged.map((s) => ({ key: `s${s.key}`, name: s.name, at: s.at, placed: true })),
  ];
  return (
    <ul aria-label="Sounds on the film" className="relative -mt-2 h-4">
      {marks.map((m) => (
        <li key={m.key} className="absolute top-0 -translate-x-1/2" style={{ left: `${(m.at / duration) * 100}%` }}>
          <button type="button" onClick={() => onSeek(Math.max(0, m.at - 1.5))}
            title={`${m.name}, ${tcFine(m.at)}${m.placed ? ", not mixed in yet" : ""}`}
            aria-label={`${m.name} at ${tcFine(m.at)}${m.placed ? ", not mixed in yet" : ""}`}
            className="flex h-4 w-3 items-start justify-center focus-visible:outline-2 focus-visible:outline-accent">
            <span aria-hidden className={"block h-2.5 w-1 rounded-full " +
              (m.placed ? "bg-accent" : "bg-muted")} />
          </button>
        </li>
      ))}
    </ul>
  );
}
