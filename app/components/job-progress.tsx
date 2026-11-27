"use client";
import { useEffect, useState } from "react";
import type { Job } from "@/lib/api";
import { clock } from "@/lib/format";

const STEP_WORDS: Record<string, string> = {
  options: "Claude is writing three master loop options",
  loopmap: "Claude is mapping the loops",
  narration: "Claude is writing the narration",
  rewrite: "Claude is rewriting",
  factcheck: "The fact-checker is checking",
  critic: "The critic is reading",
  cast: "Claude is casting the characters and choosing the places",
  storyboard: "Claude is planning the scenes",
  regenerate: "Claude is drawing up new versions of the scene",
  beat: "Claude is writing the beat",
  fixscenes: "Claude is fixing the flagged scenes",
};

/**
 * What Claude is doing right now, with elapsed time against the usual time
 * for that step (the median of past runs). Determinate when there is an
 * estimate, a slow sweep when there isn't. Leaves the page usable.
 */
export function JobProgress({ jobs, onCancel }: { jobs: Job[]; onCancel?: (job: Job) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!jobs.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [jobs.length]);
  if (!jobs.length) return null;

  return (
    <div role="status" aria-live="polite" className="space-y-3">
      {jobs.map((job) => {
        const running = Object.entries(job.steps).filter(([, s]) => s?.phase === "running");
        if (job.status === "running" && job.progress) return <LocalProgress key={job.id} job={job} now={now} onCancel={onCancel} />;
        if (job.status !== "running" || !running.length) {
          return (
            <div key={job.id} className="flex items-baseline justify-between gap-4 text-sm">
              <span className="text-muted">{job.status === "waiting" ? "Waiting for another job on this machine to finish" : `Queued: ${job.label}`}</span>
              {onCancel && (
                <button type="button" onClick={() => onCancel(job)} className="text-faint underline-offset-2 hover:text-text hover:underline">
                  Cancel
                </button>
              )}
            </div>
          );
        }
        return running.map(([step, s]) => {
          const elapsed = (now - s!.startedAt) / 1000;
          const est = s!.estimateMs ? s!.estimateMs / 1000 : undefined;
          const pct = est ? Math.min(0.95, elapsed / est) : undefined;
          return (
            <div key={job.id + step}>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="font-semibold text-text">
                  <span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-accent align-middle" />
                  {STEP_WORDS[step] ?? job.label}
                  {s!.attempt > 1 && <span className="font-normal text-caution"> · retrying once, the first answer failed validation</span>}
                </span>
                <span className="tabular shrink-0 text-muted">
                  {clock(elapsed)}
                  {est ? <span className="text-faint"> of about {clock(est)}</span> : null}
                  {onCancel && (
                    <button type="button" onClick={() => onCancel(job)} className="ml-3 text-faint underline-offset-2 hover:text-text hover:underline">
                      Cancel
                    </button>
                  )}
                </span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-lifted" aria-hidden>
                {pct !== undefined ? (
                  <div className="h-full origin-left rounded-full bg-accent transition-transform duration-1000 ease-linear" style={{ transform: `scaleX(${pct})` }} />
                ) : (
                  <div className="h-full w-2/5 rounded-full bg-accent/70" style={{ animation: "sweep 1.8s var(--ease-out-quart) infinite" }} />
                )}
              </div>
            </div>
          );
        });
      })}
    </div>
  );
}

/** voice, mix, render and export know how far along they are: a real bar, what it is doing, and the time left once there is enough to say. */
function LocalProgress({ job, now, onCancel }: { job: Job; now: number; onCancel?: (job: Job) => void }) {
  const p = job.progress!;
  const frac = p.total ? Math.min(1, p.done / p.total) : 0;
  const elapsed = (now - (job.startedAt ?? now)) / 1000;
  const left = frac > 0.04 ? (elapsed / frac) * (1 - frac) : undefined;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="min-w-0 font-semibold text-text">
          <span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-accent align-middle" />
          {p.label}
          {p.detail && <span className="font-normal text-muted"> · {p.detail}</span>}
        </span>
        <span className="tabular shrink-0 text-muted">
          {Math.round(frac * 100)}% · {clock(elapsed)}
          {left !== undefined && <span className="text-faint"> · about {clock(left)} left</span>}
          {onCancel && (
            <button type="button" onClick={() => onCancel(job)} className="ml-3 text-faint underline-offset-2 hover:text-text hover:underline">
              Cancel
            </button>
          )}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-lifted" role="progressbar" aria-label={p.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
        <div className="h-full origin-left rounded-full bg-accent transition-transform duration-500 ease-linear" style={{ transform: `scaleX(${frac})` }} />
      </div>
    </div>
  );
}

export function JobError({ job }: { job: Job | undefined }) {
  if (!job || job.status !== "failed") return null;
  const limit = /usage limit|did not run/i.test(job.error ?? "");
  return (
    <div role="alert" className="rounded-md bg-danger-wash px-4 py-3 text-sm text-text ring-1 ring-inset ring-danger/40">
      <p className="font-semibold">{limit ? "Claude didn't run" : "That step failed"}: {job.label}</p>
      <p className="mt-1 whitespace-pre-wrap text-muted">{job.error}</p>
      <p className="mt-1 text-muted">{limit ? "Nothing was saved. Try again when the limit resets." : "Nothing was overwritten. Run it again; finished steps are skipped."}</p>
    </div>
  );
}
