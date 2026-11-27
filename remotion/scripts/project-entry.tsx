/**
 * A second Remotion entry point for storyboarded projects (Phase 3), kept out
 * of src/ (the animation library) on purpose: it only reuses StoryVideo.
 *
 * One composition, "Project". Its `project` prop names a folder under
 * public/projects/<id>/ that scripts/render-project.ts fills with the
 * project's scenes.json, script.json, voice.json and soundtrack. Everything is
 * validated (assertProject) before a frame renders.
 */
import { assertProject, type Project } from "@studio/schema";
import { Composition, registerRoot, staticFile, type CalculateMetadataFunction } from "remotion";
import "../src/fonts";
import { StoryVideo } from "../src/scene/StoryVideo";
import { buildTimeline } from "../src/scene/timeline";
import { PORTRAIT } from "../src/scene/view";
import { FPS, H, W } from "../src/theme";
import { fetchVoice, trackUrl } from "../src/voice";

type Props = { project: string; loaded?: Project; audioSrc?: string; captions?: boolean; portrait?: boolean };

async function fetchJson(project: string, file: string): Promise<unknown> {
  const res = await fetch(staticFile(`projects/${project}/${file}`));
  const text = await res.text();
  if (!res.ok || text.trimStart().startsWith("<")) throw new Error(`public/projects/${project}/${file} is missing: render with \`pnpm render:project ${project}\``);
  return JSON.parse(text);
}

const load: CalculateMetadataFunction<Props> = async ({ props }) => {
  const [scenes, script, voice] = await Promise.all([fetchJson(props.project, "scenes.json"), fetchJson(props.project, "script.json"), fetchVoice(props.project)]);
  const loaded = assertProject(`projects/${props.project}`, { scenes, script, voice });
  const audioSrc = loaded.voice ? trackUrl(props.project, loaded.voice.track.file) : undefined;
  return { durationInFrames: buildTimeline(loaded, { portrait: props.portrait }).total, props: { ...props, loaded, audioSrc } };
};

function ProjectVideo({ loaded, audioSrc, captions, portrait }: Props) {
  if (!loaded) throw new Error("project was not loaded (calculateMetadata did not run)");
  return <StoryVideo project={loaded} audioSrc={audioSrc} captions={captions} view={portrait ? PORTRAIT : undefined} />;
}

/**
 * "Project" is the 16:9 frame (YouTube). "ProjectVertical" is the same project data in the 9:16 frame (Reels and
 * Shorts, docs/PLAN.md section 9): a re-layout, not a crop, with captions inside the safe zone. No second scene file.
 */
registerRoot(() => (
  <>
    <Composition id="Project" component={ProjectVideo} width={W} height={H} fps={FPS} durationInFrames={1} defaultProps={{ project: "lighthouse" } as Props} calculateMetadata={load} />
    <Composition id="ProjectVertical" component={ProjectVideo} width={PORTRAIT.width} height={PORTRAIT.height} fps={FPS} durationInFrames={1} defaultProps={{ project: "lighthouse", portrait: true } as Props} calculateMetadata={load} />
  </>
));
