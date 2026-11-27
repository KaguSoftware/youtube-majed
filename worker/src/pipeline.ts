/**
 * Where a project stands in the nine steps of docs/PLAN.md section 2, worked
 * out from what is on disk and in the job queue (nothing is stored, so it can
 * never disagree with the files).
 *
 * A step is `done` while its output exists; it is also `stale` when the input
 * it was made from has changed since. Stale output is kept: the next step
 * reuses what is still valid, and the app flags what to redo.
 *
 *   voice       stale when a script line's text differs from what was voiced
 *   storyboard  stale when the scenes no longer cover the script's lines, or
 *               the library changed (scenes carry no timing, so a re-voice
 *               alone does not invalidate them)
 *   render      stale when scenes.json, voice.json or the soundtrack differ
 *   export      the same, against the export's own record
 */
import { projectPaths, readVoice, storyboardPaths } from "@studio/project";
import type { PipelineState, StageState, StepKey } from "@studio/schema";
import { ScriptFile } from "@studio/schema";
import { readJson } from "@studio/project";
import { existsSync } from "node:fs";
import type { Job, JobKind } from "./queue";
import { currentInputs, readExportRecord, readPreviewRecord } from "./render";
import { readHistory } from "./review";
import { readComments, readNarration, readOptions, readPick } from "./story";
import { catalogueHash, readScenes, readStoryboard } from "./storyboard";
import { listVersions, readHead } from "./versions";

type Stage = Omit<StageState, "key">;
const stage = (status: StageState["status"], note: string, stale = false): Stage => ({ status, note, stale });

/** A scene file that fails validation counts as missing here; the storyboard page shows the errors. */
function safely<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

const ACTIVE = new Set<Job["status"]>(["queued", "waiting", "running"]);

