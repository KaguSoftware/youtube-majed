"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { type Loaded, type ProjectDetail, loadProject } from "@/lib/api";
import { WorkerOffline, useHosted } from "./offline";

const RETRY_MS = 4000;

/**
 * Loads something from the worker in the browser (the page may be served by
 * Vercel, so only the browser can reach the helper on this computer). While the
 * helper is offline it checks again every few seconds and renders the page as
 * soon as it answers.
 */
export function useLoaded<T>(fetcher: () => Promise<Loaded<T>>, deps: unknown[]) {
  const [state, setState] = useState<Loaded<T> | undefined>();
  const [busy, setBusy] = useState(false);
  const run = useRef(fetcher);
  run.current = fetcher;

  const reload = useCallback(async () => {
    setBusy(true);
    const r = await run.current();
    setBusy(false);
    setState(r);
  }, []);

  useEffect(() => void reload(), deps);
  useEffect(() => {
    if (!state || state.ok || !state.offline) return;
    const t = setInterval(() => void reload(), RETRY_MS);
    return () => clearInterval(t);
  }, [state, reload]);

  return { state, reload, busy };
}

/** A quiet placeholder for the first moment of a page. It fades in only if the load takes longer than a blink, so a fast answer doesn't flash. */
export function PageSkeleton() {
  const hosted = useHosted();
  return (
    <div className="mx-auto max-w-6xl animate-[appear_200ms_300ms_both] px-6 pb-24 pt-12" role="status" aria-label="Loading">
      <div className="h-3 w-24 rounded bg-lifted motion-safe:animate-pulse" />
      <div className="mt-4 h-8 w-80 max-w-full rounded bg-lifted motion-safe:animate-pulse" />
      <div className="mt-12 space-y-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-4 rounded bg-raised motion-safe:animate-pulse" style={{ width: `${88 - i * 14}%` }} />)}
      </div>
      {hosted && (
        // a call held by the browser's permission prompt never fails, it just waits: say why after a few seconds
        <p className="mt-12 max-w-[62ch] animate-[appear_200ms_3s_both] text-sm text-muted">
          Waiting for your browser. If Chrome or Edge asks whether this site may reach devices on your local network, allow it: that&apos;s how the page reaches the Studio helper on this computer.
        </p>
      )}
    </div>
  );
}

/** Renders a page from its loaded value, or the skeleton, or the offline screen. */
export function Gate<T>({ loaded, children }: { loaded: ReturnType<typeof useLoaded<T>>; children: (data: T) => ReactNode }) {
  const { state, reload, busy } = loaded;
  if (!state) return <PageSkeleton />;
  if (!state.ok) return <WorkerOffline error={state.error} offline={state.offline} onRetry={() => void reload()} retrying={busy} />;
  return <>{children(state.data)}</>;
}

/** A story page: loads the project on every visit (each page used to load it on the server) and sets the tab title. */
export function WithProject({ id, title, children }: { id: string; title?: string | ((p: ProjectDetail) => string); children: (p: ProjectDetail) => ReactNode }) {
  const loaded = useLoaded(() => loadProject(id), [id]);
  const p = loaded.state?.ok ? loaded.state.data : undefined;
  const name = typeof title === "function" ? (p ? title(p) : undefined) : title;
  useEffect(() => {
    if (name) document.title = `${name} · Studio`;
  }, [name]);
  return <Gate loaded={loaded}>{children}</Gate>;
}
