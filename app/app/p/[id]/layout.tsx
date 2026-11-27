"use client";
import { use } from "react";
import { Stepper } from "@/components/stepper";
import { useLoaded } from "@/components/with-project";
import { loadProject } from "@/lib/api";

/** The stepper wraps every page of a story. A worker that is down is reported by the page itself. */
export default function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { state } = useLoaded(() => loadProject(id), [id]);
  return (
    <>
      {state?.ok && <Stepper id={id} initial={state.data.pipeline} title={state.data.title ?? state.data.brief.sentence} />}
      {children}
    </>
  );
}
