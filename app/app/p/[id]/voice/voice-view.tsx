"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { JobError, JobProgress } from "@/components/job-progress";
import { JobBar, StepHead } from "@/components/step-head";
import { button } from "@/components/ui";
import { call, fileUrl, VoiceState, type ProjectDetail } from "@/lib/api";
import { clock } from "@/lib/format";
import { useAct } from "@/lib/use-act";
import { useProject } from "@/lib/use-project";

const QUALITY = { ok: { word: "Clear", tone: "text-ok" }, warn: { word: "Check", tone: "text-caution" }, fail: { word: "Failed", tone: "text-danger" } } as const;

/**
 * Step 5. The channel voice (Chatterbox's built-in studio voice) reads the
 * locked script line by line. Each take is force-aligned against the script
 * and graded; a line that is not clear can be retaken alone.
 */
export function VoiceView({ initial }: { initial: ProjectDetail }) {
  const { project: p, active, lastFinished, reload } = useProject(initial);
  const [voice, setVoice] = useState<VoiceState["voice"]>(null);
  const [onlyCheck, setOnlyCheck] = useState(true);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  const load = useCallback(async () => {
    try {
      setVoice((await call(`/projects/${p.id}/voice`, VoiceState)).voice);
    } catch {
      /* the next job event retries */
    }
  }, [p.id]);
  const refresh = useCallback(async () => {
    await reload();
    await load();
  }, [reload, load]);
  useEffect(() => void load(), [load, lastFinished?.id]);
  const { act, cancel, error } = useAct(refresh);

  const stage = p.pipeline.stages[4]!;
  const locked = Boolean(p.narration?.lockedAt);
  const busy = active.length > 0;
  const lines = voice?.lines ?? [];
  const bad = lines.filter((l) => l.quality.status !== "ok");
  const shown = onlyCheck && bad.length ? bad : lines;
  const audioMinutes = Math.max(1, Math.round((p.budget / p.wpm) * 1.0));

  function play(file: string, id: string) {
    const el = audio.current;
    if (!el) return;
    if (playing === id) {
      el.pause();
      return setPlaying(null);
    }
    el.src = fileUrl(p.id, `audio/${file}`);
    void el.play();
    setPlaying(id);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <StepHead stepKey="voice" stage={stage} title="Voice">
        {locked && (
          <button type="button" onClick={() => act(`/projects/${p.id}/voice`, {})} disabled={busy} className={voice && !stage.stale ? button.secondary : button.primary}>
            {voice ? (stage.stale ? "Voice the changed lines" : "Check for changes") : "Voice the script"}
          </button>
        )}
      </StepHead>

      <JobBar live={busy || Boolean(error) || lastFinished?.status === "failed"}>
        <JobProgress jobs={active} onCancel={cancel} />
        {!busy && <JobError job={lastFinished} />}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </JobBar>

      {!locked ? (
        <section className="mt-12 max-w-xl">
          <h2 className="text-lg font-semibold">The voice reads a locked script</h2>
          <p className="mt-2 text-muted">Lock the script first, so no line changes under the narrator.</p>
          <Link href={`/p/${p.id}/script`} className={`${button.secondary} mt-6`}>Open the script</Link>
        </section>
      ) : !voice ? (
        !busy && (
          <section className="mt-12 max-w-xl">
            <h2 className="text-lg font-semibold">Reads every line, then checks what it said</h2>
            <p className="mt-2 text-muted">
              About {audioMinutes} minutes of narration takes roughly twice that to record on this Mac, one line at a time. Lines already voiced are reused, so only changes cost time. Every take is aligned to your words and graded; you listen to the ones that did not come out clear.
            </p>
          </section>
        )
      ) : (
        <>
          <dl className="mt-10 grid max-w-3xl grid-cols-2 gap-x-10 gap-y-4 text-sm sm:grid-cols-4">
            <div><dt className="eyebrow text-faint">Narration</dt><dd className="tabular mt-1 text-lg font-semibold">{clock(voice.track.duration)}</dd></div>
            <div><dt className="eyebrow text-faint">Loudness</dt><dd className="tabular mt-1 text-lg font-semibold">{voice.track.loudness.integratedLufs} LUFS</dd></div>
            <div><dt className="eyebrow text-faint">Lines</dt><dd className="tabular mt-1 text-lg font-semibold">{lines.length}{bad.length ? <span className="text-sm font-normal text-caution"> · {bad.length} to check</span> : null}</dd></div>
            <div><dt className="eyebrow text-faint">Voice</dt><dd className="mt-1 text-lg font-semibold">{voice.reference.startsWith("builtin") ? "Built-in studio voice" : "Cloned reference"}</dd></div>
          </dl>

          <section aria-labelledby="listen-h" className="mt-10 max-w-3xl">
            <h2 id="listen-h" className="eyebrow text-faint">The whole track</h2>
            <audio controls preload="none" src={fileUrl(p.id, "audio/narration.wav")} className="mt-3 w-full" />
          </section>

          <section aria-labelledby="lines-h" className="mt-12">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <h2 id="lines-h" className="text-lg font-semibold">Lines</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted">The check hears each take with a speech model and compares it to your words. It often misspells names (Inés comes back as "Enez"), so listen before retaking.</p>
              </div>
              {bad.length > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={onlyCheck} onChange={(e) => setOnlyCheck(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                  Only the {bad.length} to check
                </label>
              )}
            </div>
            <audio ref={audio} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)} className="hidden" />
            <ol className="mt-6 divide-y divide-hairline border-y border-hairline">
              {shown.map((l) => {
                const q = QUALITY[l.quality.status];
                return (
                  <li key={l.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-x-4 gap-y-1 py-3 sm:grid-cols-[3.5rem_auto_1fr_5.5rem_auto]">
                    <span className="tabular pt-1 text-sm font-semibold">{l.id}</span>
                    <button type="button" onClick={() => play(l.file, l.id)} aria-label={`${playing === l.id ? "Pause" : "Play"} ${l.id}`} className={`${button.quiet} !size-9 !p-0`}>
                      {playing === l.id ? <Pause aria-hidden size={16} /> : <Play aria-hidden size={16} />}
                    </button>
                    <div className="min-w-0">
                      <p className="text-[0.9375rem]">{l.text}</p>
                      {l.quality.status !== "ok" && <p className="mt-1 text-xs text-muted">{l.quality.issues[0]}{l.quality.heard ? <span className="text-faint"> · heard "{l.quality.heard.toLowerCase()}"</span> : null}</p>}
                    </div>
                    <span className="col-start-3 row-start-2 text-xs sm:col-start-4 sm:row-start-1 sm:pt-1">
                      <span className={`font-semibold ${q.tone}`}>{q.word}</span>
                      <span className="tabular block text-faint">{l.duration.toFixed(1)} s · energy {l.energy}</span>
                    </span>
                    <button type="button" disabled={busy} onClick={() => act(`/projects/${p.id}/voice`, { line: l.id })} className={`${button.quiet} col-start-3 row-start-2 justify-self-end sm:col-start-5 sm:row-start-1`}>
                      <RotateCcw aria-hidden size={14} />
                      Retake{l.retake ? " again" : ""}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
