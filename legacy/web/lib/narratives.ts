/** How a film is told. The ids are pipeline/writer.py NARRATIVES, which holds
 *  what each one asks of Claude; pipeline/selftest.py checks the two lists
 *  agree. Pure data, safe to import from client components. */

export const NARRATIVES = [
  { id: "story", label: "A life", hint: "Follow one person through their days. The facts happen to them." },
  { id: "mystery", label: "A mystery", hint: "Open on a puzzle, reveal the evidence like clues, answer it late." },
  { id: "chronicle", label: "A chronicle", hint: "Events in order, each causing the next, up to a turning point." },
  { id: "you", label: "You are there", hint: "Second person, present tense. The viewer lives it." },
  { id: "explainer", label: "An explainer", hint: "One clear question, answered step by step." },
] as const;

export type NarrativeId = (typeof NARRATIVES)[number]["id"];

export function isNarrative(id: unknown): id is NarrativeId {
  return NARRATIVES.some((n) => n.id === id);
}

export function narrativeLabel(id: string | null | undefined): string | null {
  return NARRATIVES.find((n) => n.id === id)?.label ?? null;
}
