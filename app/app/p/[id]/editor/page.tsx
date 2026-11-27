"use client";
import { use } from "react";
import { WithProject } from "@/components/with-project";
import { EditorView } from "./editor-view";

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  return <WithProject id={use(params).id} title="Editor">{(p) => <EditorView initial={p} />}</WithProject>;
}
