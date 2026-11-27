"use client";
import { PipelineState, type StageState } from "@studio/schema";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@/lib/api";
import { STEPS, stageWord, stepHref } from "@/lib/steps";
import { useJobs } from "@/lib/use-jobs";
import { StatusMark } from "./status";

/**
 * The nine steps as a strip (after legacy/web/components/stage-strip.tsx, which
 * had seven): a bar per step, its number and name, and a word for its state.
 * Done is a solid bar; out of date is hatched; running sweeps; needs you is
 * the accent; waiting is an outline. Any step can be opened, finished or not:
 * a step that can't start yet says what it is waiting for.
 */
function Bar({ stage }: { stage: StageState }) {
  const stale = stage.status === "done" && stage.stale;
  if (stale) return <span aria-hidden className="block h-1 rounded-full" style={{ background: "repeating-linear-gradient(135deg, var(--color-caution) 0 4px, transparent 4px 8px)" }} />;
  if (stage.status === "running") {
    return (
      <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-lifted">
        <span className="block h-full w-2/5 rounded-full bg-accent" style={{ animation: "sweep 1.8s var(--ease-out-quart) infinite" }} />
      </span>
    );
  }
  const fill = { done: "bg-muted", needs_you: "bg-accent", waiting: "bg-hairline", running: "" }[stage.status];
  return <span aria-hidden className={`block h-1 rounded-full ${fill}`} />;
}

export function Stepper({ id, initial, title }: { id: string; initial: PipelineState; title: string }) {
  const pathname = usePathname();
  const [state, setState] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reload = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      call(`/projects/${id}/pipeline`, PipelineState)
        .then(setState)
        .catch(() => {});
    }, 250);
  }, [id]);

  const { jobs } = useJobs(id, reload);
  const jobKey = jobs.map((j) => `${j.id}:${j.status}`).join(",");
  // reload when a job starts or ends, when the user acts anywhere in the app, when the route changes, and when the tab comes back
  useEffect(reload, [jobKey, pathname, reload]);
  useEffect(() => {
    window.addEventListener("studio:changed", reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("studio:changed", reload);
      window.removeEventListener("focus", reload);
      clearTimeout(timer.current);
    };
  }, [reload]);

  const base = `/p/${id}`;
  const onCast = pathname === `${base}/cast`;
  return (
    <div className="border-b border-hairline bg-raised/50">
      <div className="mx-auto max-w-[1440px] px-6 pb-3 pt-3">
        <div className="mb-3 flex items-baseline justify-between gap-6">
          <p className="min-w-0 truncate text-sm text-muted">{title}</p>
          <Link href={`${base}/cast`} aria-current={onCast ? "page" : undefined} className={`shrink-0 rounded-md px-2.5 py-1 text-sm font-semibold hover:bg-lifted ${onCast ? "text-text underline decoration-accent decoration-2 underline-offset-[6px]" : "text-muted hover:text-text"}`}>
            Cast
          </Link>
        </div>
        <nav aria-label="Steps">
          <ol className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:grid lg:grid-cols-9 lg:overflow-visible lg:pb-0">
            {STEPS.map((s) => {
              const stage = state.stages.find((x) => x.key === s.key)!;
              const href = stepHref(id, s.key);
              const current = s.path === "" ? pathname === base : pathname.startsWith(href);
              return (
                <li key={s.key} className="min-w-[8.25rem] flex-1 lg:min-w-0">
                  <Link href={href} aria-current={current ? "step" : undefined} title={stage.note} className={`group block rounded-md px-1.5 pb-2 pt-1.5 hover:bg-lifted ${current ? "bg-lifted" : ""}`}>
                    <Bar stage={stage} />
                    <span className="mt-2 flex items-baseline gap-1.5">
                      <span className="tabular text-xs text-faint">{s.n}</span>
                      <span className={`truncate text-sm font-semibold ${current ? "text-text" : "text-muted group-hover:text-text"}`}>{s.label}</span>
                    </span>
                    <StatusMark stage={stage} className="mt-0.5 text-xs" />
                    <span className="sr-only">. {stage.note}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
        <p role="status" className="sr-only">
          {state.stages.map((s) => `${STEPS.find((x) => x.key === s.key)!.label}: ${stageWord(s)}`).join(". ")}
        </p>
      </div>
    </div>
  );
}
