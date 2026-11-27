import type { StageState, StepKey } from "@studio/schema";

/** The nine steps of docs/PLAN.md section 2, each wrapping a route. Story and script keep the Phase 2 routes. */
export const STEPS: { key: StepKey; n: number; label: string; path: string; who: "You" | "Claude" | "Local" }[] = [
  { key: "brief", n: 1, label: "Brief", path: "/brief", who: "You" },
  { key: "story", n: 2, label: "Story", path: "", who: "Claude" },
  { key: "review", n: 3, label: "Review", path: "/review", who: "Claude" },
  { key: "script", n: 4, label: "Script", path: "/script", who: "You" },
  { key: "voice", n: 5, label: "Voice", path: "/voice", who: "Local" },
  { key: "storyboard", n: 6, label: "Storyboard", path: "/storyboard", who: "Claude" },
  { key: "render", n: 7, label: "Render", path: "/render", who: "Local" },
  { key: "editor", n: 8, label: "Editor", path: "/editor", who: "You" },
  { key: "export", n: 9, label: "Export", path: "/export", who: "Local" },
];

export const stepOf = (key: StepKey) => STEPS.find((s) => s.key === key)!;
export const stepHref = (id: string, key: StepKey) => `/p/${id}${stepOf(key).path}`;

/** A word for every state: the colour is never the only signal. */
export function stageWord(s: Pick<StageState, "status" | "stale">): string {
  if (s.status === "done" && s.stale) return "Out of date";
  return { waiting: "Waiting", running: "Running", needs_you: "Needs you", done: "Done" }[s.status];
}
