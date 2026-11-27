"use client";
import { useCallback, useEffect, useState } from "react";
import { call, VarietyState } from "./api";

/** The variety report of a project, reloaded whenever a job for it finishes. `undefined` until the first answer. */
export function useVariety(id: string, trigger: string | undefined) {
  const [state, setState] = useState<VarietyState | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      setState(await call(`/projects/${id}/variety`, VarietyState));
    } catch {
      /* the next job event retries */
    }
  }, [id]);
  useEffect(() => void load(), [load, trigger]);
  return state;
}
