"use client";
import type { PlayerRef } from "@remotion/player";
import type { EditOpIn, Scene, SceneOptions } from "@studio/schema";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { JobError, JobProgress } from "@/components/job-progress";
import { JobBar } from "@/components/step-head";
import { StatusMark } from "@/components/status";
import { button } from "@/components/ui";
import { call, fileUrl, JobResponse, type ProjectDetail } from "@/lib/api";
import { loadEditor, opsOf, OptionsResponse, SfxResponse, VersionsResponse, type EditorState, type SfxEntry, type VersionSummary } from "@/lib/editor";
import { clock } from "@/lib/format";
import { useProject } from "@/lib/use-project";
import { useRenders } from "@/lib/use-renders";
import { BeatPanel, FlagsPanel } from "./beat-flags";
import { LinePanel, SfxPanel } from "./line-panel";
import { LivePlayer, type Source } from "./live-player";
import { dirtyOf, estimateS, lineAt, sceneFrame, sceneIndexAt, sceneSetOp, withScene, wordAt, wordRef, type Selection } from "./model";
import { ScenePanel } from "./scene-panel";
import { Timeline, ZOOMS } from "./timeline";
import { VersionsPanel } from "./versions-panel";

type Tab = "edit" | "flags" | "versions";
type Waiting = { job: string; label: string; t0: number; kind: "edit" | "render" | "export" | "claude" };

const label80 = (s: string) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);
/** Keys belong to a text field (or a dropdown) while one has focus; a checkbox or radio does not count. */
const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "range"].includes(el.type)));

function useFlags(id: string) {
  const key = `studio:flags:${id}`;
  const [flags, setFlags] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setFlags(JSON.parse(raw) as Record<string, string>);
    } catch {
      /* private window: flags live for this visit only */
    }
  }, [key]);
  const save = useCallback(
    (next: Record<string, string>) => {
      setFlags(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* as above */
      }
    },
    [key],
  );
  return [flags, save] as const;
}

/**
 * Step 8: the video editor (docs/PLAN.md section 8). It works on the project
 * data, never the MP4: the Player draws the live composition, so a swap shows
 * before anything is rendered. Every change is a version made by the edit
 * engine; "Update video" draws only the segments that changed.
 */
