"use client";
import { use } from "react";
import { WithProject } from "@/components/with-project";
import { ExportView } from "./export-view";

export default function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  return <WithProject id={use(params).id} title="Export">{(p) => <ExportView initial={p} />}</WithProject>;
}
