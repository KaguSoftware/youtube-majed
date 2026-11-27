"use client";
import { useCallback, useState } from "react";
import { call, ProjectDetail } from "./api";
import { useJobs } from "./use-jobs";

/** The project, kept fresh: reloaded whenever one of its jobs finishes. */
export function useProject(initial: ProjectDetail) {
  const [project, setProject] = useState(initial);
  const reload = useCallback(async () => {
    try {
      setProject(await call(`/projects/${initial.id}`, ProjectDetail));
    } catch {
      /* keep what we have; the next event retries */
    }
  }, [initial.id]);
  const live = useJobs(initial.id, reload);
  const lastFinished = live.jobs.filter((j) => j.finishedAt).at(-1);
  return { project, setProject, reload, ...live, lastFinished };
}
