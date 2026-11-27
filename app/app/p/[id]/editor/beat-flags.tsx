"use client";
import { Flag, X } from "lucide-react";
import { useState } from "react";
import type { Timeline, TimelineLine } from "@/lib/editor";
import { Section, small, textField } from "./bits";
import { timecode } from "./timeline";

/**
 * A beat in plain words, at the playhead. Claude writes the shots and, when
 * the beat needs narration, one new line; only that line is voiced and the
 * scenes after it move by whole frames.
 */
export function BeatPanel({ t, line, busy, onSend, onClose }: { t: Timeline; line: TimelineLine | undefined; busy: boolean; onSend: (beat: string, where: { after: string } | { before: string }) => Promise<boolean>; onClose: () => void }) {
  const [beat, setBeat] = useState("");
  const [side, setSide] = useState<"after" | "before">("after");
  if (!line) return null;
  return (
    <Section title="Insert a beat at the playhead" aside={<button type="button" onClick={onClose} aria-label="Close" className="grid size-7 place-items-center rounded-md text-faint hover:bg-lifted hover:text-text"><X aria-hidden size={14} /></button>} className="border-t-0 pt-0">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await onSend(beat.trim(), side === "after" ? { after: line.id } : { before: line.id })) setBeat("");
        }}
        className="space-y-3"
      >
        <label htmlFor="beat" className="sr-only">
          The beat
        </label>
        <textarea id="beat" autoFocus value={beat} onChange={(e) => setBeat(e.target.value)} rows={3} maxLength={300} placeholder="Cut to a dog barking at him; he jumps" className={`${textField} resize-none`} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div role="radiogroup" aria-label="Where" className="flex h-8 rounded-md ring-1 ring-inset ring-edge">
            {(["before", "after"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={side === s} onClick={() => setSide(s)} className={`rounded-md px-2.5 text-xs font-semibold ${side === s ? "bg-lifted text-text" : "text-muted hover:text-text"}`}>
                {s}
              </button>
            ))}
          </div>
          <span className="min-w-0 text-muted">
            <span className="font-semibold tabular text-text">{line.id}</span> at {timecode(Math.round(line.offset * t.fps), t.fps)}
          </span>
        </div>
        <p className="line-clamp-2 text-sm text-faint">“{line.text}”</p>
        <div className="flex items-center gap-2">
          <button type="submit" disabled={busy || beat.trim().length < 3} className={small.primary}>
            Ask Claude for the beat
          </button>
          <span className="text-xs text-faint">Esc closes · move the playhead to choose the line</span>
        </div>
      </form>
    </Section>
  );
}

/** Scenes flagged as misgenerated, with what is wrong, sent to Claude in one call. */
export function FlagsPanel({ flags, setFlag, busy, onSend, onJump }: { flags: Record<string, string>; setFlag: (id: string, note: string | null) => void; busy: boolean; onSend: () => void; onJump: (id: string) => void }) {
  const ids = Object.keys(flags).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  if (!ids.length)
    return (
      <div className="space-y-2 text-sm text-muted">
        <p>Nothing flagged.</p>
        <p>
          Watching through and a shot is wrong? Select it and press <kbd className="rounded bg-lifted px-1.5 py-0.5 text-xs font-semibold text-text">F</kbd>, or use “Misgenerated?” under the scene. Collect them here and send them to Claude together: one call fixes them all.
        </p>
      </div>
    );
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {ids.map((id) => (
          <li key={id} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => onJump(id)} className="flex items-center gap-2 rounded-sm text-sm font-semibold hover:text-accent">
                <Flag aria-hidden size={13} className="text-caution" /> {id}
              </button>
              <button type="button" onClick={() => setFlag(id, null)} aria-label={`Unflag ${id}`} className="grid size-7 place-items-center rounded-md text-faint hover:bg-lifted hover:text-text">
                <X aria-hidden size={14} />
              </button>
            </div>
            <label htmlFor={`flag-${id}`} className="sr-only">
              What's wrong with {id}
            </label>
            <input id={`flag-${id}`} value={flags[id]} onChange={(e) => setFlag(id, e.target.value)} maxLength={500} placeholder="What's wrong: the props float, she should be sitting" className={`${textField} h-8 py-0`} />
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3 border-t border-hairline pt-4">
        <button type="button" disabled={busy || ids.length > 12} onClick={onSend} className={small.primary}>
          Send {ids.length} to Claude
        </button>
        <span className="text-xs text-faint">{ids.length > 12 ? "At most 12 per call: unflag some." : "One call. Each scene keeps its lines."}</span>
      </div>
    </div>
  );
}
