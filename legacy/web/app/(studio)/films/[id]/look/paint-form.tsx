"use client";

import { useActionState } from "react";

import { button, field } from "@/components/ui";
import type { Beat } from "@/lib/documents";

import { paintLooks } from "./actions";
import type { ActionState } from "../actions";

export function PaintForm({ projectId, presets, beats, heroBeat, prefix, again }: {
  projectId: string; presets: { id: string; name: string; prefix: string }[]; beats: Beat[];
  heroBeat: string | null; prefix: string; again: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(paintLooks.bind(null, projectId), {});
  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="preset" value={presets[0]?.id ?? ""} />
      <div className="flex flex-col gap-2">
        <label htmlFor="prompt_prefix" className="eyebrow text-muted">
          The look{presets[0] ? `: starting from ${presets[0].name.toLowerCase()}` : ""}
        </label>
        <textarea id="prompt_prefix" name="prompt_prefix" rows={2} defaultValue={prefix} className={`${field} leading-relaxed`} />
        <p className="text-sm text-faint">
          Describe the look itself, not an instruction: the painter does not take orders. For example
          &ldquo;loose black ink doodles on white paper, stick figures, no shading&rdquo; rather than
          &ldquo;make it doodles&rdquo;. It opens and closes every image prompt in the film.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="beat" className="eyebrow text-muted">Paint it on</label>
        <select id="beat" name="beat" defaultValue={heroBeat ?? undefined} className={`${field} text-sm`}>
          {beats.map((b) => <option key={b.id} value={b.id}>{b.id}: {b.title || b.visual.slice(0, 80)}</option>)}
        </select>
        <p className="text-sm text-faint">
          Every candidate paints the same beat, so they differ only in look. Choose one that shows the main character: you
          will frame that character next, and every shot is painted with them.
        </p>
      </div>
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className={`${again ? button.secondary : button.primary} self-start`}>
        {pending ? "Starting…" : again ? "Paint three more" : "Paint three looks"}
      </button>
    </form>
  );
}
