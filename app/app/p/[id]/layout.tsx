import { Stepper } from "@/components/stepper";
import { loadProject } from "@/lib/server";

/** The stepper wraps every page of a story. A worker that is down is reported by the page itself. */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadProject(id);
  return (
    <>
      {r.ok && <Stepper id={id} initial={r.data.pipeline} title={r.data.title ?? r.data.brief.sentence} />}
      {children}
    </>
  );
}
