"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { NarrativePicker } from "@/components/narrative-picker";
import { button, field } from "@/components/ui";
import type { Beat, DocKind } from "@/lib/documents";

import { approve, askClaude, demote, pasteDocument, type ActionState } from "../actions";

function Problem({ state }: { state: ActionState }) {
  return state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null;
}

/** Approve, or approve anyway: the override takes a deliberate tick and names
 *  what is being overridden (web/PRODUCT.md, principle 4). */
export function ApproveForm({ projectId, kind, artifactId, errors, beats, defaultBeat }: {
  projectId: string; kind: DocKind; artifactId: string; errors: string[];
  beats?: Beat[]; defaultBeat?: string;
}) {
  const [state, action, pending] = useActionState(approve.bind(null, projectId, kind), {});
  const [anyway, setAnyway] = useState(false);
  const invalid = errors.length > 0;
  const noun = kind === "research" ? "research" : "script";
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="artifact" value={artifactId} />
      {beats && (
        <fieldset className="flex flex-col gap-2">
          <legend className="eyebrow mb-2 text-muted">Test the look on</legend>
          <p className="text-xs text-faint">
            Three candidate looks are painted from this beat, and the character in the one you choose appears in every
            shot. Pick a beat that shows the main character clearly.
          </p>
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
            {beats.map((b) => (
              <label key={b.id} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-lifted has-[:checked]:bg-lifted">
                <input type="radio" name="hero_beat" value={b.id} defaultChecked={b.id === defaultBeat} className="mt-1 accent-[var(--color-accent)]" />
                <span><span className="tabular text-faint">{b.id}</span> {b.title || b.visual}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {invalid && (
        <label className="flex items-start gap-2.5 rounded-md bg-danger-wash p-3 text-sm">
          <input type="checkbox" name="anyway" value="yes" checked={anyway} onChange={(e) => setAnyway(e.target.checked)}
            className="mt-0.5 accent-[var(--color-danger)]" />
          <span>
            Approve anyway, past {errors.length === 1 ? "this problem" : `these ${errors.length} problems`}.
            Your name is recorded with the override.
          </span>
        </label>
      )}
      <Problem state={state} />
      <button type="submit" disabled={pending || (invalid && !anyway)} className={button.primary}>
        {pending ? "Approving…" : invalid ? `Approve the ${noun} anyway` : `Approve the ${noun}`}
      </button>
    </form>
  );
}

export function AskClaudeForm({ projectId, kind, again, narrative }: {
  projectId: string; kind: DocKind; again: boolean; narrative?: string | null;
}) {
  const [state, action, pending] = useActionState(askClaude.bind(null, projectId, kind), {});
  const [open, setOpen] = useState(!again);
  const noun = kind === "research" ? "research" : "script";
  if (!open) {
    return (
      <button type="button" className={button.secondary} onClick={() => setOpen(true)}>
        Ask Claude for a new version
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      {kind === "script" && <NarrativePicker defaultValue={narrative} compact={again} />}
      {again && (
        <div className="flex flex-col gap-2">
          <label htmlFor="note" className="eyebrow text-muted">What should change?</label>
          <textarea id="note" name="note" rows={3} className={`${field} text-sm`}
            placeholder={kind === "research" ? "More on food and supply; fewer military details." : "Shorter opening; the beat about rations needs a citation."} />
        </div>
      )}
      <Problem state={state} />
      <button type="submit" disabled={pending} className={again ? button.secondary : button.primary}>
        {pending ? "Asking Claude…" : again ? "Write a new version" : `Have Claude write the ${noun}`}
      </button>
    </form>
  );
}

export function PasteForm({ projectId, kind, cancelHref }: { projectId: string; kind: DocKind; cancelHref: string }) {
  const [state, action, pending] = useActionState(pasteDocument.bind(null, projectId, kind), {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label htmlFor="markdown" className="eyebrow text-muted">
        Paste the {kind === "research" ? "research" : "script"} document
      </label>
      <textarea id="markdown" name="markdown" required rows={22} spellCheck={false}
        className={`${field} font-mono text-[13px] leading-relaxed`}
        placeholder={kind === "research" ? "---\nproject: …\n---\n\n## Claims\n\n### c1 — …\nclaim: …\nsource: https://…" : "---\nproject: …\n---\n\n## Beats\n\n### B01 — …\nnarration: |\n  …"} />
      <Problem state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={button.primary}>
          {pending ? (kind === "research" ? "Checking every source…" : "Checking…") : "Check and save"}
        </button>
        <Link href={cancelHref} className={button.quiet}>Cancel</Link>
      </div>
    </form>
  );
}

export function DemoteForm({ projectId, to, label }: { projectId: string; to: "staging" | "scripting"; label: string }) {
  const [state, action, pending] = useActionState(demote.bind(null, projectId), {});
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className={button.quiet} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="to" value={to} />
      <label htmlFor={`reason-${to}`} className="eyebrow text-muted">Why go back?</label>
      <input id={`reason-${to}`} name="reason" required className={`${field} text-sm`}
        placeholder="A claim about rations turned out to be wrong" />
      <Problem state={state} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={button.secondary}>{label}</button>
        <button type="button" className={button.quiet} onClick={() => setOpen(false)}>Keep going</button>
      </div>
    </form>
  );
}
