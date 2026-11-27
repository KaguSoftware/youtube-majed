"use client";
import { DEFAULT_WPM, FORMAT_MINUTES, NARRATIVES, wordBudget, type NarrativeId } from "@studio/schema";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { z } from "zod";
import { button, field, hint, label } from "@/components/ui";
import { call, Job } from "@/lib/api";
import { minutesLabel } from "@/lib/format";

const LENGTHS = { youtube: [5, 8, 10, 12], reel: [1, 1.25, 1.5] } as const;
const Created = z.object({ brief: z.object({ id: z.string() }).loose(), job: Job });

export function BriefForm() {
  const router = useRouter();
  const ids = { sentence: useId(), notes: useId(), err: useId() };
  const [sentence, setSentence] = useState("");
  const [narrative, setNarrative] = useState<NarrativeId>("mystery");
  const [format, setFormat] = useState<"youtube" | "reel">("youtube");
  const [minutes, setMinutes] = useState(8);
  const [factual, setFactual] = useState<boolean>(NARRATIVES.mystery.factual);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = sentence.trim().length < 8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (tooShort) return setError("Write at least a few words: who, and what happens.");
    setBusy(true);
    setError(null);
    try {
      const r = await call("/projects", Created, { body: { sentence: sentence.trim(), narrative, format, minutes, factual, ...(notes.trim() ? { notes: notes.trim() } : {}) } });
      router.push(`/p/${r.brief.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-10 space-y-10" noValidate>
      <div>
        <label htmlFor={ids.sentence} className="sr-only">
          The premise, in one sentence
        </label>
        <textarea
          id={ids.sentence}
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          rows={3}
          autoFocus
          placeholder="A night-shift elevator repairman keeps getting calls from the thirteenth floor of a building that doesn't have one."
          aria-invalid={Boolean(error) && tooShort}
          aria-describedby={error ? ids.err : undefined}
          className={`${field} resize-none text-lg leading-relaxed`}
        />
        <p className={`${hint} mt-2`}>One sentence. A premise, a true event or a "what if". Claude turns it into three different stories.</p>
      </div>

      <fieldset>
        <legend className={label}>How it's told</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup">
          {(Object.entries(NARRATIVES) as [NarrativeId, (typeof NARRATIVES)[NarrativeId]][]).map(([id, n]) => (
            <label key={id} className={`cursor-pointer rounded-md px-3.5 py-3 ring-1 ring-inset transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${narrative === id ? "bg-lifted ring-accent" : "ring-hairline hover:bg-raised"}`}>
              <input type="radio" name="narrative" value={id} checked={narrative === id} onChange={() => { setNarrative(id); setFactual(n.factual); }} className="sr-only" />
              <span className="flex items-center justify-between text-sm font-semibold text-text">
                {n.label}
                {n.factual && <span className="eyebrow text-faint">fact-checked</span>}
              </span>
              <span className="mt-1 block text-xs leading-snug text-muted">{n.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-8 sm:grid-cols-2">
        <fieldset>
          <legend className={label}>Format</legend>
          <div className="mt-3 inline-flex rounded-md bg-raised p-1 ring-1 ring-inset ring-hairline">
            {(["youtube", "reel"] as const).map((f) => (
              <label key={f} className={`cursor-pointer rounded px-4 py-1.5 text-sm font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${format === f ? "bg-lifted text-text" : "text-muted hover:text-text"}`}>
                <input type="radio" name="format" value={f} checked={format === f} onChange={() => { setFormat(f); setMinutes(f === "reel" ? 1.25 : 8); }} className="sr-only" />
                {f === "youtube" ? "YouTube 16:9" : "Reel 9:16"}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className={label}>Length</legend>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {LENGTHS[format].map((m) => (
              <label key={m} className={`tabular cursor-pointer rounded-md px-3 py-1.5 text-sm font-semibold ring-1 ring-inset has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${minutes === m ? "bg-lifted text-text ring-accent" : "text-muted ring-hairline hover:text-text"}`}>
                <input type="radio" name="minutes" value={m} checked={minutes === m} onChange={() => setMinutes(m)} className="sr-only" />
                {minutesLabel(m)}
              </label>
            ))}
            <span className="tabular ml-1 text-sm text-faint">≈ {wordBudget(minutes, DEFAULT_WPM).toLocaleString("en-GB")} words at {DEFAULT_WPM} wpm</span>
          </div>
          <p className="mt-2 text-xs text-faint">
            {format === "reel" ? `Reels run ${FORMAT_MINUTES.reel.min * 60}–${FORMAT_MINUTES.reel.max * 60} s: one master loop, two or three micro loops.` : "One chapter loop every 45–90 seconds."}
          </p>
        </fieldset>
      </div>

      <fieldset>
        <legend className={label}>Is it true?</legend>
        <div className="mt-3 flex flex-wrap gap-6 text-sm">
          {[
            { v: true, t: "A true story", d: "Every claim is checked on the web, with sources." },
            { v: false, t: "Fiction", d: "Checked for consistency: names, timeline, world rules." },
          ].map((o) => (
            <label key={String(o.v)} className="flex max-w-xs cursor-pointer gap-3">
              <input type="radio" name="factual" checked={factual === o.v} onChange={() => setFactual(o.v)} className="mt-1 accent-[var(--color-accent)]" />
              <span>
                <span className="font-semibold text-text">{o.t}</span>
                <span className="block text-muted">{o.d}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={ids.notes} className={label}>
          Direction for the writer <span className="font-normal text-faint">(optional)</span>
        </label>
        <textarea id={ids.notes} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Tone, audience, a detail it must include." className={`${field} mt-2 resize-y`} />
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-hairline pt-8">
        <button type="submit" disabled={busy} className={button.primary}>
          {busy ? "Starting…" : "Write three options"}
        </button>
        <span className="text-sm text-faint">Usually under a minute.</span>
        {error && (
          <p id={ids.err} role="alert" className="w-full text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