export async function pipelineOf(id: string, jobs: readonly Job[]): Promise<PipelineState> {
  const active = (...kinds: JobKind[]) => jobs.some((j) => j.project === id && ACTIVE.has(j.status) && kinds.includes(j.kind));

  const options = readOptions(id);
  const pick = readPick(id);
  const narration = readNarration(id);
  const locked = Boolean(narration?.lockedAt);
  const history = readHistory(id).rounds;
  const openComments = readComments(id).comments.filter((c) => c.status === "open" && c.severity !== "info");
  const script = readJson(projectPaths(id).scriptJson, ScriptFile);
  const voice = readVoice(id);
  const voiced = voice?.ok ? voice.data : undefined;
  const scenes = safely(() => readScenes(id));
  const preview = readPreviewRecord(id);
  const exported = readExportRecord(id);

  const stages: Record<StepKey, Stage> = {} as Record<StepKey, Stage>;

  stages.brief = stage("done", "The brief is written.");

  // ---- 2 story
  if (active("options", "write")) stages.story = stage("running", pick ? "Claude is writing the loop map and the narration." : "Claude is writing three master loop options.");
  else if (narration) stages.story = stage("done", "The loop map and narration are written.");
  else if (pick) stages.story = stage("needs_you", "The story was picked but not written. Write it again.");
  else if (options) stages.story = stage("needs_you", "Pick one of the three master loops.");
  else stages.story = stage("needs_you", "Ask Claude for three master loop options.");

  // ---- 3 review
  if (active("review", "fix")) stages.review = stage("running", "The fact-checker and the critic are reading.");
  else if (!narration) stages.review = stage("waiting", "Waiting for the story.");
  else if (locked && !history.length) stages.review = stage("done", "Skipped: the script was locked without a review.");
  else if (!history.length) stages.review = stage("needs_you", "Run the fact-check and the critic.");
  else if (openComments.length && !locked) stages.review = stage("needs_you", `${openComments.length} finding${openComments.length > 1 ? "s" : ""} to accept or reject.`);
  else stages.review = stage("done", `Reviewed in ${history.length} round${history.length > 1 ? "s" : ""}${history.at(-1)?.passed ? ", passed" : ""}.`);

  // ---- 4 script
  if (!narration) stages.script = stage("waiting", "Waiting for the story.");
  else if (active("rewrite")) stages.script = stage("running", "Claude is rewriting the lines you chose.");
  else if (locked) stages.script = stage("done", "The script is locked.");
  else stages.script = stage("needs_you", "Edit the lines, then lock the script.");

  // ---- 5 voice
  const spoken = (l: { id: string; text: string }) => voiced?.lines.find((v) => v.id === l.id)?.text === l.text;
  const scriptChanged = Boolean(voiced && script && (script.lines.some((l) => !spoken(l)) || voiced.lines.length !== script.lines.length));
  if (active("voice")) stages.voice = stage("running", "The narrator is reading the script line by line.");
  else if (!locked || !script) stages.voice = stage("waiting", "Waiting for the locked script.");
  else if (!voiced) stages.voice = stage("needs_you", "Voice the script.");
  else if (scriptChanged) stages.voice = stage("done", "The script changed since it was voiced. Only the changed lines are voiced again.", true);
  else {
    const bad = voiced.lines.filter((l) => l.quality.status !== "ok").length;
    stages.voice = stage("done", bad ? `Voiced. ${bad} line${bad > 1 ? "s" : ""} to listen to.` : "Voiced; every line passed the check.");
  }

  // ---- 6 storyboard
  const covered = new Set(scenes?.scenes.flatMap((s) => s.lineIds));
  const uncovered = script ? script.lines.filter((l) => !covered.has(l.id)).length : 0;
  const libraryChanged = Boolean(scenes) && readStoryboard(id)?.catalogue !== catalogueHash();
  if (active("storyboard")) stages.storyboard = stage("running", "Claude is planning the scenes.");
  else if (!voiced) stages.storyboard = stage("waiting", "Waiting for the voice, so scenes follow the real timing.");
  else if (!scenes) stages.storyboard = stage("needs_you", "Plan the scenes.");
  else if (uncovered) stages.storyboard = stage("done", `${uncovered} line${uncovered > 1 ? "s" : ""} of the script have no scene. Plan the scenes again.`, true);
  else if (libraryChanged) stages.storyboard = stage("done", "The animation library changed since these scenes were written.", true);
  else stages.storyboard = stage("done", `${scenes!.scenes.length} scenes for ${covered.size} lines.`);

  // ---- 7 render
  const inputs = scenes && voiced ? await currentInputs(id) : undefined;
  const same = (r: { inputs: { scenes: string; voice: string; soundtrack: string; shots?: string } } | undefined) => Boolean(r && inputs && r.inputs.scenes === inputs.scenes && r.inputs.voice === inputs.voice && r.inputs.soundtrack === inputs.soundtrack && (r.inputs.shots ?? "") === inputs.shots);
  const hasMix = existsSync(storyboardPaths(id).mix);
  if (active("render", "mix")) stages.render = stage("running", "Mixing the sound and drawing the preview.");
  else if (!scenes || !voiced) stages.render = stage("waiting", "Waiting for the scenes.");
  else if (!preview) stages.render = stage("needs_you", hasMix ? "Render the preview." : "Mix the sound and render the preview.");
  else if (!same(preview)) stages.render = stage("done", "The scenes, voice, sound or custom shots changed since this preview was drawn.", true);
  else stages.render = stage("done", "The preview is drawn, with the mixed sound.");

  // ---- 8 editor (Phase 4): edits are versions (src/versions.ts); the history is optional, so this step never blocks the export
  const versions = listVersions(id);
  const edits = versions.filter((v) => v.kind === "edit" || v.kind === "rollback").length;
  if (active("edit", "rollback", "regenerate", "beat", "fixscenes")) stages.editor = stage("running", "An edit is being applied.");
  else if (!preview) stages.editor = stage("waiting", "Waiting for the preview.");
  else stages.editor = stage("done", edits ? `${edits} edit${edits > 1 ? "s" : ""}, now at version ${readHead(id)}.` : "No edits yet. Swap shots, fix lines, add sounds; every change is a version.");

  // ---- 9 export
  if (active("export")) stages.export = stage("running", "Encoding the YouTube file.");
  else if (!preview) stages.export = stage("waiting", "Waiting for the preview.");
  else if (!exported) stages.export = stage("needs_you", "Export the YouTube file when the preview looks right.");
  else if (!same(exported)) stages.export = stage("done", "The video changed since this export was made.", true);
  else stages.export = stage("done", "Exported.");

  const order: StepKey[] = ["brief", "story", "review", "script", "voice", "storyboard", "render", "editor", "export"];
  const list = order.map((key) => ({ key, ...stages[key] }));
  const current = list.find((s) => s.key !== "editor" && (s.status !== "done" || s.stale))?.key ?? "export";
  return { stages: list, current };
}
