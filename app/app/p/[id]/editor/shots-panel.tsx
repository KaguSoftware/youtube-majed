"use client";
import type { FailureKind } from "@studio/schema";
import { Check, Eye, RefreshCw, TriangleAlert, Undo2 } from "lucide-react";
import { useId, useState } from "react";
import { fileUrl } from "@/lib/api";
import { FAILURE, frameOf, reasonOf, type ShotRow, type ShotsState, type Suggestion } from "@/lib/custom-shots";
import { ago } from "@/lib/format";
import { Section, small, textField } from "./bits";

type Props = {
  id: string;
  state: ShotsState | null | undefined;
  /** the scene selected in the timeline, if any: offered like a suggestion when it has no shot */
  selected: { id: string; seconds: number } | null;
  busy: boolean;
  jump: (scene: string) => void;
  write: (scene: string, note: string) => Promise<boolean>;
  regenerate: (shot: string, note: string) => Promise<boolean>;
  recheck: (shot: string) => Promise<boolean>;
  verdict: (shot: string, v: "accept" | "reject") => Promise<void>;
};

/** Status is a glyph and a word, never colour alone. */
const STATUS: Record<ShotRow["status"], { word: string; Icon: typeof Check; tone: string }> = {
  verified: { word: "Waiting for your look", Icon: Eye, tone: "text-accent" },
  accepted: { word: "Kept", Icon: Check, tone: "text-ok" },
  rejected: { word: "Library scene drawn", Icon: Undo2, tone: "text-muted" },
  failed: { word: "Fell back to the library scene", Icon: TriangleAlert, tone: "text-danger" },
};

/**
 * Custom shots (docs/PLAN.md section 6): Claude writes a one-off component for a moment the library can't time to a
 * word. Nothing here changes the scene JSON; a shot that fails any check, or that you revert, leaves the library
 * scene in the video. The player draws the library scene; the stills are what the shot draws, alone, in both frames.
 */
