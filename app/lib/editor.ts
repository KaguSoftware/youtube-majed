/**
 * What the video editor (step 8) reads from the worker, checked with zod:
 * the live draft (worker/src/editor-api.ts), versions and diffs, regenerate
 * options and the SFX tags (worker/src/edit-api.ts). Every write goes through
 * the edit engine's routes as an EditRequest.
 */
import { EditOp, FxEffect, SceneOptions, Version, VersionDiff, validateProject, type EditOpIn, type Project } from "@studio/schema";
import { z } from "zod";
import { call } from "./api";

const Word = z.object({ text: z.string(), start: z.number(), end: z.number() });

export const Timeline = z.object({
  fps: z.number(),
  frames: z.number(),
  head: z.number().nullable(),
  scenes: z.array(
    z.object({
      id: z.string(),
      lineIds: z.array(z.string()),
      start: z.number(),
      frames: z.number(),
      bg: z.string(),
      chars: z.array(z.object({ id: z.string(), action: z.string(), expr: z.string() })),
      camera: z.string(),
      transitionIn: z.string(),
      sfx: z.array(z.object({ tag: z.string(), at: z.string() })),
      drawn: z.object({ preview: z.boolean(), final: z.boolean() }),
    }),
  ),
  lines: z.array(z.object({ id: z.string(), text: z.string(), energy: z.number(), offset: z.number(), duration: z.number(), fx: z.array(FxEffect), words: z.array(Word) })),
  cues: z.array(z.object({ id: z.string(), kind: z.string(), start: z.number(), length: z.number(), asset: z.string(), reason: z.string() })),
});
export type Timeline = z.infer<typeof Timeline>;
export type TimelineScene = Timeline["scenes"][number];
export type TimelineLine = Timeline["lines"][number];

const EditorResponse = z.object({
  format: z.enum(["youtube", "reel"]),
  head: z.number().nullable(),
  project: z.object({ scenes: z.unknown(), script: z.unknown(), voice: z.unknown() }),
  audio: z.object({ file: z.string(), stamp: z.number() }).nullable(),
  timeline: Timeline,
});

export type EditorState = Omit<z.infer<typeof EditorResponse>, "project"> & { project: Project };

/** The live draft, validated as Remotion will read it (the same validateProject the render runs). */
export async function loadEditor(id: string): Promise<EditorState> {
  const r = await call(`/projects/${id}/editor`, EditorResponse);
  const check = validateProject({ scenes: r.project.scenes, script: r.project.script, voice: r.project.voice ?? undefined });
  if (!check.ok) throw new Error(`The project doesn't validate: ${check.errors.slice(0, 3).join("; ")}`);
  return { ...r, project: check.data };
}

export const VersionSummary = Version.omit({ files: true });
export type VersionSummary = z.infer<typeof VersionSummary>;
export const VersionsResponse = z.object({ head: z.number().nullable(), versions: z.array(VersionSummary) });
export const DiffResponse = z.object({ diff: VersionDiff });
export const OptionsResponse = z.object({ options: SceneOptions.nullable() });
export const SfxEntry = z.object({ tag: z.string(), description: z.string(), asset: z.string(), duration: z.number(), licence: z.string() });
export type SfxEntry = z.infer<typeof SfxEntry>;
export const SfxResponse = z.object({ sfx: z.array(SfxEntry) });
export const CheckResponse = z.object({ ok: z.literal(true), voice: z.array(z.string()), assemble: z.boolean(), notes: z.array(z.string()), scenes: z.number(), lines: z.number() });
export type CheckResult = z.infer<typeof CheckResponse>;

/** Ops are checked here before they leave the browser, so a typo never reaches the queue. */
export const opsOf = (ops: EditOpIn[]) => z.array(EditOp).min(1).parse(ops);

export const sfxAudioUrl = (asset: string) => `/api/worker/editor/sfx/audio?asset=${encodeURIComponent(asset)}`;
