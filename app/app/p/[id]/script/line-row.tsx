"use client";
import type { Beat, ScriptLine, Source } from "@studio/schema";
import type { Finding } from "@studio/story";
import { Lock, LockOpen } from "lucide-react";
import { memo } from "react";
import { ENERGY_WORDS } from "@/lib/tones";

const BEATS: Beat[] = ["stakes", "question", "plant", "turn", "headfake", "rehook"];
const BEAT_WORD: Record<Beat, string> = { stakes: "stakes", question: "question", plant: "plant", turn: "turn", headfake: "head fake", rehook: "rehook" };

const ids = (s: string) => s.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^P\d+$/.test(x));

type Props = {
  line: ScriptLine;
  locked: boolean;
  scriptLocked: boolean;
  selected: boolean;
  findings: Finding[];
  checked: { claim: string; sources: Source[] }[];
  words: number;
  onChange: (id: string, patch: Partial<ScriptLine>) => void;
  onSelect: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
  onNavigate: (id: string, dir: -1 | 1) => void;
};

/**
 * One narration line on the page: id and selection in the gutter, the text
 * (edited in place), energy as five pips, and the delivery note. Beats,
 * plants and payoffs show as words, and become editable while the line has
 * focus. A locked line reads the same but can't be changed.
 */
export const LineRow = memo(function LineRow({ line, locked, scriptLocked, selected, findings, checked, words, onChange, onSelect, onNavigate }: Props) {
  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");
  const ro = locked;

  return (
    <div
      id={line.id}
      data-line={line.id}
      className={`group/line relative grid scroll-mt-28 grid-cols-[4.25rem_minmax(0,1fr)_auto] gap-x-3 rounded-md px-2 py-2 transition-colors duration-150 ${selected ? "bg-select" : "hover:bg-paper-shade/60 focus-within:bg-paper-shade/70"}`}
    >
      {/* gutter */}
      <div className="flex items-start gap-1 pt-1">
        <button
          type="button"
          onMouseDown={(e) => e.shiftKey && e.preventDefault()}
          onClick={(e) => onSelect(line.id, e)}
          aria-pressed={selected}
          aria-label={`${selected ? "Deselect" : "Select"} line ${line.id}`}
          className={`tabular min-h-6 min-w-9 select-none rounded px-1 text-left text-xs font-semibold leading-5 ${selected ? "text-ink" : "text-ink-muted hover:text-ink"}`}
        >
          {line.id}
        </button>
        {!scriptLocked && (
          <button type="button" onClick={() => onChange(line.id, { locked: !line.locked })} aria-label={line.locked ? `Unlock ${line.id}` : `Lock ${line.id}`} aria-pressed={line.locked} className={`mt-0.5 rounded p-0.5 ${line.locked ? "text-ink" : "text-transparent hover:text-ink-muted focus-visible:text-ink-muted group-hover/line:text-paper-edge"}`}>
            {line.locked ? <Lock className="size-3.5" aria-hidden /> : <LockOpen className="size-3.5" aria-hidden />}
          </button>
        )}
        {scriptLocked && <Lock className="mt-1 size-3.5 text-ink-muted" aria-label="locked" />}
      </div>

      {/* text + meta */}
      <div className="min-w-0">
        <label htmlFor={`t-${line.id}`} className="sr-only">Line {line.id}</label>
        <textarea
          id={`t-${line.id}`}
          value={line.text}
          readOnly={ro}
          rows={1}
          spellCheck
          onChange={(e) => onChange(line.id, { text: e.target.value.replace(/\n/g, " ") })}
          onKeyDown={(e) => {
            if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
              e.preventDefault();
              onNavigate(line.id, e.key === "ArrowUp" ? -1 : 1);
            } else if (e.key === "Enter") e.preventDefault();
            else if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
          }}
          className={`block w-full resize-none bg-transparent text-script outline-none [field-sizing:content] ${ro ? "cursor-default text-ink/80" : "text-ink"} ${line.beats.includes("headfake") ? "font-semibold" : ""}`}
        />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <label className="inline-flex items-center gap-1">
            <span className="sr-only">Delivery for {line.id}</span>
            <input
              value={line.delivery}
              readOnly={ro}
              onChange={(e) => onChange(line.id, { delivery: e.target.value })}
              placeholder="delivery"
              size={Math.max(8, line.delivery.length + 1)}
              className="rounded bg-transparent italic text-ink-muted outline-none placeholder:text-ink-muted/60 focus:bg-paper focus:text-ink focus:ring-1 focus:ring-ink-muted"
            />
          </label>
          {/* beats: words at rest, toggles while editing */}
          <span className="hidden flex-wrap gap-1 group-focus-within/line:flex" role="group" aria-label={`Beats of ${line.id}`}>
            {!ro && BEATS.map((b) => {
              const on = line.beats.includes(b);
              return (
                <button key={b} type="button" aria-pressed={on} onClick={() => onChange(line.id, { beats: on ? line.beats.filter((x) => x !== b) : [...line.beats, b] })} className={`rounded px-1.5 py-px ring-1 ring-inset ${on ? "bg-ink text-paper ring-ink" : "ring-ink-muted/50 hover:ring-ink-muted"}`}>
                  {BEAT_WORD[b]}
                </button>
              );
            })}
          </span>
          <span className={`${ro ? "" : "group-focus-within/line:hidden"} flex gap-2`}>
            {line.beats.map((b) => (
              <span key={b} className={`eyebrow ${b === "headfake" || b === "rehook" ? "text-ink" : ""}`}>{BEAT_WORD[b]}</span>
            ))}
            {line.plants.length > 0 && <span className="tabular">plants {line.plants.join(", ")}</span>}
            {line.payoffs.length > 0 && <span className="tabular">pays off {line.payoffs.join(", ")}</span>}
          </span>
          {!ro && (
            <span className="hidden items-center gap-2 group-focus-within/line:inline-flex">
              <label className="tabular">plants <input key={line.plants.join()} defaultValue={line.plants.join(", ")} onBlur={(e) => onChange(line.id, { plants: ids(e.target.value) })} size={6} className="rounded bg-transparent px-1 ring-1 ring-ink-muted/50 focus:outline-none focus:ring-ink-muted" /></label>
              <label className="tabular">pays off <input key={line.payoffs.join()} defaultValue={line.payoffs.join(", ")} onBlur={(e) => onChange(line.id, { payoffs: ids(e.target.value) })} size={6} className="rounded bg-transparent px-1 ring-1 ring-ink-muted/50 focus:outline-none focus:ring-ink-muted" /></label>
            </span>
          )}
          <span className="tabular ml-auto text-ink-muted/80">{words}w</span>
          {checked.length > 0 && (
            <details className="relative">
              <summary className="cursor-pointer list-none text-ok-ink">✓ fact checked</summary>
              <div className="absolute right-0 z-20 mt-1 w-80 rounded-md bg-paper p-3 text-xs text-ink shadow-lg ring-1 ring-paper-edge">
                {checked.map((c, i) => (
                  <p key={i} className="mb-2 last:mb-0">
                    {c.claim}{" "}
                    {c.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="underline decoration-ink-muted underline-offset-2 hover:decoration-ink">{s.title || new URL(s.url).hostname}↗</a>
                    ))}
                  </p>
                ))}
              </div>
            </details>
          )}
          {line.sources.length > 0 && <span className="text-ok-ink">source kept: {line.sources.map((s) => new URL(s.url).hostname).join(", ")}</span>}
        </div>
        {(errors.length > 0 || warnings.length > 0) && (
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {errors.map((f, i) => <li key={`e${i}`} className="text-danger-ink">✗ {f.message}</li>)}
            {warnings.map((f, i) => <li key={`w${i}`} className="text-caution-ink">! {f.message}</li>)}
          </ul>
        )}
      </div>

      {/* energy */}
      <div role="radiogroup" aria-label={`Energy for ${line.id}: ${line.energy} of 5, ${ENERGY_WORDS[line.energy]}`} className="flex items-end gap-0.5 pt-1.5" title={`Energy ${line.energy}: ${ENERGY_WORDS[line.energy]}`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={line.energy === n}
            aria-label={`${n}, ${ENERGY_WORDS[n]}`}
            disabled={ro}
            onClick={() => onChange(line.id, { energy: n })}
            className="flex h-6 w-2.5 items-end disabled:cursor-default"
          >
            <span className={`block w-full rounded-[2px] ${n <= line.energy ? (line.energy === 5 ? "bg-danger-ink" : "bg-ink") : "bg-paper-edge"}`} style={{ height: `${30 + n * 14}%` }} />
          </button>
        ))}
      </div>
    </div>
  );
});
