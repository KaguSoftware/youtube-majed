"use client";
import { useCallback, useEffect, useState } from "react";
import { call, ReelState } from "./api";

/** The Reel export, whether it is stale, and the Reel cuts of this video; reloaded whenever a job for this story finishes. */
export function useReel(id: string, trigger: string | undefined) {
  const [state, setState] = useState<ReelState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const load = useCallback(async () => {
    try {
      setState(await call(`/projects/${id}/reel`, ReelState));
      setUnavailable(false);
    } catch {
      setUnavailable(true); // a worker started before the Reel routes existed; the YouTube export still works
    }
  }, [id]);
  useEffect(() => void load(), [load, trigger]);
  return { reel: state, unavailable, load };
}
