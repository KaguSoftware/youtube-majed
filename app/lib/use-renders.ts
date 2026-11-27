"use client";
import { useCallback, useEffect, useState } from "react";
import { call, MixState, RendersState } from "./api";

/** The preview and export records and the last mix, reloaded whenever a job for this story finishes. */
export function useRenders(id: string, trigger: string | undefined) {
  const [renders, setRenders] = useState<RendersState>({ preview: null, export: null });
  const [mix, setMix] = useState<MixState["mix"]>(null);
  const load = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([call(`/projects/${id}/renders`, RendersState), call(`/projects/${id}/mix`, MixState)]);
      setRenders(r);
      setMix(m.mix);
    } catch {
      /* the next job event retries */
    }
  }, [id]);
  useEffect(() => void load(), [load, trigger]);
  return { ...renders, mix, load };
}