export function EditorView({ initial }: { initial: ProjectDetail }) {
  const { project: p, active, lastFinished, jobs } = useProject(initial);
  const id = p.id;
  const { preview, export: exported, load: loadRenders } = useRenders(id, lastFinished?.id);
  const stage = p.pipeline.stages[7]!;
  const renderStage = p.pipeline.stages[6]!;
  const exportStage = p.pipeline.stages[8]!;
  const busy = active.length > 0;

  const [state, setState] = useState<EditorState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ head: number | null; versions: VersionSummary[] }>({ head: null, versions: [] });
  const [selection, setSelection] = useState<Selection>(null);
  const [drafts, setDrafts] = useState<Record<string, Scene>>({});
  const [options, setOptions] = useState<SceneOptions | null>(null);
  const [optionPreview, setOptionPreview] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("edit");
  const [beatOpen, setBeatOpen] = useState(false);
  const [deleteAsk, setDeleteAsk] = useState(0);
  const [sfx, setSfx] = useState<SfxEntry[] | null>(null);
  const [source, setSource] = useState<"draft" | "render">("draft");
  const [withExport, setWithExport] = useState(false);
  const [zoom, setZoom] = useState<number>(16);
  const [error, setError] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const [flags, saveFlags] = useFlags(id);
  const [frame, setFrame] = useState(0);
  const playerRef = useRef<PlayerRef>(null);
  const frameRef = useRef(0);
  const waiting = useRef<Waiting[]>([]);

  // ---------------------------------------------------------------- data
  const load = useCallback(async () => {
    try {
      const [s, v] = await Promise.all([loadEditor(id), call(`/projects/${id}/versions`, VersionsResponse)]);
      setState(s);
      setVersions(v);
      setLoadError(null);
      // a draft that now equals the committed scene has landed
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([sid, draft]) => {
        const now = s.project.scenes.scenes.find((x) => x.id === sid);
        return now && sceneSetOp(now, draft);
      })));
      return s;
    } catch (e) {
      setLoadError((e as Error).message);
      return null;
    }
  }, [id]);

  useEffect(() => void load(), [load]);

  // a job of this story finished: reload, and say how long the change took from the click
  useEffect(() => {
    if (!lastFinished) return;
    const w = waiting.current.find((x) => x.job === lastFinished.id);
    void load().then(() => {
      if (!w) return;
      waiting.current = waiting.current.filter((x) => x !== w);
      if (lastFinished.status !== "done") return;
      const s = ((performance.now() - w.t0) / 1000).toFixed(1);
      setLanded(w.kind === "render" ? `The preview is up to date, ${s} s after you asked.` : w.kind === "export" ? `The 1080p export is up to date, ${s} s after you asked.` : lastFinished.kind === "regenerate" ? `${w.label}: ready to compare, ${s} s after you asked.` : `${w.label}: in the player ${s} s after you asked.`);
      if (w.kind === "render") setSource("render");
      if (w.kind === "claude" && lastFinished.kind === "fixscenes") saveFlags({});
    });
    void loadRenders();
  }, [lastFinished, load, loadRenders, saveFlags]);

  const track = (job: string, label: string, t0: number, kind: Waiting["kind"]) => {
    waiting.current.push({ job, label, t0, kind });
    setLanded(null);
  };

  /** POSTs to the worker; a refused change (409) shows its reason and changes nothing. */
  const post = useCallback(async (path: string, body: unknown, label: string, kind: Waiting["kind"]) => {
    setError(null);
    const t0 = performance.now();
    try {
      const r = await call(path, JobResponse, { body });
      track(r.job.id, label, t0, kind);
      // a change to the project shows in the draft, not in the file drawn before it
      if (kind === "edit" || kind === "claude") setSource("draft");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }, []);

  const submit = useCallback(
    async (ops: EditOpIn[], label?: string) => {
      let parsed;
      try {
        parsed = opsOf(ops);
      } catch (e) {
        setError(`That edit isn't valid: ${(e as Error).message}`);
        return false;
      }
      return post(`/projects/${id}/edits`, { ops: parsed, ...(label ? { label: label80(label) } : {}) }, label ?? "Your edit", "edit");
    },
    [id, post],
  );

  const loadSfx = useCallback(() => {
    if (sfx) return;
    call("/editor/sfx", SfxResponse).then((r) => setSfx(r.sfx), (e: Error) => setError(e.message));
  }, [sfx]);

  // the latest options for the selected scene (after a regenerate, or from an earlier visit)
  const selScene = selection?.kind === "scene" ? selection.id : null;
  useEffect(() => {
    setOptionPreview(null);
    if (!selScene) return setOptions(null);
    let live = true;
    call(`/projects/${id}/editor/options?scene=${selScene}`, OptionsResponse).then((r) => live && setOptions(r.options), () => live && setOptions(null));
    return () => void (live = false);
  }, [id, selScene, lastFinished?.id]);

  // ---------------------------------------------------------------- the player
  const liveProject = useMemo(() => {
    if (!state) return null;
    let pr = state.project;
    for (const d of Object.values(drafts)) pr = withScene(pr, d);
    if (optionPreview !== null && options) {
      const o = options.options[optionPreview]?.op;
      const base = pr.scenes.scenes.find((s) => s.id === options.sceneId);
      if (o?.op === "scene.replace" && base) pr = withScene(pr, { ...o.with, id: base.id, lineIds: base.lineIds });
    }
    return pr;
  }, [state, drafts, optionPreview, options]);

  const playerSource: Source | null = useMemo(() => {
    if (source === "render" && preview) return { kind: "render", src: `${fileUrl(id, "renders/preview.mp4")}?v=${encodeURIComponent(preview.createdAt)}`, seconds: preview.media.durationS };
    if (!liveProject) return null;
    return { kind: "draft", project: liveProject, audioSrc: state?.audio ? `${fileUrl(id, state.audio.file)}?v=${state.audio.stamp}` : undefined };
  }, [source, preview, liveProject, state?.audio, id]);
  const playerKey = playerSource?.kind === "render" ? `render:${preview?.createdAt}` : "draft";

  // keep the frame when the player is swapped (draft ⇄ render), and follow it for the inspector
  useEffect(() => {
    const pl = playerRef.current;
    if (!pl) return;
    if (frameRef.current) pl.seekTo(frameRef.current);
    let last = 0;
    const onFrame = (e: { detail: { frame: number } }) => {
      frameRef.current = e.detail.frame;
      const now = performance.now();
      if (now - last > 150) (last = now), setFrame(e.detail.frame);
    };
    const onSeeked = (e: { detail: { frame: number } }) => ((frameRef.current = e.detail.frame), setFrame(e.detail.frame));
    pl.addEventListener("frameupdate", onFrame);
    pl.addEventListener("seeked", onSeeked);
    return () => {
      pl.removeEventListener("frameupdate", onFrame);
      pl.removeEventListener("seeked", onSeeked);
    };
  }, [playerKey, Boolean(playerSource)]); // eslint-disable-line react-hooks/exhaustive-deps

  const seek = useCallback((f: number) => {
    frameRef.current = f;
    playerRef.current?.seekTo(f);
    setFrame(f);
  }, []);
  const select = useCallback(
    (s: Selection, f?: number) => {
      setSelection(s);
      if (s) setTab("edit");
      if (f !== undefined) seek(f);
    },
    [seek],
  );

  const t = state?.timeline;
  const fps = t?.fps ?? 30;
  const lineAtPlayhead = t ? lineAt(t.lines, frame / fps) : undefined;
  const playheadWord = useCallback(() => {
    if (!t) return undefined;
    const l = lineAt(t.lines, frameRef.current / fps);
    return l ? wordRef(l.id, wordAt(l, frameRef.current / fps)) : undefined;
  }, [t, fps]);

  // ---------------------------------------------------------------- actions
  const setFlag = useCallback((sid: string, note: string | null) => {
    const next = { ...flags };
    if (note === null) delete next[sid];
    else next[sid] = note;
    saveFlags(next);
  }, [flags, saveFlags]);

  const rollback = useCallback((n: number) => void post(`/projects/${id}/versions/${n}/rollback`, {}, `Back to version ${n}`, "edit"), [id, post]);
  const head = versions.versions.find((v) => v.n === versions.head);
  const undo = useCallback(() => {
    if (!busy && head?.parent) rollback(head.parent);
  }, [busy, head, rollback]);

  const dirtyP = t ? dirtyOf(t, "preview") : { scenes: 0, frames: 0 };
  const dirtyF = t ? dirtyOf(t, "final") : { scenes: 0, frames: 0 };
  const estP = estimateS(dirtyP, "preview", preview);
  const estF = estimateS(dirtyF, "final", exported);
  const previewTodo = !preview || renderStage.stale || dirtyP.scenes > 0;
  const exportTodo = !exported || exportStage.stale || dirtyF.scenes > 0;
  const updateVideo = async () => {
    if (previewTodo && !(await post(`/projects/${id}/render`, {}, "Preview", "render"))) return;
    if (withExport && exportTodo) await post(`/projects/${id}/export`, {}, "1080p export", "export");
  };

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !t) return;
      const inInspector = e.target instanceof HTMLElement && Boolean(e.target.closest("[data-inspector]"));
      const mod = e.metaKey || e.ctrlKey;
      const pl = playerRef.current;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        return undo();
      }
      if (mod || e.altKey) return;
      if (e.key === " " && !(inInspector && e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        return pl?.toggle();
      }
      if (e.key === "Escape") {
        if (optionPreview !== null) return setOptionPreview(null);
        if (beatOpen) return setBeatOpen(false);
        return setSelection(null);
      }
      if (inInspector) return;
      const total = t.frames;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        pl?.pause();
        const d = (e.shiftKey ? fps : 1) * (e.key === "ArrowLeft" ? -1 : 1);
        return seek(Math.max(0, Math.min(total - 1, frameRef.current + d)));
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const i = sceneIndexAt(t.scenes, frameRef.current);
        const cur = t.scenes[i]!;
        const target = e.key === "ArrowUp" ? (frameRef.current > sceneFrame(cur) ? cur : t.scenes[Math.max(0, i - 1)]!) : t.scenes[Math.min(t.scenes.length - 1, i + 1)]!;
        return select({ kind: "scene", id: target.id }, sceneFrame(target));
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selection) {
        e.preventDefault();
        if (selection.kind === "scene") return setDeleteAsk((n) => n + 1);
        if (selection.kind === "sfx") return void submit([{ op: "sfx.delete", tag: selection.tag, at: selection.at }], `${selection.tag} off ${selection.at}`);
      }
      if (e.key === "f" && selection?.kind === "scene") return setFlag(selection.id, selection.id in flags ? null : "");
      if (e.key === "b") {
        e.preventDefault();
        setTab("edit");
        return setBeatOpen(true);
      }
      if (e.key === "+" || e.key === "=") return setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z as never) + 1)]!);
      if (e.key === "-") return setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z as never) - 1)]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t, fps, selection, flags, beatOpen, optionPreview, undo, seek, select, submit, setFlag]);

  // ---------------------------------------------------------------- render
  if (loadError && !state) {
    return (
      <div className="mx-auto max-w-[1440px] px-6 pb-24 pt-10">
        <EditorHead stage={stage} />
        <section className="mt-12 max-w-xl">
          <h2 className="text-lg font-semibold">The editor can't open this story yet</h2>
          <p className="mt-2 text-muted">{renderStage.status === "waiting" ? "It works on the voiced, storyboarded project. Finish the steps before it, then come back." : loadError}</p>
          <Link href={`/p/${id}/${renderStage.status === "waiting" ? "storyboard" : "render"}`} className={`${button.secondary} mt-6`}>
            Go to the step before
          </Link>
        </section>
      </div>
    );
  }

  const scene = selection?.kind === "scene" ? state?.project.scenes.scenes.find((s) => s.id === selection.id) : undefined;
  const line = selection?.kind === "line" ? t?.lines.find((l) => l.id === selection.id) : undefined;
  const scriptLine = line ? state?.project.script.lines.find((l) => l.id === line.id) : undefined;
  const flagCount = Object.keys(flags).length;
  const jobWord = lastFinished?.status === "failed" && jobs.at(-1)?.id === lastFinished.id;

  return (
    <div className="mx-auto max-w-[1440px] px-6 pb-16 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <EditorHead stage={stage} />
        {t && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="text-right text-sm leading-snug">
              <p>
                {dirtyP.scenes ? (
                  <>
                    <span className="font-semibold">
                      {dirtyP.scenes} scene{dirtyP.scenes > 1 ? "s" : ""} to redraw
                    </span>
                    <span className="text-muted"> · about {clock(estP)}</span>
                  </>
                ) : previewTodo ? (
                  <span className="text-muted">Nothing to redraw; the preview needs the new sound · about {clock(estP)}</span>
                ) : (
                  <span className="text-muted">The preview matches the draft</span>
                )}
              </p>
              <label className="mt-1 inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={withExport} onChange={(e) => setWithExport(e.target.checked)} className="size-3.5 accent-[var(--color-accent)]" />
                and the 1080p export{withExport && exportTodo ? ` · about ${clock(estF)} more` : withExport ? " · up to date" : ""}
              </label>
            </div>
            <button type="button" onClick={() => void updateVideo()} disabled={busy || (!previewTodo && !(withExport && exportTodo))} className={button.primary}>
              Update video
            </button>
          </div>
        )}
      </div>

      <JobBar live={busy || Boolean(error) || Boolean(landed) || Boolean(jobWord)}>
        <JobProgress jobs={active} onCancel={(j) => void call(`/jobs/${j.id}/cancel`, JobResponse, { body: {} }).catch(() => {})} />
        {!busy && <JobError job={lastFinished} />}
        {error && (
          <p role="alert" className="flex items-start justify-between gap-4 text-sm text-danger">
            <span className="whitespace-pre-wrap">{error}</span>
            <button type="button" onClick={() => setError(null)} className="shrink-0 text-faint hover:text-text">
              Dismiss
            </button>
          </p>
        )}
        {landed && !busy && (
          <p role="status" className="flex items-baseline justify-between gap-4 text-sm">
            <span>
              <span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-ok align-middle" />
              {landed}
              {versions.head && <span className="text-muted"> Now at version {versions.head}.</span>}
            </span>
            <button type="button" onClick={() => setLanded(null)} className="shrink-0 text-faint hover:text-text">
              Dismiss
            </button>
          </p>
        )}
      </JobBar>

      {/* the player is as wide as lets it and the timeline share one screen (once the stepper scrolls away); the inspector takes the rest */}
      <div className={`mt-6 grid gap-6 ${state?.format === "reel" ? "lg:grid-cols-[minmax(0,1fr)_25rem]" : "lg:grid-cols-[minmax(0,min(calc(100%-25rem-1.5rem),max(32rem,calc((100dvh-25rem)*16/9))))_minmax(25rem,1fr)]"}`}>
        {/* ---- the player */}
        <section aria-labelledby="player-h" className="min-w-0">
          <h2 id="player-h" className="sr-only">
            Preview
          </h2>
          {playerSource ? (
            <div className={state?.format === "reel" ? "flex justify-center rounded-lg bg-raised" : ""}>
              <LivePlayer key={playerKey} source={playerSource} portrait={state?.format === "reel"} playerRef={playerRef} />
            </div>
          ) : (
            <div className="aspect-video animate-pulse rounded-lg bg-raised ring-1 ring-hairline" aria-label="Loading the draft" />
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div role="radiogroup" aria-label="What the player shows" className="flex h-8 rounded-md ring-1 ring-inset ring-edge">
              {(["draft", "render"] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={source === k} disabled={k === "render" && !preview} onClick={() => setSource(k)} className={`rounded-md px-3 text-xs font-semibold disabled:opacity-40 ${source === k ? "bg-lifted text-text" : "text-muted hover:text-text"}`}>
                  {k === "draft" ? "Draft, drawn live" : "Last render"}
                </button>
              ))}
            </div>
            <p className="text-faint">
              {source === "draft"
                ? Object.keys(drafts).length || optionPreview !== null
                  ? "Showing changes you haven't applied yet."
                  : `Version ${versions.head ?? 1}, as it is now. Changes show here before anything is drawn.`
                : preview
                  ? `The preview file${previewTodo ? ", from before your latest edits" : ", up to date"}.`
                  : ""}
            </p>
          </div>
        </section>

        {/* ---- the inspector */}
        <aside data-inspector aria-label="Inspector" className="relative min-h-[28rem] rounded-lg bg-raised ring-1 ring-hairline">
          <div className="flex flex-col lg:absolute lg:inset-0">
            <div role="tablist" aria-label="Inspector" className="flex shrink-0 gap-1 border-b border-hairline px-3 pt-2" onKeyDown={(e: ReactKeyboardEvent) => {
              const order: Tab[] = ["edit", "flags", "versions"];
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const next = order[(order.indexOf(tab) + (e.key === "ArrowRight" ? 1 : 2)) % 3]!;
              setTab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}>
              {(["edit", "flags", "versions"] as const).map((k) => (
                <button key={k} id={`tab-${k}`} type="button" role="tab" aria-selected={tab === k} aria-controls={`panel-${k}`} tabIndex={tab === k ? 0 : -1} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-2.5 pb-2 pt-1.5 text-sm font-semibold transition-colors duration-150 ${tab === k ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}>
                  {k === "edit" ? "Edit" : k === "flags" ? `Flags${flagCount ? ` · ${flagCount}` : ""}` : `Versions${versions.head ? ` · ${versions.head}` : ""}`}
                </button>
              ))}
            </div>
            <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-0 pt-4">
              {!state || !t ? (
                <div className="space-y-3" aria-hidden>
                  {[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded-md bg-lifted" />)}
                </div>
              ) : tab === "versions" ? (
                <div className="pb-5"><VersionsPanel id={id} head={versions.head} versions={versions.versions} busy={busy} rollback={rollback} /></div>
              ) : tab === "flags" ? (
                <div className="pb-5"><FlagsPanel flags={flags} setFlag={setFlag} busy={busy} onJump={(sid) => { const s = t.scenes.find((x) => x.id === sid); if (s) select({ kind: "scene", id: sid }, sceneFrame(s)); }} onSend={() => void post(`/projects/${id}/edits/fix`, { scenes: Object.entries(flags).map(([scene, note]) => ({ scene, note: note || "This shot is wrong: make it match the narration." })) }, `Fixed ${Object.keys(flags).join(", ")}`, "claude")} /></div>
              ) : (
                <div className="space-y-6 pb-5">
                  {beatOpen && <BeatPanel t={t} line={lineAtPlayhead ?? t.lines[0]} busy={busy} onClose={() => setBeatOpen(false)} onSend={(beat, where) => post(`/projects/${id}/edits/beat`, { beat, ...where }, `Beat: ${beat}`, "claude").then((ok) => (ok && setBeatOpen(false), ok))} />}
                  {scene ? (
                    <ScenePanel
                      key={scene.id}
                      t={t}
                      scene={scene}
                      draft={drafts[scene.id] ?? scene}
                      setDraft={(d) => setDrafts((all) => {
                        const next = { ...all };
                        if (sceneSetOp(scene, d)) next[scene.id] = d;
                        else delete next[scene.id];
                        return next;
                      })}
                      cast={state.project.scenes.cast}
                      busy={busy}
                      submit={submit}
                      regenerate={async (note, count) => void (await post(`/projects/${id}/edits/regenerate`, { scene: scene.id, note, count }, `Versions of ${scene.id}`, "claude"))}
                      options={options}
                      optionPreview={optionPreview}
                      setOptionPreview={setOptionPreview}
                      pick={async (n) => void (options && (await post(`/projects/${id}/edits/options/${options.id}/pick`, { n }, `${scene.id}: version ${n}`, "edit")) && setOptionPreview(null))}
                      flag={flags[scene.id]}
                      setFlag={(note) => setFlag(scene.id, note)}
                      deleteAsk={deleteAsk}
                    />
                  ) : line && scriptLine ? (
                    <LinePanel key={line.id} t={t} line={line} script={scriptLine} word={selection?.kind === "line" ? selection.word : undefined} setWord={(w) => select({ kind: "line", id: line.id, word: w }, w === undefined ? undefined : Math.round(line.words[w]!.start * fps))} busy={busy} submit={submit} sfx={sfx} loadSfx={loadSfx} />
                  ) : selection?.kind === "sfx" ? (
                    <SfxPanel t={t} sel={selection} busy={busy} submit={submit} sfx={sfx} loadSfx={loadSfx} playheadWord={playheadWord} />
                  ) : (
                    !beatOpen && <Overview onBeat={() => setBeatOpen(true)} />
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ---- the timeline */}
      <div className="mt-6">
        {t ? (
          <Timeline t={t} selection={selection} onSelect={select} onSeek={seek} playerRef={playerRef} playerKey={playerKey} flagged={new Set(Object.keys(flags))} editing={selScene && drafts[selScene] ? selScene : null} zoom={zoom} onZoom={setZoom} />
        ) : (
          <div className="h-48 animate-pulse rounded-lg bg-raised ring-1 ring-hairline" aria-label="Loading the timeline" />
        )}
        <Shortcuts />
      </div>
    </div>
  );
}

function EditorHead({ stage }: { stage: ProjectDetail["pipeline"]["stages"][number] }) {
  return (
    <header className="min-w-0">
      <p className="eyebrow text-faint">Step 8 of 9 · Your call</p>
      <h1 className="title-card mt-1 text-title">Editor</h1>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <StatusMark stage={stage} />
        <span className="text-muted">{stage.note}</span>
      </p>
    </header>
  );
}

function Overview({ onBeat }: { onBeat: () => void }) {
  return (
    <div className="space-y-5 text-sm">
      <div>
        <h3 className="font-semibold">Pick something on the timeline</h3>
        <p className="mt-1 text-muted">A scene to swap its shot, ask Claude for new versions, move or delete it. A voice line to change its words or energy (only that line is voiced again). A word, at 64 px/s and closer, for a sound effect or a voice effect on that word.</p>
      </div>
      <button type="button" onClick={onBeat} className={button.secondary}>
        Insert a beat at the playhead
      </button>
      <p className="text-muted">Every change is a version, and nothing is drawn until you press Update video. Then only the scenes that changed are drawn again.</p>
    </div>
  );
}

const KEYS: [string, string][] = [
  ["Space", "play / pause"],
  ["← →", "a frame (⇧ a second)"],
  ["↑ ↓", "previous / next scene"],
  ["⌫", "delete"],
  ["F", "flag scene"],
  ["B", "beat at playhead"],
  ["⌘Z", "roll back"],
  ["− +", "zoom"],
];

function Shortcuts() {
  return (
    <ul aria-label="Keyboard shortcuts" className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-faint">
      {KEYS.map(([k, v]) => (
        <li key={k}>
          <kbd className="mr-1.5 rounded bg-raised px-1.5 py-0.5 font-sans font-semibold text-muted ring-1 ring-inset ring-hairline">{k}</kbd>
          {v}
        </li>
      ))}
    </ul>
  );
}
