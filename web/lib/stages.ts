/** The project states (pipeline/migrations/001_init.sql) as the studio names
 *  them. Pure data, safe to import from client components. */

export const STAGES = [
  { key: "idea", label: "Idea" },
  { key: "staging", label: "Research" },
  { key: "scripting", label: "Script" },
  { key: "style", label: "Look" },
  { key: "production", label: "Render" },
  { key: "editing", label: "Film" },
  { key: "posted", label: "YouTube" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

/** Index into STAGES. Finalized (asked to publish, not yet up) is still
 *  the film stage; posted is the last. */
export function stageIndex(state: string): number {
  const i = STAGES.findIndex((s) => s.key === (state === "finalized" ? "editing" : state));
  return i === -1 ? STAGES.length - 1 : i;
}

export const DURATIONS = [
  { seconds: 60, label: "1 min", hint: "A short" },
  { seconds: 180, label: "3 min", hint: "The standard" },
  { seconds: 300, label: "5 min", hint: "A deep dive" },
  { seconds: 480, label: "8 min", hint: "Long form" },
  { seconds: 600, label: "10 min", hint: "The full story" },
] as const;
