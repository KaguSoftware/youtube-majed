"use client";
import { use } from "react";
import { WithProject } from "@/components/with-project";
import { CastView } from "./cast-view";

export default function CastPage({ params }: { params: Promise<{ id: string }> }) {
  return <WithProject id={use(params).id} title="Cast">{(p) => <CastView initial={p} />}</WithProject>;
}
