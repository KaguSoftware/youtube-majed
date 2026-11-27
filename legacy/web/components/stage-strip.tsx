import { STAGES, stageIndex } from "@/lib/stages";

/**
 * The project's place in the pipeline, as a strip of stages (after DaVinci
 * Resolve's page tabs). Finished stages are solid, the current one carries
 * the accent, later ones are outlines. Each state also has a word, so
 * nothing depends on colour alone.
 */
export function StageStrip({ state, size = "compact" }: { state: string; size?: "compact" | "full" }) {
  const current = stageIndex(state);
  const label = `Stage ${current + 1} of ${STAGES.length}: ${STAGES[current].label}`;

  if (size === "compact") {
    return (
      <div className="flex flex-col gap-1.5" role="img" aria-label={label}>
        <div className="flex gap-1">
          {STAGES.map((s, i) => (
            <span
              key={s.key}
              className={
                "h-1.5 w-6 rounded-full " +
                (i < current ? "bg-muted" : i === current ? "bg-accent" : "ring-1 ring-inset ring-hairline")
              }
            />
          ))}
        </div>
        <span className="eyebrow text-muted">{STAGES[current].label}</span>
      </div>
    );
  }

  return (
    <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(0, 1fr))` }} aria-label="Stages">
      {STAGES.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={s.key} aria-current={now ? "step" : undefined} className="flex flex-col gap-2">
            <span
              className={
                "h-1 rounded-full " + (done ? "bg-muted" : now ? "bg-accent" : "bg-hairline")
              }
            />
            <span className={"eyebrow truncate " + (now ? "text-accent" : done ? "text-muted" : "text-faint")}>
              {s.label}
              <span className="sr-only">{done ? " (done)" : now ? " (current)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
