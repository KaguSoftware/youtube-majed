"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Job } from "./api";

/**
 * Live jobs from the worker over Server-Sent Events. Calls `onSettled` when a
 * job for this project finishes, so the page can reload what changed.
 */
export function useJobs(project: string | undefined, onSettled?: (job: Job) => void) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [connected, setConnected] = useState(true);
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => {
    const es = new EventSource("/api/worker/events");
    const merge = (incoming: Job[]) =>
      setJobs((prev) => {
        const map = new Map(prev.map((j) => [j.id, j]));
        for (const j of incoming) {
          const before = map.get(j.id);
          map.set(j.id, j);
          const finished = ["done", "failed", "cancelled"].includes(j.status);
          if (finished && before && !["done", "failed", "cancelled"].includes(before.status) && (!project || j.project === project)) {
            queueMicrotask(() => settled.current?.(j));
          }
        }
        return [...map.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-40);
      });
    es.addEventListener("hello", (e) => {
      setConnected(true);
      const r = z.array(Job).safeParse(JSON.parse((e as MessageEvent).data));
      if (r.success) merge(r.data);
    });
    es.addEventListener("job", (e) => {
      const r = Job.safeParse(JSON.parse((e as MessageEvent).data));
      if (r.success) merge([r.data]);
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [project]);

  const mine = project ? jobs.filter((j) => j.project === project) : jobs;
  const active = mine.filter((j) => j.status === "running" || j.status === "queued" || j.status === "waiting");
  return { jobs: mine, active, connected };
}
