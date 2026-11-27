"use client";
import { BEARDS, BUILDS, CastMember, FACE_FEATURES, HAIR, HATS, OUTFITS, STYLES } from "@studio/schema";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { CastPreview, type PreviewGrade, type PreviewMood } from "@/components/cast-preview";
import { button, field } from "@/components/ui";
import { call, CastState, type ProjectDetail } from "@/lib/api";
import { useProject } from "@/lib/use-project";

type Look = z.output<typeof CastMember>;
const words = (id: string) => id.replaceAll("_", " ");
const label = "eyebrow text-faint";
const Saved = z.object({ cast: z.record(z.string(), CastMember) });

function Choice<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <select aria-label={name} value={value} onChange={(e) => onChange(e.target.value as T)} className={`${field} !py-2`}>
      {options.map((o) => (
        <option key={o} value={o}>{words(o)}</option>
      ))}
    </select>
  );
}

function Swatch({ name, value, onChange, onClear }: { name: string; value: string | undefined; onChange: (v: string) => void; onClear?: () => void }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const valid = /^#[0-9a-fA-F]{6}$/.test(text);
  return (
    <div className="flex items-center gap-2">
      <input type="color" aria-label={`${name} colour`} value={value ?? "#808080"} onChange={(e) => onChange(e.target.value)} className="size-10 shrink-0 cursor-pointer rounded-md bg-raised p-1 ring-1 ring-inset ring-edge" />
      <input
        aria-label={`${name} hex`}
        aria-invalid={text !== "" && !valid}
        value={text}
        placeholder="default"
        onChange={(e) => {
          setText(e.target.value);
          if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase());
        }}
        className={`${field} tabular !py-2 font-mono`}
        maxLength={7}
      />
      {onClear && value !== undefined && (
        <button type="button" onClick={onClear} className={button.quiet}>Default</button>
      )}
    </div>
  );
}

/**
 * The Cast page: every character's look, shown by the real animation library
 * as you change it. Saving writes into the storyboard's scene file, so the
 * look applies in every scene the character is in; only the render goes out
 * of date, the storyboard keeps what it planned.
 */
