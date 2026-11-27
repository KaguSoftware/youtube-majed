"use client";
import { FX_PRESETS, type EditOpIn, type FxPreset, type Line } from "@studio/schema";
import { Pause, Play, Plus, Scissors, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { sfxAudioUrl, type SfxEntry, type Timeline, type TimelineLine } from "@/lib/editor";
import { Pips, Section, small, textField } from "./bits";
import { timecode } from "./timeline";
import { wordRef } from "./model";

const nice = (id: string) => id.replaceAll("_", " ");
const PRESETS = Object.keys(FX_PRESETS) as FxPreset[];

type Common = { t: Timeline; busy: boolean; submit: (ops: EditOpIn[], label?: string) => Promise<boolean>; sfx: SfxEntry[] | null; loadSfx: () => void };

/**
 * A narration line. Text, energy and delivery re-voice only this line (its
 * scene stretches, later scenes move by whole frames). Pick a word to put a
 * sound effect on it, or a voice effect on that word alone.
 */
export function LinePanel({ t, line, script, word, setWord, busy, submit, sfx, loadSfx }: Common & { line: TimelineLine; script: Line; word: number | undefined; setWord: (w: number | undefined) => void }) {
  const [text, setText] = useState(script.text);
  const [energy, setEnergy] = useState(script.energy);
  const [delivery, setDelivery] = useState(script.delivery);
  const [cut, setCut] = useState(false);
  useEffect(() => {
    setText(script.text);
    setEnergy(script.energy);
    setDelivery(script.delivery);
    setCut(false);
  }, [script]);
  const scene = t.scenes.find((s) => s.lineIds.includes(line.id));
  const change: EditOpIn | null = useMemo(() => {
    const op: Record<string, unknown> = { op: "line.set", line: line.id };
    if (text.trim() !== script.text) op.text = text.trim();
    if (energy !== script.energy) op.energy = energy;
    if (delivery !== script.delivery) op.delivery = delivery;
    return Object.keys(op).length > 2 ? (op as EditOpIn) : null;
  }, [text, energy, delivery, script, line.id]);
  const revoice = change && ("text" in change || "energy" in change);
  const lineFx = line.fx.find((f) => f.word === undefined)?.preset;

  return (
    <div className="space-y-5">
      <header>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
          <span className="title-card text-title leading-none text-text">{line.id}</span>
          <span className="tabular">{line.duration.toFixed(1)} s</span>
          <span>·</span>
          <span className="tabular">at {timecode(Math.round(line.offset * t.fps), t.fps)}</span>
          {scene && <span>· in {scene.id}</span>}
        </p>
      </header>

      <Section title="The line">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (change) void submit([change]);
          }}
        >
          <div>
            <label htmlFor="line-text" className="sr-only">
              Text of {line.id}
            </label>
            <textarea id="line-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={300} className="paper w-full resize-none rounded-md px-3 py-2.5 text-script ring-1 ring-inset ring-ink-muted placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ink" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Pips value={energy} onChange={setEnergy} />
            <button type="button" disabled={busy} onClick={() => void submit([{ op: "line.set", line: line.id, seed: Math.floor(Math.random() * 1_000_000) }], `${line.id}: another take`)} className={small.quiet} title="Same text, a new take">
              Another take
            </button>
          </div>
          <div>
            <label htmlFor="line-delivery" className="text-xs font-semibold text-muted">
              Delivery
            </label>
            <input id="line-delivery" value={delivery} onChange={(e) => setDelivery(e.target.value)} maxLength={120} placeholder="hushed, then a beat before the last word" className={`${textField} mt-1 h-8 py-0`} />
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={!change || busy} className={small.primary}>
              {revoice ? `Re-voice ${line.id}` : "Save"}
            </button>
            {change && (
              <button
                type="button"
                onClick={() => {
                  setText(script.text);
                  setEnergy(script.energy);
                  setDelivery(script.delivery);
                }}
                className={small.quiet}
              >
                Reset
              </button>
            )}
            <span className="ml-auto text-xs text-faint">{revoice ? "Only this line is voiced again" : change ? "No new take needed" : ""}</span>
          </div>
        </form>
      </Section>

      <Section title="Voice effect on the whole line">
        <FxChoice label={`Voice effect on ${line.id}`} current={lineFx} busy={busy} onPick={(p) => void submit([{ op: "fx", line: line.id, preset: p }], p === "none" ? `${line.id}: no voice effect` : `${line.id}: ${nice(p)}`)} />
      </Section>

      <Section title="Words" aside={<span className="text-xs text-faint">pick one for a sound or an effect</span>}>
        <div className="flex flex-wrap gap-1" role="listbox" aria-label={`Words of ${line.id}`}>
          {line.words.map((w, j) => {
            const fx = line.fx.find((f) => f.word === j);
            const hasSfx = scene?.sfx.some((s) => s.at === wordRef(line.id, j));
            return (
              <button
                key={j}
                type="button"
                role="option"
                aria-selected={word === j}
                onClick={() => setWord(word === j ? undefined : j)}
                className={`relative rounded-sm px-1.5 py-0.5 text-sm transition-colors duration-150 ${word === j ? "bg-accent text-accent-ink" : fx ? "bg-accent/15 text-accent hover:bg-accent/25" : "text-text hover:bg-lifted"}`}
                title={fx ? `voice effect: ${nice(fx.preset)}` : undefined}
              >
                {w.text}
                {hasSfx && <span aria-label=", has a sound effect" className={`absolute -top-0.5 right-0 size-1.5 rotate-45 ${word === j ? "bg-accent-ink" : "bg-accent"}`} />}
              </button>
            );
          })}
        </div>
        {word !== undefined && line.words[word] && scene && <WordTools t={t} line={line} word={word} sceneId={scene.id} busy={busy} submit={submit} sfx={sfx} loadSfx={loadSfx} />}
      </Section>

      <Section title="Cut">
        {!cut ? (
          <button type="button" disabled={busy} onClick={() => setCut(true)} className={small.danger}>
            <Scissors aria-hidden size={14} /> Cut {line.id} from the video…
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-danger-wash/60 p-3 ring-1 ring-inset ring-danger/40">
            <p className="w-full text-sm">The narration loses this line; a scene left with no line goes too.</p>
            <button type="button" autoFocus onClick={() => void submit([{ op: "line.delete", line: line.id }], `${line.id} cut`)} className={small.danger}>
              <Trash2 aria-hidden size={14} /> Cut it
            </button>
            <button type="button" onClick={() => setCut(false)} className={small.quiet}>
              Cancel
            </button>
          </div>
        )}
      </Section>
    </div>
  );
}

