"use client";
import { useCallback, useState } from "react";
import { call, JobResponse } from "./api";

/** Starts a worker job (or any POST) and keeps the error to show; reloads the page's data when it is accepted. */
export function useAct(reload: () => Promise<void> | void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = useCallback(
    async (path: string, body: unknown = {}) => {
      setError(null);
      setBusy(true);
      try {
        await call(path, JobResponse, { body });
        await reload();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );
  const cancel = useCallback((job: { id: string }) => void call(`/jobs/${job.id}/cancel`, JobResponse, { body: {} }).catch(() => {}), []);
  return { act, cancel, error, busy, clearError: () => setError(null) };
}
