"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { NarrativePicker } from "@/components/narrative-picker";
import { button, field } from "@/components/ui";
import { DURATIONS } from "@/lib/stages";

import { createFilm, type NewFilmState } from "./actions";

/**
 * The slate. The topic is typed in title-card type because it becomes the
 * film's title everywhere else in the studio.
 */
export function NewFilmForm({ cancel = false }: { cancel?: boolean }) {
  const [state, action, pending] = useActionState<NewFilmState, FormData>(createFilm, {});
  const v = state.values;
  const [duration, setDuration] = useState(v?.duration ?? "180");

  return (
    <form action={action} noValidate className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <label htmlFor="topic" className="eyebrow text-muted">Topic</label>
        <input
          id="topic" name="topic" required autoFocus autoComplete="off" maxLength={140}
          defaultValue={v?.topic} placeholder="How did barbarians live?"
          aria-invalid={!!state.errors?.topic} aria-describedby={state.errors?.topic ? "topic-error" : undefined}
          className={`${field} title-card text-title py-3`}
        />
        {state.errors?.topic && <p id="topic-error" className="text-sm text-danger">{state.errors.topic}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="angle" className="flex items-baseline justify-between gap-4">
          <span className="eyebrow text-muted">Angle</span>
          <span className="text-xs text-faint">Optional</span>
        </label>
        <textarea
          id="angle" name="angle" rows={3} maxLength={600} defaultValue={v?.angle}
          placeholder="Daily life in a northern farmstead, not battles. Who did the work, what they ate, what they feared."
          aria-invalid={!!state.errors?.angle} aria-describedby="angle-hint"
          className={`${field} resize-y leading-relaxed`}
        />
        <p id="angle-hint" className={`text-sm ${state.errors?.angle ? "text-danger" : "text-faint"}`}>
          {state.errors?.angle ?? "Steers the research: what to focus on, and what to leave out."}
        </p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="eyebrow mb-3 text-muted">Length</legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {DURATIONS.map((d) => {
            const on = duration === String(d.seconds);
            return (
              <label key={d.seconds}
                className={"flex cursor-pointer flex-col gap-0.5 rounded-md px-3 py-3 ring-1 ring-inset transition-[box-shadow,background-color] duration-150 ease-out-quart has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent " +
                  (on ? "bg-lifted ring-2 ring-accent" : "ring-edge hover:bg-raised")}>
                <input type="radio" name="duration" value={d.seconds} checked={on}
                  onChange={() => setDuration(String(d.seconds))} className="sr-only" />
                <span className="title-card text-lg">{d.label}</span>
                <span className="text-xs text-muted">{d.hint}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <NarrativePicker defaultValue={v?.narrative} error={state.errors?.narrative} />

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={button.primary}>
          {pending ? "Creating the film…" : "Create film"}
        </button>
        {cancel && <Link href="/" className={button.quiet}>Back to films</Link>}
      </div>
    </form>
  );
}