export function ShotsPanel({ id, state, selected, busy, jump, write, regenerate, recheck, verdict }: Props) {
  if (state === undefined) return <div className="space-y-3" aria-hidden>{[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-md bg-lifted" />)}</div>;
  if (state === null) return <p className="text-sm text-muted">This worker is older than custom shots. Restart it with <span className="font-mono text-text">pnpm worker</span>.</p>;

  const liveScenes = new Set(state.shots.filter((s) => s.live).map((s) => s.sceneId));
  const full = state.live >= state.max;
  const offers: Suggestion[] = state.suggestions.filter((s) => !liveScenes.has(s.scene));
  if (selected && !liveScenes.has(selected.id) && !offers.some((o) => o.scene === selected.id)) {
    offers.unshift({ scene: selected.id, why: "the scene you selected", score: 0, seconds: selected.seconds, revealAt: null });
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted">
          For a moment the library can&apos;t land on a spoken word, Claude writes one shot for one scene. It is checked on its own before it is used, and if any check fails the library scene is drawn and the video still renders.
        </p>
        <p className="mt-2 text-sm">
          <span className="tabular font-semibold">{state.live} of {state.max}</span> <span className="text-muted">shots in the video</span>
        </p>
      </div>

      {state.shots.length > 0 && (
        <ul aria-label="Custom shots" className="divide-y divide-hairline border-y border-hairline">
          {state.shots.map((s) => (
            <li key={s.id}>
              <Shot id={id} shot={s} busy={busy} jump={jump} regenerate={regenerate} recheck={recheck} verdict={verdict} room={!full || s.live} />
            </li>
          ))}
        </ul>
      )}

      <Section title="Write a shot" aside={full ? <span className="text-xs text-faint">All {state.max} are in use</span> : undefined}>
        {offers.length === 0 ? (
          <p className="text-sm text-muted">{full ? "Revert one to the library scene to free a place." : "Select a scene in the timeline to write a shot for it."}</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {offers.map((o) => (
              <li key={o.scene}>
                <Offer offer={o} disabled={busy || full} write={write} jump={jump} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {state.log.length > 0 && (
        <Section title={`Why shots fell back · ${state.log.filter((l) => l.event === "fallback").length}`}>
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold text-muted transition-colors duration-150 hover:text-text">Show the log</summary>
            <ol className="mt-3 space-y-2" aria-label="Custom shot log, newest first">
              {state.log.map((l, i) => (
                <li key={i} className="text-xs">
                  <p className="text-faint">
                    {ago(l.at)} · <span className="tabular text-muted">{l.shot} on {l.scene}</span> · {l.event === "fallback" ? "fell back" : l.event}
                    {l.kind ? ` · ${FAILURE[l.kind]}` : ""}
                  </p>
                  <p className="mt-0.5 text-muted [overflow-wrap:anywhere]">{l.message.split("\n")[0]}</p>
                </li>
              ))}
            </ol>
          </details>
        </Section>
      )}
    </div>
  );
}

function Offer({ offer, disabled, write, jump }: { offer: Suggestion; disabled: boolean; write: Props["write"]; jump: Props["jump"] }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const field = useId();
  return (
    <div className="py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <button type="button" onClick={() => jump(offer.scene)} className="tabular font-semibold underline decoration-hairline underline-offset-4 transition-colors duration-150 hover:decoration-text focus-visible:outline-2 focus-visible:outline-accent">{offer.scene}</button>
            <span className="tabular text-faint"> · {offer.seconds.toFixed(1)} s</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">{offer.why}{offer.revealAt ? `, lands on ${offer.revealAt}` : ""}</p>
        </div>
        {!open && <button type="button" disabled={disabled} onClick={() => setOpen(true)} className={small.secondary}>Write</button>}
      </div>
      {open && (
        <form
          className="mt-2.5 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await write(offer.scene, note.trim())) (setOpen(false), setNote(""));
          }}
        >
          <label htmlFor={field} className="text-xs font-semibold text-muted">A note for Claude (optional)</label>
          <textarea id={field} value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. the button should light on the word thirteen" className={`${textField} resize-none`} />
          <div className="flex gap-2">
            <button type="submit" disabled={disabled} className={small.primary}>Write the shot</button>
            <button type="button" onClick={() => setOpen(false)} className={small.quiet}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function Shot({ id, shot, busy, jump, regenerate, recheck, verdict, room }: { id: string; shot: ShotRow; busy: boolean; jump: Props["jump"]; regenerate: Props["regenerate"]; recheck: Props["recheck"]; verdict: Props["verdict"]; room: boolean }) {
  const { word, Icon, tone } = STATUS[shot.status];
  const [redo, setRedo] = useState(false);
  const [note, setNote] = useState("");
  const field = useId();
  const reason = shot.reason ? reasonOf(shot.reason) : null;
  const hasStills = Boolean(shot.check && shot.check.stills.landscape.length);
  return (
    <article className="py-4" aria-label={`${shot.id} on ${shot.sceneId}: ${word}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold [overflow-wrap:anywhere]">{shot.title}</h4>
          <p className="mt-0.5 text-xs text-faint">
            <span className="tabular">{shot.id}</span> on{" "}
            <button type="button" onClick={() => jump(shot.sceneId)} className="tabular font-semibold text-muted underline decoration-hairline underline-offset-4 hover:text-text hover:decoration-text focus-visible:outline-2 focus-visible:outline-accent">{shot.sceneId}</button>
            {" "}· {shot.model} · {ago(shot.updatedAt)}
          </p>
        </div>
        <p className={`flex shrink-0 items-center gap-1.5 text-xs font-semibold ${tone}`}>
          <Icon aria-hidden size={14} /> {word}
        </p>
      </header>

      {shot.idea && <p className="mt-2 text-sm text-muted">{shot.idea}</p>}

      {reason && shot.status !== "accepted" && shot.status !== "verified" && (
        <div role={shot.status === "failed" ? "alert" : undefined} className="mt-3 rounded-md bg-room px-3 py-2.5 ring-1 ring-inset ring-hairline">
          <p className="text-sm font-semibold">{reason.kind ? FAILURE[reason.kind as FailureKind] : "Reverted"}</p>
          <p className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">
            {shot.status === "failed" ? <>The library scene {shot.sceneId} is drawn instead. </> : null}
            {sentence(reason.text.split("\n")[0] ?? "")}
          </p>
        </div>
      )}

      {shot.timing.length > 0 && (
        <ul className="mt-3 space-y-1" aria-label="Words the shot reacts to">
          {shot.timing.map((t) => (
            <li key={t.at} className="flex gap-2 text-xs">
              <span className="tabular w-14 shrink-0 font-semibold text-muted">{t.at}</span>
              <span className="text-muted">{t.does}</span>
            </li>
          ))}
        </ul>
      )}

      {hasStills && <Stills id={id} shot={shot} />}

      {shot.stale && shot.live && <p className="mt-3 text-xs text-faint">Checked against an older library. It is checked again before the next render, and falls back if it no longer passes.</p>}
      {shot.check?.warnings.map((w) => (
        <p key={w} className="mt-2 text-xs text-muted">Note: {w}</p>
      ))}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {shot.status === "verified" && <button type="button" disabled={busy} onClick={() => void verdict(shot.id, "accept")} className={small.primary}>Keep this shot</button>}
        {shot.status === "rejected" && shot.check?.ok && <button type="button" disabled={busy || !room} onClick={() => void verdict(shot.id, "accept")} className={small.primary}>Bring it back</button>}
        {shot.live && <button type="button" disabled={busy} onClick={() => void verdict(shot.id, "reject")} className={small.secondary}><Undo2 aria-hidden size={13} /> Use the library scene</button>}
        {shot.status === "failed" && <button type="button" disabled={busy} onClick={() => void verdict(shot.id, "reject")} className={small.quiet}>Dismiss</button>}
        <button type="button" disabled={busy} onClick={() => setRedo((v) => !v)} aria-expanded={redo} className={small.secondary}><RefreshCw aria-hidden size={13} /> Regenerate</button>
        {shot.status !== "rejected" && <button type="button" disabled={busy} onClick={() => void recheck(shot.id)} className={small.quiet}>Check again</button>}
      </div>

      {redo && (
        <form
          className="mt-3 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!note.trim()) return;
            if (await regenerate(shot.id, note.trim())) (setRedo(false), setNote(""));
          }}
        >
          <label htmlFor={field} className="text-xs font-semibold text-muted">What should change?</label>
          <textarea id={field} autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. slower build, and the light should pulse after the word" className={`${textField} resize-none`} />
          <p className="text-xs text-faint">A new version is checked like a new shot. If it fails, {shot.live ? "this one stays." : "nothing changes."}</p>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !note.trim()} className={small.primary}>Regenerate</button>
            <button type="button" onClick={() => setRedo(false)} className={small.quiet}>Cancel</button>
          </div>
        </form>
      )}
    </article>
  );
}

/** "the landscape frame fails at frame 71" → "The landscape frame fails at frame 71." */
const sentence = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : "");

/** The stills the check drew alone: a viewer, and a strip to pick the frame, in 16:9 or 9:16. */
function Stills({ id, shot }: { id: string; shot: ShotRow }) {
  const stills = shot.check!.stills;
  const [frame, setFrame] = useState<"landscape" | "portrait">("landscape");
  const [at, setAt] = useState(Math.min(2, stills.landscape.length - 1));
  const list = stills[frame];
  const current = list[Math.min(at, list.length - 1)];
  const group = useId();
  if (!current) return null;
  const portrait = frame === "portrait";
  return (
    <figure className="mt-3">
      <div className="flex items-center justify-between gap-3">
        <figcaption className="text-xs font-semibold text-muted">{shot.status === "failed" ? "Frames drawn before it failed" : "Drawn alone"}</figcaption>
        <div role="radiogroup" aria-label="Frame" className="flex rounded-md ring-1 ring-inset ring-edge">
          {(["landscape", "portrait"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={frame === k} onClick={() => setFrame(k)} className={`h-7 px-2.5 text-xs font-semibold transition-colors duration-150 first:rounded-l-md last:rounded-r-md ${frame === k ? "bg-lifted text-text" : "text-muted hover:text-text"}`}>
              {k === "landscape" ? "16:9" : "9:16"}
            </button>
          ))}
        </div>
      </div>
      <div className={`mt-2 overflow-hidden rounded-md bg-room ring-1 ring-hairline ${portrait ? "mx-auto w-44" : "w-full"}`}>
        {/* a plain img: the worker serves the still, and its size is known by the frame */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fileUrl(id, `custom/stills/${current}`)} alt={`${shot.title}, ${portrait ? "9:16" : "16:9"} frame ${frameOf(current)}`} className="block h-auto w-full" />
      </div>
      <div role="radiogroup" aria-labelledby={group} className="mt-2 flex flex-wrap gap-1.5">
        <span id={group} className="sr-only">Frame of the shot</span>
        {list.map((s, i) => (
          <button key={s} type="button" role="radio" aria-checked={i === at} onClick={() => setAt(i)} aria-label={`Frame ${frameOf(s)}`} className={`tabular h-6 rounded-sm px-1.5 text-xs transition-colors duration-150 ${i === at ? "bg-lifted font-semibold text-text ring-1 ring-inset ring-edge" : "text-faint hover:bg-lifted hover:text-text"}`}>
            {frameOf(s)}
          </button>
        ))}
      </div>
    </figure>
  );
}
