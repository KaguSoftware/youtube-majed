"use client";

import { useEffect, useRef, useState } from "react";

import { PACES, VOICES, voiceSample, type PaceId, type VoiceId } from "@/lib/voices";

/**
 * Who narrates the film, and at what pace. Every voice can be heard first:
 * the sample is the same two sentences in each, so they compare fairly, and
 * it plays at the chosen pace (faster or slower with the pitch kept, as the
 * studio machine speaks it). Same selection vocabulary as the Length and
 * narrative pickers. Submits `voice` and `pace`.
 */
export function VoicePicker({ defaultVoice, defaultPace }: { defaultVoice: VoiceId; defaultPace: PaceId }) {
  const [voice, setVoice] = useState<VoiceId>(defaultVoice);
  const [pace, setPace] = useState<PaceId>(defaultPace);
  const [playing, setPlaying] = useState<VoiceId | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const rate = PACES.find((p) => p.id === pace)?.rate ?? 1;

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate]);

  const play = (id: VoiceId) => {
    const a = audio.current;
    if (!a) return;
    if (playing === id) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.src = voiceSample(id);
    a.playbackRate = rate;
    a.play().then(() => setPlaying(id), () => setPlaying(null));
  };

  const groups = [
    { label: "Women", voices: VOICES.filter((v) => v.who === "woman") },
    { label: "Men", voices: VOICES.filter((v) => v.who === "man") },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* preservesPitch is the default: a faster sample is not a higher voice. */}
      <audio ref={audio} preload="none" onEnded={() => setPlaying(null)} className="hidden" />
      <fieldset className="flex flex-col gap-3">
        <legend className="eyebrow mb-1 text-muted">Narrator</legend>
        <p className="mb-2 text-sm text-faint">Play a voice to hear it read the same two lines as the others.</p>
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-faint">{g.label}</p>
            <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {g.voices.map((v) => {
                const on = voice === v.id;
                const sounding = playing === v.id;
                const hint = "hint" in v ? v.hint : undefined;
                return (
                  <li key={v.id}
                    className={"flex items-stretch rounded-md ring-1 ring-inset transition-[box-shadow,background-color] duration-150 ease-out-quart " +
                      (on ? "bg-lifted ring-2 ring-accent" : "ring-edge hover:bg-raised")}>
                    <button type="button" onClick={() => play(v.id)} aria-pressed={sounding}
                      aria-label={sounding ? `Stop ${v.name}` : `Play ${v.name}`}
                      className={"flex w-11 shrink-0 items-center justify-center rounded-l-md transition-colors duration-150 " +
                        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent " +
                        (sounding ? "text-accent" : "text-muted hover:text-text")}>
                      {sounding ? <StopIcon /> : <PlayIcon />}
                    </button>
                    <label className="flex min-w-0 flex-1 cursor-pointer flex-col justify-center gap-0.5 py-2.5 pr-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-accent">
                      <input type="radio" name="voice" value={v.id} checked={on}
                        onChange={() => setVoice(v.id)} className="sr-only" />
                      <span className="flex items-baseline gap-2">
                        <span className="title-card text-base">{v.name}</span>
                        <span className="text-xs text-muted">{v.accent}</span>
                        {sounding && <span className="sr-only">, playing</span>}
                      </span>
                      {hint && <span className="text-xs text-faint">{hint}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="eyebrow mb-3 text-muted">Pace</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PACES.map((p) => {
            const on = pace === p.id;
            return (
              <label key={p.id}
                className={"flex cursor-pointer flex-col gap-0.5 rounded-md px-3 py-3 ring-1 ring-inset transition-[box-shadow,background-color] duration-150 ease-out-quart has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent " +
                  (on ? "bg-lifted ring-2 ring-accent" : "ring-edge hover:bg-raised")}>
                <input type="radio" name="pace" value={p.id} checked={on}
                  onChange={() => setPace(p.id)} className="sr-only" />
                <span className="title-card text-lg">{p.label}</span>
                <span className="text-xs text-muted">{p.hint}</span>
              </label>
            );
          })}
        </div>
        <p className="text-sm text-faint">
          The pace changes the film&rsquo;s length a little: measured runs about a tenth longer, brisk a tenth shorter.
        </p>
      </fieldset>
    </div>
  );
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="currentColor">
      <path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="currentColor">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.2" />
    </svg>
  );
}
