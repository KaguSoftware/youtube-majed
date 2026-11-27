import { assertProject, type Project } from "@studio/schema";
import { Composition, Folder, type CalculateMetadataFunction } from "remotion";
import { SAMPLES, compositionId, type SampleId } from "../samples";
import "./fonts";
import { ActionGallery, BG_GALLERY_FRAMES, BackgroundGallery, ExpressionGallery } from "./galleries";
import { StoryVideo } from "./scene/StoryVideo";
import { buildTimeline } from "./scene/timeline";
import { FPS, H, W } from "./theme";
import { fetchVoice, trackUrl } from "./voice";

type SampleProps = { sample: SampleId; project?: Project; audioSrc?: string };

/**
 * Loads the sample's scene, script and timing files, plus its voice.json if
 * the project has been voiced, and validates all of them before anything
 * renders. A bad file fails here with a message naming the scene id and field.
 * With a voice.json, scene timing and captions come from real word times and
 * the narration track is played; without one, timing.json is used (silent).
 */
const loadSample: CalculateMetadataFunction<SampleProps> = async ({ props }) => {
  const voice = await fetchVoice(props.sample);
  const project = assertProject(`samples/${props.sample}`, { ...SAMPLES[props.sample], voice });
  const audioSrc = project.voice ? trackUrl(props.sample, project.voice.track.file) : undefined;
  return { durationInFrames: buildTimeline(project).total, props: { ...props, project, audioSrc } };
};

function Sample({ project, audioSrc }: SampleProps) {
  if (!project) throw new Error("project was not loaded (calculateMetadata did not run)");
  return <StoryVideo project={project} audioSrc={audioSrc} />;
}

export function Root() {
  return (
    <>
      <Folder name="Samples">
        {(Object.keys(SAMPLES) as SampleId[]).map((sample) => (
          <Composition
            key={sample}
            id={compositionId(sample)}
            component={Sample}
            width={W}
            height={H}
            fps={FPS}
            durationInFrames={1}
            defaultProps={{ sample } as SampleProps}
            calculateMetadata={loadSample}
          />
        ))}
      </Folder>
      <Folder name="Library">
        <Composition id="Actions" component={ActionGallery} width={W} height={H} fps={FPS} durationInFrames={FPS * 8} />
        <Composition id="Expressions" component={ExpressionGallery} width={W} height={H} fps={FPS} durationInFrames={FPS * 6} />
        <Composition id="Backgrounds" component={BackgroundGallery} width={W} height={H} fps={FPS} durationInFrames={BG_GALLERY_FRAMES} />
      </Folder>
    </>
  );
}
