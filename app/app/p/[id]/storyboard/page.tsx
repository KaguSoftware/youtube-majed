"use client";
import { use } from "react";
import { WithProject } from "@/components/with-project";
import { StoryboardView } from "./storyboard-view";

export default function StoryboardPage({ params }: { params: Promise<{ id: string }> }) {
  return <WithProject id={use(params).id} title="Storyboard">{(p) => <StoryboardView initial={p} />}</WithProject>;
}
