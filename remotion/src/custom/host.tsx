import type { Project } from "@studio/schema";
import type { ComponentType } from "react";
import { shotInputFor } from "./shot-input";
import { ShotContext, type ShotProps } from "./types";
import type { Timeline } from "../scene/timeline";

/** Custom shots by the scene they replace. Only the scenes in this map are drawn by a shot. */
export type CustomShots = Record<string, ComponentType<ShotProps>>;

/** What a scene gives its shot: its frames, words and lines (shot-input.ts), plus the library scene and the cast it stands in for. */
export function shotPropsFor(project: Project, timeline: Timeline, index: number): ShotProps {
  const scene = project.scenes.scenes[index]!;
  const cast = Object.fromEntries(scene.chars.map((c) => [c.id, project.scenes.cast[c.id]!]));
  return { sceneId: scene.id, scene, cast, ...shotInputFor(project, timeline, index) };
}

/** Draws a scene with its custom shot. Same place in the tree as the library SceneView, so transitions, captions and overlays work unchanged. */
export function CustomScene({ Shot, project, timeline, index }: { Shot: ComponentType<ShotProps>; project: Project; timeline: Timeline; index: number }) {
  const props = shotPropsFor(project, timeline, index);
  return (
    <ShotContext.Provider value={props}>
      <Shot {...props} />
    </ShotContext.Provider>
  );
}