export function CastView({ initial }: { initial: ProjectDetail }) {
  const { project: p } = useProject(initial);
  const [saved, setSaved] = useState<Record<string, Look> | null | undefined>(undefined);
  const [draft, setDraft] = useState<Record<string, Look>>({});
  const [sel, setSel] = useState<string>("");
  const [grade, setGrade] = useState<PreviewGrade>("day");
  const [expr, setExpr] = useState<PreviewMood>("neutral");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  const load = useCallback(async () => {
    try {
      const { cast } = await call(`/projects/${p.id}/cast`, CastState);
      setSaved(cast);
      if (cast) {
        setDraft(cast);
        setSel((s) => (s && s in cast ? s : (Object.keys(cast)[0] ?? "")));
      }
    } catch (e) {
      setSaved(null);
      setError((e as Error).message);
    }
  }, [p.id]);
  useEffect(() => void load(), [load]);

  const look = draft[sel];
  const set = (patch: Partial<Look>) => {
    setState("idle");
    setDraft((d) => ({ ...d, [sel]: { ...d[sel]!, ...patch } }));
  };
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const dirtyIds = useMemo(() => Object.keys(draft).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(saved?.[k])), [draft, saved]);

  async function save() {
    setError(null);
    setState("saving");
    try {
      const r = await call(`/projects/${p.id}/cast`, Saved, { method: "PUT", body: { cast: draft } });
      setSaved(r.cast as Record<string, Look>);
      setDraft(r.cast as Record<string, Look>);
      setState("saved");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  }

  const bg = grade === "neon" ? "city" : "street";
  const toggleFace = (f: string) => {
    if (!look) return;
    let face = look.face.includes(f as never) ? look.face.filter((x) => x !== f) : [...look.face, f as never];
    if (f === "glasses") face = face.filter((x) => x !== "sunglasses");
    if (f === "sunglasses") face = face.filter((x) => x !== "glasses");
    set({ face: face.slice(-3) });
  };

  return (
    <div className="mx-auto max-w-[1200px] px-6 pb-24 pt-12">
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div>
          <p className="eyebrow text-faint">Characters</p>
          <h1 className="title-card mt-2 text-marquee">Cast</h1>
          <p className="mt-4 max-w-xl text-muted">Colours, the neon preset, face, hat and body for everyone who appears. A change applies to every scene they are in.</p>
        </div>
        <div className="flex items-center gap-3">
          {state === "saved" && !dirty && <span role="status" className="text-sm text-ok">Saved. Render again to see it in the video.</span>}
          <button type="button" onClick={() => setDraft(saved ?? {})} disabled={!dirty || state === "saving"} className={button.secondary}>Undo changes</button>
          <button type="button" onClick={save} disabled={!dirty || state === "saving"} className={button.primary}>{state === "saving" ? "Saving…" : dirty ? `Save ${dirtyIds.length} look${dirtyIds.length > 1 ? "s" : ""}` : "Saved"}</button>
        </div>
      </header>

      {error && <p role="alert" className="mt-6 rounded-md bg-danger-wash px-4 py-3 text-sm ring-1 ring-inset ring-danger/40">{error}</p>}

      {saved === null ? (
        <section className="mt-12 max-w-xl">
          <h2 className="text-lg font-semibold">The cast comes with the storyboard</h2>
          <p className="mt-2 text-muted">Claude chooses who is on screen when it plans the scenes. Plan them, and each character appears here to restyle.</p>
          <Link href={`/p/${p.id}/storyboard`} className={`${button.secondary} mt-6`}>Go to the storyboard</Link>
        </section>
      ) : !look ? null : (
        <div className="mt-10 grid gap-x-10 gap-y-8 lg:grid-cols-[13rem_minmax(0,1fr)_minmax(0,22rem)]">
          <nav aria-label="Characters">
            <ul className="space-y-1">
              {Object.entries(draft).map(([id, c]) => (
                <li key={id}>
                  <button type="button" onClick={() => setSel(id)} aria-current={sel === id ? "true" : undefined} className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-lifted ${sel === id ? "bg-lifted ring-1 ring-inset ring-edge" : ""}`}>
                    <span aria-hidden className="size-4 shrink-0 rounded-full ring-1 ring-inset ring-edge" style={{ background: c.color }} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{c.name === "?" ? "Unknown" : c.name}</span>
                      <span className="block truncate text-xs text-faint">{id}{c.style === "neon" ? " · neon" : ""}{dirtyIds.includes(id) ? " · edited" : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <section aria-label={`${look.name} preview`}>
            <CastPreview look={look} grade={grade} expr={expr} bg={bg} />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 text-sm">
              <div role="group" aria-label="Time of day" className="inline-flex overflow-hidden rounded-md ring-1 ring-inset ring-edge">
                {(["day", "night", "neon"] as const).map((g) => (
                  <button key={g} type="button" aria-pressed={grade === g} onClick={() => setGrade(g)} className={`px-3.5 py-1.5 font-semibold capitalize ${grade === g ? "bg-accent text-accent-ink" : "text-muted hover:bg-lifted hover:text-text"}`}>{g}</button>
                ))}
              </div>
              <div role="group" aria-label="Expression" className="inline-flex overflow-hidden rounded-md ring-1 ring-inset ring-edge">
                {(["neutral", "happy", "shock"] as const).map((x) => (
                  <button key={x} type="button" aria-pressed={expr === x} onClick={() => setExpr(x)} className={`px-3.5 py-1.5 font-semibold capitalize ${expr === x ? "bg-accent text-accent-ink" : "text-muted hover:bg-lifted hover:text-text"}`}>{x}</button>
                ))}
              </div>
            </div>
          </section>

          <form onSubmit={(e) => e.preventDefault()} aria-label={`Edit ${look.name}`} className="space-y-6">
            <div>
              <label htmlFor="cast-name" className={label}>Name</label>
              <input id="cast-name" value={look.name} onChange={(e) => set({ name: e.target.value })} className={`${field} mt-2`} />
            </div>

            <fieldset>
              <legend className={label}>Style</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(Object.keys(STYLES) as (keyof typeof STYLES)[]).map((s) => (
                  <button key={s} type="button" aria-pressed={look.style === s} onClick={() => set(s === "neon" ? { style: s, line: undefined, fill: undefined } : { style: s })} className={`${look.style === s ? "bg-accent text-accent-ink" : "text-text ring-1 ring-inset ring-edge hover:bg-lifted"} rounded-md px-3 py-2 text-sm font-semibold capitalize`}>
                    {s === "neon" ? "Neon preset" : "Ink"}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-faint">{look.style === "neon" ? "Glowing tubes in the accent colour on a dark head. Best at night or on the neon grade." : "Ink lines on a paper-white head, or your own line and fill."}</p>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className={label}>Colours</legend>
              <div><p className="mb-1 text-xs text-muted">{look.style === "neon" ? "Accent (the glow)" : "Accent (hat band, outfit)"}</p><Swatch name="Accent" value={look.color} onChange={(v) => set({ color: v })} /></div>
              <div><p className="mb-1 text-xs text-muted">Line{look.style === "neon" ? " (overrides the glow)" : ""}</p><Swatch name="Line" value={look.line} onChange={(v) => set({ line: v })} onClear={() => set({ line: undefined })} /></div>
              <div><p className="mb-1 text-xs text-muted">Head and hands</p><Swatch name="Fill" value={look.fill} onChange={(v) => set({ fill: v })} onClear={() => set({ fill: undefined })} /></div>
              <div><p className="mb-1 text-xs text-muted">Hair</p><Swatch name="Hair" value={look.hairColor} onChange={(v) => set({ hairColor: v })} /></div>
            </fieldset>

            <fieldset>
              <legend className={label}>Face and head</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.keys(FACE_FEATURES).map((f) => {
                  const on = look.face.includes(f as never);
                  return (
                    <button key={f} type="button" aria-pressed={on} onClick={() => toggleFace(f)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${on ? "bg-accent text-accent-ink" : "text-muted ring-1 ring-inset ring-edge hover:bg-lifted hover:text-text"}`}>{words(f)}</button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-faint">Up to three. Glasses or sunglasses, not both.</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div><p className="mb-1 text-xs text-muted">Hat</p><Choice name="Hat" value={look.hat} options={Object.keys(HATS) as (keyof typeof HATS)[]} onChange={(v) => set({ hat: v })} /></div>
                <div><p className="mb-1 text-xs text-muted">Hair</p><Choice name="Hair style" value={look.hair} options={Object.keys(HAIR) as (keyof typeof HAIR)[]} onChange={(v) => set({ hair: v })} /></div>
                <div><p className="mb-1 text-xs text-muted">Beard</p><Choice name="Beard" value={look.beard} options={Object.keys(BEARDS) as (keyof typeof BEARDS)[]} onChange={(v) => set({ beard: v })} /></div>
              </div>
            </fieldset>

            <fieldset>
              <legend className={label}>Body</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div><p className="mb-1 text-xs text-muted">Build</p><Choice name="Build" value={look.build} options={Object.keys(BUILDS) as (keyof typeof BUILDS)[]} onChange={(v) => set({ build: v })} /></div>
                <div><p className="mb-1 text-xs text-muted">Outfit</p><Choice name="Outfit" value={look.outfit} options={Object.keys(OUTFITS) as (keyof typeof OUTFITS)[]} onChange={(v) => set({ outfit: v })} /></div>
              </div>
              <label className="mt-4 block text-xs text-muted">
                <span className="flex justify-between"><span>Height</span><span className="tabular">{look.height.toFixed(2)}</span></span>
                <input type="range" min={0.8} max={1.25} step={0.01} value={look.height} onChange={(e) => set({ height: Number(e.target.value) })} className="mt-1 w-full accent-[var(--color-accent)]" />
              </label>
              <label className="mt-3 block text-xs text-muted">
                <span className="flex justify-between"><span>Size on screen</span><span className="tabular">{look.scale.toFixed(2)}</span></span>
                <input type="range" min={0.6} max={1.4} step={0.01} value={look.scale} onChange={(e) => set({ scale: Number(e.target.value) })} className="mt-1 w-full accent-[var(--color-accent)]" />
              </label>
            </fieldset>
          </form>
        </div>
      )}
    </div>
  );
}
