"use client";
import {
  ACTIONS,
  ATTACH_POINTS,
  BACKGROUNDS,
  CAMERAS,
  CAPTIONS,
  EXPRESSIONS,
  FRAMINGS,
  GRADES,
  OVERLAYS,
  POSITIONS,
  PROPS,
  TRANSITIONS,
  WEATHER,
  type CastMember,
  type EditOpIn,
  type Scene,
  type SceneOptions,
} from "@studio/schema";
import { ArrowLeft, ArrowRight, Eye, Flag, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Timeline } from "@/lib/editor";
import { LibrarySelect, Section, small, textField } from "./bits";
import { loopScenes, sceneSetOp } from "./model";

type Props = {
  t: Timeline;
  scene: Scene;
  draft: Scene;
  setDraft: (s: Scene) => void;
  cast: Record<string, CastMember>;
  busy: boolean;
  submit: (ops: EditOpIn[], label?: string) => Promise<boolean>;
  regenerate: (note: string, count: 2 | 3) => Promise<void>;
  options: SceneOptions | null;
  optionPreview: number | null;
  setOptionPreview: (n: number | null) => void;
  pick: (n: number) => Promise<void>;
  flag: string | undefined;
  setFlag: (note: string | null) => void;
  /** bumped by the Delete key: opens the delete question */
  deleteAsk: number;
};

const nice = (id: string) => id.replaceAll("_", " ");

/**
 * The selected scene. Every dropdown is a library list and previews in the
 * Player at once; Apply commits them as one version. Claude's versions,
 * arranging and flagging sit below, in the order you reach for them.
 */
