"use client";
import { use } from "react";
import { WithProject } from "@/components/with-project";
import { ProjectView } from "./project-view";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  return <WithProject id={use(params).id} title={(p) => p.title ?? "Pick a story"}>{(p) => <ProjectView initial={p} />}</WithProject>;
}
