"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Ev = { id: string; attempt: number; kind: string; data: Record<string, unknown>; at: string; url?: string };

const STAGES = [
  { key: "validate", label: "Checking the documents" },
  { key: "narrate", label: "Recording the narration" },
  { key: "align", label: "Timing every word" },
  { key: "plan", label: "Planning the shots" },
  { key: "images", label: "Painting the frames" },
  { key: "render", label: "Cutting the film" },
];

/** Measured median per image with the character crop (HANDOFF.md 3). */
const SECONDS_PER_IMAGE = 15.3;

/**
 * The render, live: stages as they pass and frames as they are painted
 * (web/PRODUCT.md principle 3: make the wait feel like progress). Fed by
 * /api/films/[id]/events; EventSource reconnects itself when each stream
 * closes, resuming from the last event id.
 */
export function Progress({ projectId, totalHint }: { projectId: string; totalHint: number }) {
  const router = useRouter();
  const [events, setEvents] = useState<Ev[]>([]);
  useEffect(() => {
    const es = new EventSource(`/api/films/${projectId}/events`);
    es.addEventListener("progress", (m) => {
      const ev = JSON.parse((m as MessageEvent).data) as Ev;
      setEvents((prev) => (prev.some((e) => e.id === ev.id) ? prev : [...prev, ev]));
      if (ev.kind === "done" || ev.kind === "failed") setTimeout(() => router.refresh(), 800);
    });
    es.addEventListener("end", () => es.close());
    return () => es.close();
  }, [projectId, router]);

  const view = useMemo(() => {
    const attempt = Math.max(0, ...events.map((e) => e.attempt));
    const mine = events.filter((e) => e.attempt === attempt);
    const stage = [...mine].reverse().find((e) => e.kind === "stage")?.data.stage as string | undefined;
    const shots = new Map<string, Ev>();
    for (const e of mine) if (e.kind === "shot") shots.set(String(e.data.shot), e);
    const plan = [...events].reverse().find((e) => e.kind === "stage" && e.data.stage === "images");
    const outcome = [...mine].reverse().find((e) => ["done", "failed", "released", "error"].includes(e.kind));
    return { attempt, stage, shots: [...shots.values()], plan, outcome };
  }, [events]);

  const total = Math.max(totalHint, view.shots.length);
  const left = Math.max(0, total - view.shots.length);
  const stageIdx = STAGES.findIndex((s) => s.key === view.stage);

  return (
    <div className="flex flex-col gap-8">
      <ol className="grid gap-2 sm:grid-cols-6" aria-label="Render stages">
        {STAGES.map((s, i) => {
          const done = stageIdx > i || view.outcome?.kind === "done";
          const now = stageIdx === i && !view.outcome;
          return (
            <li key={s.key} aria-current={now ? "step" : undefined} className="flex flex-col gap-2">
              <span className={"h-1 rounded-full " + (done ? "bg-muted" : now ? "bg-accent" : "bg-hairline")} />
              <span className={"text-xs " + (now ? "text-text" : done ? "text-muted" : "text-faint")}>{s.label}</span>
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-muted" aria-live="polite">
        {view.outcome?.kind === "failed" ? "The render stopped. Details below."
          : view.stage === "images" ? `${view.shots.length} of ${total} frames painted. About ${Math.ceil((left * SECONDS_PER_IMAGE) / 60)} minutes to go.`
          : view.stage === "render" ? "All frames painted. Cutting the film now, under a minute."
          : events.length === 0 ? "Connecting to the studio machine…" : "Getting ready to paint. The frames appear here as they are made."}
        {view.attempt > 1 && " Resumed after an interruption; finished frames were kept."}
      </p>
      {total > 0 && (
        <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-6">
          {Array.from({ length: total }, (_, i) => {
            const shot = view.shots[i];
            return (
              <li key={i} className="relative overflow-hidden rounded-sm bg-raised">
                {shot?.url
                  // eslint-disable-next-line @next/next/no-img-element -- presigned media
                  ? <img src={shot.url} alt={`Frame ${i + 1}`} className="aspect-[832/480] w-full object-cover motion-safe:animate-[fadein_400ms_var(--ease-out-quart)]" />
                  : <div className={"aspect-[832/480] w-full " + (i === view.shots.length && view.stage === "images" ? "animate-pulse bg-lifted" : "")} />}
                <span className="tabular absolute bottom-1 left-1.5 text-[10px] text-text/80 drop-shadow">{String(i + 1).padStart(2, "0")}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