export function ScenePanel({ t, scene, draft, setDraft, cast, busy, submit, regenerate, options, optionPreview, setOptionPreview, pick, flag, setFlag, deleteAsk }: Props) {
  const op = sceneSetOp(scene, draft);
  const info = t.scenes.find((s) => s.id === scene.id)!;
  const set = <K extends keyof Scene>(k: K, v: Scene[K]) => setDraft({ ...draft, [k]: v });
  const setChar = (i: number, patch: Partial<Scene["chars"][number]>) => setDraft({ ...draft, chars: draft.chars.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const was = (k: keyof Scene) => JSON.stringify(scene[k] ?? null) !== JSON.stringify(draft[k] ?? null);

  return (
    <div className="space-y-5">
      <header>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
          <span className="title-card text-title leading-none text-text">{scene.id}</span>
          <span className="tabular">{(info.frames / t.fps).toFixed(1)} s</span>
          <span>·</span>
          <span className="tabular">{scene.lineIds.length === 1 ? scene.lineIds[0] : `${scene.lineIds[0]}–${scene.lineIds.at(-1)}`}</span>
          {!info.drawn.preview && <span className="text-caution">· needs drawing</span>}
        </p>
      </header>

      {/* ---- the picture: swaps, previewed live */}
      <Section title="Picture" aside={op ? <span className="text-xs text-accent">Previewing in the player</span> : undefined}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <LibrarySelect label="Background" value={draft.bg} options={BACKGROUNDS} onChange={(v) => v && set("bg", v)} changed={was("bg")} />
          <LibrarySelect label="Grade" value={draft.grade} options={GRADES} onChange={(v) => v && set("grade", v)} changed={was("grade")} />
          <LibrarySelect label="Camera" value={draft.camera} options={CAMERAS} onChange={(v) => v && set("camera", v)} changed={was("camera")} />
          <LibrarySelect label="Transition in" value={draft.transitionIn} options={TRANSITIONS} onChange={(v) => v && set("transitionIn", v)} changed={was("transitionIn")} />
          <LibrarySelect label="Captions" value={draft.caption} options={CAPTIONS} onChange={(v) => v && set("caption", v)} changed={was("caption")} />
          <LibrarySelect label="Framing" value={draft.framing} options={FRAMINGS} none="wide (default)" onChange={(v) => set("framing", v)} changed={was("framing")} />
          <LibrarySelect label="Weather" value={draft.weather} options={WEATHER} none="none" onChange={(v) => set("weather", v)} changed={was("weather")} />
        </div>
      </Section>

      {draft.chars.length > 0 && (
        <Section title="Characters">
          <div className="space-y-4">
            {draft.chars.map((c, i) => {
              const before = scene.chars.find((x) => x.id === c.id);
              const travels = (ACTIONS[c.action] as { travels?: boolean }).travels;
              return (
                <fieldset key={c.id} className="min-w-0">
                  <legend className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <span aria-hidden className="size-2.5 rounded-full" style={{ background: cast[c.id]?.color ?? "var(--color-edge)" }} />
                    {cast[c.id]?.name ?? c.id}
                  </legend>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                    <LibrarySelect label="Action" value={c.action} options={ACTIONS} onChange={(v) => v && setChar(i, { action: v })} changed={before?.action !== c.action} />
                    <LibrarySelect label="Expression" value={c.expr} options={EXPRESSIONS} onChange={(v) => v && setChar(i, { expr: v })} changed={before?.expr !== c.expr} />
                    <LibrarySelect label="Position" value={c.pos} options={POSITIONS} onChange={(v) => v && setChar(i, { pos: v })} changed={before?.pos !== c.pos} />
                    {travels ? (
                      <LibrarySelect label="Walks to" value={c.to} options={POSITIONS} none="stays put" onChange={(v) => setChar(i, { to: v })} changed={before?.to !== c.to} />
                    ) : (
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-muted">Faces</span>
                        <div className="mt-1 flex h-8 rounded-md ring-1 ring-inset ring-edge" role="radiogroup" aria-label={`${cast[c.id]?.name ?? c.id} faces`}>
                          {([undefined, "left", "right"] as const).map((f) => (
                            <button key={f ?? "auto"} type="button" role="radio" aria-checked={c.facing === f} onClick={() => setChar(i, { facing: f })} className={`flex-1 rounded-md text-xs font-semibold ${c.facing === f ? "bg-lifted text-text" : "text-muted hover:text-text"}`}>
                              {f ?? "auto"}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </Section>
      )}

      <PropsEditor draft={draft} cast={cast} onChange={(props) => set("props", props)} changed={was("props")} />
      <OverlaysEditor draft={draft} onChange={(overlays) => set("overlays", overlays)} changed={was("overlays")} />

      <div className="sticky bottom-0 -mx-5 flex items-center gap-2 border-t border-hairline bg-raised/95 px-5 py-3 backdrop-blur-[2px]">
        <button type="button" disabled={!op || busy} onClick={() => op && void submit([op])} className={small.primary}>
          Apply to {scene.id}
        </button>
        <button type="button" disabled={!op} onClick={() => setDraft(scene)} className={small.quiet}>
          Reset
        </button>
        <span className="ml-auto text-xs text-faint">{op ? "Redraws this scene only" : "Pick from a list to preview"}</span>
      </div>

      <Regenerate scene={scene} busy={busy} regenerate={regenerate} options={options} optionPreview={optionPreview} setOptionPreview={setOptionPreview} pick={pick} />
      <Arrange t={t} scene={scene} busy={busy} submit={submit} deleteAsk={deleteAsk} />
      <FlagBox id={scene.id} flag={flag} setFlag={setFlag} />
    </div>
  );
}

function PropsEditor({ draft, cast, onChange, changed }: { draft: Scene; cast: Record<string, CastMember>; onChange: (p: Scene["props"]) => void; changed: boolean }) {
  const [adding, setAdding] = useState<keyof typeof PROPS | undefined>();
  const [where, setWhere] = useState<string>("");
  const holders = draft.chars.flatMap((c) => (Object.keys(ATTACH_POINTS) as (keyof typeof ATTACH_POINTS)[]).map((p) => ({ value: `${c.id}.${p}`, label: `${cast[c.id]?.name ?? c.id}: ${nice(p)}` })));
  return (
    <Section title="Props" aside={changed ? <span className="text-xs text-accent">changed</span> : undefined}>
      {draft.props.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {draft.props.map((p, i) => (
            <li key={`${p.id}-${i}`} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {nice(p.id)} <span className="text-faint">{p.attach ? `in ${p.attach.replace(".", "'s ").replaceAll("_", " ")}` : p.pos ? `at ${nice(p.pos)}` : ""}</span>
              </span>
              <button type="button" aria-label={`Remove ${nice(p.id)}`} onClick={() => onChange(draft.props.filter((_, j) => j !== i))} className="grid size-7 shrink-0 place-items-center rounded-md text-faint hover:bg-lifted hover:text-text">
                <X aria-hidden size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {draft.props.length < 6 && (
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <LibrarySelect label="Add a prop" value={adding} options={PROPS} none="choose…" onChange={setAdding} />
          <div className="min-w-0">
            <label className="text-xs font-semibold text-muted" htmlFor="prop-where">
              Where
            </label>
            <select id="prop-where" value={where} onChange={(e) => setWhere(e.target.value)} className="mt-1 h-8 w-full truncate rounded-md bg-room pl-2 pr-7 text-sm ring-1 ring-inset ring-edge focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <option value="">on the ground…</option>
              {(Object.keys(POSITIONS) as string[]).map((p) => (
                <option key={p} value={`pos:${p}`}>
                  at {nice(p)}
                </option>
              ))}
              {holders.map((h) => (
                <option key={h.value} value={`attach:${h.value}`}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={!adding || !where}
            onClick={() => {
              const [kind, v] = [where.slice(0, where.indexOf(":")), where.slice(where.indexOf(":") + 1)];
              onChange([...draft.props, kind === "pos" ? { id: adding!, pos: v as never } : { id: adding!, attach: v }]);
              setAdding(undefined);
              setWhere("");
            }}
            className={small.secondary}
          >
            Add
          </button>
        </div>
      )}
    </Section>
  );
}

function OverlaysEditor({ draft, onChange, changed }: { draft: Scene; onChange: (o: Scene["overlays"]) => void; changed: boolean }) {
  const [style, setStyle] = useState<keyof typeof OVERLAYS | undefined>();
  const [text, setText] = useState("");
  const describe = (o: Scene["overlays"][number]) => (o.style === "counter" ? `${o.prefix ?? ""}${o.to}${o.suffix ?? ""}${o.label ? ` ${o.label}` : ""}` : o.text);
  return (
    <Section title="On-screen text" aside={changed ? <span className="text-xs text-accent">changed</span> : undefined}>
      {draft.overlays.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {draft.overlays.map((o, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="text-faint">{nice(o.style)}:</span> {describe(o)}
              </span>
              <button type="button" aria-label={`Remove the ${nice(o.style)}`} onClick={() => onChange(draft.overlays.filter((_, j) => j !== i))} className="grid size-7 shrink-0 place-items-center rounded-md text-faint hover:bg-lifted hover:text-text">
                <X aria-hidden size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {draft.overlays.length < 3 && (
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <LibrarySelect label="Add" value={style} options={OVERLAYS} none="choose…" onChange={setStyle} />
          <div className="min-w-0">
            <label htmlFor="ov-text" className="text-xs font-semibold text-muted">
              {style === "counter" ? "Counts to" : "Text"}
            </label>
            <input id="ov-text" value={text} onChange={(e) => setText(e.target.value)} inputMode={style === "counter" ? "decimal" : "text"} maxLength={40} className={`${textField} mt-1 h-8 py-0`} />
          </div>
          <button
            type="button"
            disabled={!style || !text.trim() || (style === "counter" && !Number.isFinite(Number(text)))}
            onClick={() => {
              onChange([...draft.overlays, style === "counter" ? { style, to: Number(text) } : ({ style: style!, text: text.trim() } as Scene["overlays"][number])]);
              setStyle(undefined);
              setText("");
            }}
            className={small.secondary}
          >
            Add
          </button>
        </div>
      )}
    </Section>
  );
}

function Regenerate({ scene, busy, regenerate, options, optionPreview, setOptionPreview, pick }: Pick<Props, "scene" | "busy" | "regenerate" | "options" | "optionPreview" | "setOptionPreview" | "pick">) {
  const [note, setNote] = useState("");
  const [count, setCount] = useState<2 | 3>(3);
  return (
    <Section title="Ask Claude for new versions">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void regenerate(note.trim(), count);
        }}
        className="space-y-2"
      >
        <label htmlFor="regen-note" className="sr-only">
          What should change
        </label>
        <textarea id="regen-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="What's wrong, in plain words: she should look alarmed, not confused" className={`${textField} resize-none`} />
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="How many versions" className="flex h-8 rounded-md ring-1 ring-inset ring-edge">
            {([2, 3] as const).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={count === n} onClick={() => setCount(n)} className={`w-9 rounded-md text-xs font-semibold tabular ${count === n ? "bg-lifted text-text" : "text-muted hover:text-text"}`}>
                {n}
              </button>
            ))}
          </div>
          <button type="submit" disabled={busy} className={small.secondary}>
            Get {count} versions
          </button>
        </div>
      </form>
      {options && options.sceneId === scene.id && (
        <ol className="mt-4 space-y-2" aria-label={`Versions of ${scene.id}`}>
          {options.options.map((o, i) => {
            const on = optionPreview === i;
            const w = o.op.op === "scene.replace" ? o.op.with : null;
            return (
              <li key={i} className={`rounded-md p-3 ring-1 ring-inset ${on ? "bg-lifted ring-accent" : "ring-hairline"}`}>
                <p className="text-sm">
                  <span className="mr-1.5 font-semibold tabular">{i + 1}.</span>
                  {o.why}
                </p>
                {w && (
                  <p className="mt-1 text-xs text-faint">
                    {nice(w.bg)} · {nice(w.camera)} · {w.chars.map((c) => `${c.id} ${nice(c.action)}`).join(", ")}
                  </p>
                )}
                {o.flags.length > 0 && <p className="mt-1 text-xs text-caution">{o.flags.join("; ")}</p>}
                <div className="mt-2 flex gap-2">
                  <button type="button" aria-pressed={on} onClick={() => setOptionPreview(on ? null : i)} className={small.quiet}>
                    <Eye aria-hidden size={14} /> {on ? "Previewing" : "Preview"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => void pick(i + 1)} className={small.secondary}>
                    Use this one
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function Arrange({ t, scene, busy, submit, deleteAsk }: Pick<Props, "t" | "scene" | "busy" | "submit" | "deleteAsk">) {
  const [confirm, setConfirm] = useState(false);
  const asked = useRef(deleteAsk);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (deleteAsk === asked.current) return;
    asked.current = deleteAsk;
    setConfirm(true);
    requestAnimationFrame(() => box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [deleteAsk]);
  const loop = loopScenes(t, scene.id);
  const k = loop.findIndex((s) => s.id === scene.id);
  const all = t.scenes.findIndex((s) => s.id === scene.id);
  const prev = t.scenes[all - 1];
  const next = t.scenes[all + 1];
  const many = scene.lineIds.length > 1;
  const trim = (o: { start?: number; end?: number }, label: string) => void submit([{ op: "scene.trim", scene: scene.id, ...o }], label);
  return (
    <Section title="Arrange">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy || !prev} onClick={() => trim({ start: -1 }, `${scene.id} starts a line earlier`)} className={small.secondary} title={prev ? `Takes ${prev.lineIds.at(-1)} from ${prev.id}` : undefined}>
          Start a line earlier
        </button>
        <button type="button" disabled={busy || !prev || !many} onClick={() => trim({ start: 1 }, `${scene.id} starts a line later`)} className={small.secondary} title={`Gives ${scene.lineIds[0]} to ${prev?.id ?? "the scene before"}`}>
          Start a line later
        </button>
        <button type="button" disabled={busy || !next || !many} onClick={() => trim({ end: 1 }, `${scene.id} ends a line earlier`)} className={small.secondary} title={`Gives ${scene.lineIds.at(-1)} to ${next?.id ?? "the next scene"}`}>
          End a line earlier
        </button>
        <button type="button" disabled={busy || !next} onClick={() => trim({ end: -1 }, `${scene.id} ends a line later`)} className={small.secondary} title={next ? `Takes ${next.lineIds[0]} from ${next.id}` : undefined}>
          End a line later
        </button>
        <button type="button" disabled={busy || k <= 0} onClick={() => void submit([{ op: "scene.move", scene: scene.id, after: k >= 2 ? loop[k - 2]!.id : null }], `${scene.id} moved earlier`)} className={small.secondary}>
          <ArrowLeft aria-hidden size={14} /> Move earlier
        </button>
        <button type="button" disabled={busy || k < 0 || k >= loop.length - 1} onClick={() => void submit([{ op: "scene.move", scene: scene.id, after: loop[k + 1]!.id }], `${scene.id} moved later`)} className={small.secondary}>
          Move later <ArrowRight aria-hidden size={14} />
        </button>
      </div>
      <p className="mt-2 text-xs text-faint">Moving a scene moves its narration with it, within loop {scene.lineIds[0]!.split(".")[0]}.</p>
      {!confirm ? (
        <button type="button" disabled={busy} onClick={() => setConfirm(true)} className={`${small.danger} mt-3`}>
          <Trash2 aria-hidden size={14} /> Delete {scene.id}…
        </button>
      ) : (
        <div ref={box} role="group" aria-label={`Delete ${scene.id}`} className="mt-3 space-y-2 rounded-md bg-danger-wash/60 p-3 ring-1 ring-inset ring-danger/40">
          <p className="text-sm font-semibold">Delete {scene.id}: what happens to its narration?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" autoFocus onClick={() => void submit([{ op: "scene.delete", scene: scene.id, lines: "merge" }], `${scene.id} deleted (lines kept)`).then(() => setConfirm(false))} className={small.secondary}>
              Keep the lines, drop the picture
            </button>
            <button type="button" onClick={() => void submit([{ op: "scene.delete", scene: scene.id, lines: "cut" }], `${scene.id} deleted (with its lines)`).then(() => setConfirm(false))} className={small.danger}>
              Cut {scene.lineIds.join(", ")} too
            </button>
            <button type="button" onClick={() => setConfirm(false)} className={small.quiet}>
              Cancel
            </button>
          </div>
          <p className="text-xs text-muted">Either way it's a new version: you can roll back.</p>
        </div>
      )}
    </Section>
  );
}

function FlagBox({ id, flag, setFlag }: { id: string; flag: string | undefined; setFlag: (note: string | null) => void }) {
  const [note, setNote] = useState(flag ?? "");
  return (
    <Section title="Misgenerated?">
      {flag !== undefined ? (
        <div className="flex items-start justify-between gap-3 text-sm">
          <p className="flex items-start gap-2">
            <Flag aria-hidden size={14} className="mt-0.5 shrink-0 text-caution" />
            <span>
              Flagged{flag ? `: ${flag}` : ""}. It goes to Claude with the others from the Flags tab.
            </span>
          </p>
          <button type="button" onClick={() => setFlag(null)} className={small.quiet}>
            Unflag
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFlag(note.trim());
          }}
          className="flex gap-2"
        >
          <label htmlFor="flag-note" className="sr-only">
            What's wrong with {id}
          </label>
          <input id="flag-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What's wrong (optional)" className={`${textField} h-8 py-0`} />
          <button type="submit" className={small.secondary}>
            <Flag aria-hidden size={14} /> Flag
          </button>
        </form>
      )}
    </Section>
  );
}