function FxChoice({ current, busy, onPick, label }: { current: FxPreset | undefined; busy: boolean; onPick: (p: FxPreset | "none") => void; label: string }) {
  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {(["none", ...PRESETS] as const).map((p) => {
          const on = (current ?? "none") === p;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy || on}
              onClick={() => onPick(p)}
              title={p === "none" ? "No effect" : FX_PRESETS[p]}
              className={`h-7 rounded-full px-2.5 text-xs font-semibold transition-colors duration-150 disabled:cursor-default ${on ? "bg-text text-room" : "text-muted ring-1 ring-inset ring-edge hover:bg-lifted hover:text-text disabled:opacity-50"}`}
            >
              {nice(p)}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-faint">Applies at once. The track is rebuilt; nothing is redrawn.</p>
    </div>
  );
}

function WordTools({ t, line, word, sceneId, busy, submit, sfx, loadSfx }: Common & { line: TimelineLine; word: number; sceneId: string }) {
  const ref = wordRef(line.id, word);
  const w = line.words[word]!;
  const scene = t.scenes.find((s) => s.id === sceneId)!;
  const here = scene.sfx.filter((s) => s.at === ref);
  const fx = line.fx.find((f) => f.word === word)?.preset;
  return (
    <div className="mt-4 space-y-4 rounded-md bg-room p-3 ring-1 ring-inset ring-hairline">
      <p className="text-sm">
        <span className="font-semibold">“{w.text}”</span> <span className="text-faint tabular">word {word + 1} · {timecode(Math.round(w.start * t.fps), t.fps)} · {ref}</span>
      </p>
      <div>
        <h4 className="mb-2 text-xs font-semibold text-muted">Voice effect on this word</h4>
        <FxChoice label={`Voice effect on “${w.text}”`} current={fx} busy={busy} onPick={(p) => void submit([{ op: "fx", line: line.id, word, preset: p }], p === "none" ? `${ref}: no voice effect` : `“${w.text}” (${ref}): ${nice(p)}`)} />
      </div>
      <div>
        <h4 className="mb-2 text-xs font-semibold text-muted">Sound effects on this word</h4>
        {here.length > 0 && (
          <ul className="mb-2 space-y-1">
            {here.map((s) => (
              <li key={s.tag} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="size-2 rotate-45 bg-accent" />
                  {nice(s.tag)}
                </span>
                <button type="button" disabled={busy} aria-label={`Remove ${nice(s.tag)}`} onClick={() => void submit([{ op: "sfx.delete", tag: s.tag, at: ref }], `${nice(s.tag)} off ${ref}`)} className="grid size-7 place-items-center rounded-md text-faint hover:bg-lifted hover:text-text">
                  <X aria-hidden size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <SfxPicker sfx={sfx} loadSfx={loadSfx} busy={busy} onAdd={(tag) => void submit([{ op: "sfx.add", tag, at: ref }], `${nice(tag)} on “${w.text}” (${ref})`)} />
      </div>
    </div>
  );
}

/** Searchable SFX tags from the asset index, each with a preview of the file the mix would use. */
export function SfxPicker({ sfx, loadSfx, busy, onAdd, action = "Add" }: { sfx: SfxEntry[] | null; loadSfx: () => void; busy: boolean; onAdd: (tag: string) => void; action?: string }) {
  const [q, setQ] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => loadSfx(), [loadSfx]);
  useEffect(() => () => audio.current?.pause(), []);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase().replaceAll(" ", "_");
    return (sfx ?? []).filter((e) => !s || e.tag.includes(s) || e.description.toLowerCase().includes(q.trim().toLowerCase()));
  }, [sfx, q]);
  const play = (e: SfxEntry) => {
    if (!audio.current) audio.current = new Audio();
    const a = audio.current;
    if (playing === e.tag) {
      a.pause();
      return setPlaying(null);
    }
    a.src = sfxAudioUrl(e.asset);
    a.onended = () => setPlaying(null);
    void a.play().then(() => setPlaying(e.tag), () => setPlaying(null));
  };
  return (
    <div>
      <label htmlFor="sfx-q" className="sr-only">
        Search sound effects
      </label>
      <input id="sfx-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={sfx ? `Search ${sfx.length} sounds: door, bell, gasp…` : "Loading the sound library…"} className={`${textField} h-8 py-0`} />
      <ul className="mt-2 max-h-56 overflow-y-auto overscroll-contain pr-1" aria-label="Sound effects">
        {list.map((e) => (
          <li key={e.tag} className="group flex items-center gap-2 rounded-md py-1 pl-1 pr-1 hover:bg-lifted">
            <button type="button" onClick={() => play(e)} aria-label={`${playing === e.tag ? "Stop" : "Play"} ${nice(e.tag)}`} className="grid size-7 shrink-0 place-items-center rounded-full text-muted ring-1 ring-inset ring-edge hover:text-text">
              {playing === e.tag ? <Pause aria-hidden size={12} /> : <Play aria-hidden size={12} />}
            </button>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{nice(e.tag)}</span>
              <span className="block truncate text-xs text-faint">
                {e.description} · {e.duration.toFixed(1)} s
              </span>
            </span>
            <button type="button" disabled={busy} onClick={() => onAdd(e.tag)} className={`${small.quiet} shrink-0`}>
              <Plus aria-hidden size={14} /> {action}
            </button>
          </li>
        ))}
        {sfx && !list.length && <li className="px-1 py-2 text-sm text-faint">No sound matches “{q}”.</li>}
      </ul>
    </div>
  );
}

/** A sound effect you placed: hear it, move it to the word under the playhead, or take it off. */
export function SfxPanel({ t, sel, busy, submit, sfx, loadSfx, playheadWord }: Common & { sel: { scene: string; tag: string; at: string }; playheadWord: () => string | undefined }) {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => loadSfx(), [loadSfx]);
  useEffect(() => () => audio.current?.pause(), []);
  const entry = sfx?.find((e) => e.tag === sel.tag);
  const [lineId, w] = sel.at.split(":");
  const word = t.lines.find((l) => l.id === lineId)?.words[Number(w)];
  const target = playheadWord();
  return (
    <div className="space-y-5">
      <header>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
          <span className="title-card text-title leading-none text-text">{nice(sel.tag)}</span>
          <span>on “{word?.text ?? "?"}”</span>
          <span className="tabular">· {sel.at} · {sel.scene}</span>
        </p>
        {entry && <p className="mt-1 text-sm text-faint">{entry.description} · {entry.duration.toFixed(1)} s · {entry.licence}</p>}
      </header>
      <div className="flex flex-wrap gap-2">
        {entry && (
          <button
            type="button"
            onClick={() => {
              if (!audio.current) audio.current = new Audio(sfxAudioUrl(entry.asset));
              if (playing) return (audio.current.pause(), setPlaying(false));
              audio.current.currentTime = 0;
              audio.current.onended = () => setPlaying(false);
              void audio.current.play().then(() => setPlaying(true));
            }}
            className={small.secondary}
          >
            {playing ? <Pause aria-hidden size={14} /> : <Play aria-hidden size={14} />} {playing ? "Stop" : "Hear it"}
          </button>
        )}
        <button type="button" disabled={busy || !target || target === sel.at} onClick={() => target && void submit([{ op: "sfx.move", tag: sel.tag, from: sel.at, to: target }], `${nice(sel.tag)} moved to ${target}`)} className={small.secondary} title={target ? `To ${target}, the word under the playhead` : undefined}>
          Move to the playhead{target && target !== sel.at ? ` (${target})` : ""}
        </button>
        <button type="button" disabled={busy} onClick={() => void submit([{ op: "sfx.delete", tag: sel.tag, at: sel.at }], `${nice(sel.tag)} off ${sel.at}`)} className={small.danger}>
          <Trash2 aria-hidden size={14} /> Remove
        </button>
      </div>
      <p className="text-xs text-faint">Sounds change the mix only; nothing is redrawn.</p>
    </div>
  );
}
