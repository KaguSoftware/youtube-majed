"use client";

import { useState } from "react";

import { NARRATIVES } from "@/lib/narratives";

/**
 * How the film is told. Required: without a choice Claude's scripts come back
 * as lessons, facts in order. Same selection vocabulary as the Length picker.
 */
export function NarrativePicker({ defaultValue, error, compact = false }: {
  defaultValue?: string | null; error?: string; compact?: boolean;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={error ? "narrative-error" : undefined}>
      <legend className="eyebrow mb-3 text-muted">How it&rsquo;s told</legend>
      <div className="flex flex-col gap-1.5">
        {NARRATIVES.map((n) => {
          const on = value === n.id;
          return (
            <label key={n.id}
              className={"flex cursor-pointer flex-col gap-0.5 rounded-md ring-1 ring-inset transition-[box-shadow,background-color] duration-150 ease-out-quart has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent " +
                (compact ? "px-3 py-2 " : "px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4 ") +
                (on ? "bg-lifted ring-2 ring-accent" : error ? "ring-danger hover:bg-raised" : "ring-edge hover:bg-raised")}>
              <input type="radio" name="narrative" value={n.id} required checked={on}
                onChange={() => setValue(n.id)} className="sr-only" />
              <span className={`title-card shrink-0 ${compact ? "text-base" : "text-lg sm:w-36"}`}>{n.label}</span>
              <span className={`text-muted ${compact ? "text-xs" : "text-sm"}`}>{n.hint}</span>
            </label>
          );
        })}
      </div>
      {error && <p id="narrative-error" className="text-sm text-danger">{error}</p>}
    </fieldset>
  );
}
