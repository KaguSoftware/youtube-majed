"use client";
import { use } from "react";
import { WithProject } from "@/components/with-project";
import { RenderView } from "./render-view";

export default function RenderPage({ params }: { params: Promise<{ id: string }> }) {
  return <WithProject id={use(params).id} title="Render">{(p) => <RenderView initial={p} />}</WithProject>;
}
