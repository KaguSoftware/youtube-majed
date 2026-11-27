import { assertProject, type Project } from "@studio/schema";
import { Composition, Folder, type CalculateMetadataFunction } from "remotion";
import { SAMPLES, compositionId, type SampleId } from "../samples";
import "./fonts";
import { ActionGallery, BG_GALLERY_FRAMES, BackgroundGallery, ExpressionGallery } from "./galleries";
import { StoryVideo } from "./scene/StoryVideo";
import { buildTimeline } from "./scene/timeline";
import { FPS, H, W } from "./theme";

type SampleProps = { sample: SampleId; project?: Project };

/**
 * Validates the sample's scene, script and timing files before anything
 * renders. A bad file fails here with a message naming the scene id and field.
 */
const loadSample: CalculateMetadataFunction<SampleProps> = ({ props }) => {
  const project = assertProject(`samples/${props.sample}`, SAMPLES[props.sample]);
  return { durationInFrames: buildTimeline(project).total, props: { ...props, project } };
};

function Sample({ project }: SampleProps) {
  if (!project) throw new Error("project was not loaded (calculateMetadata did not run)");
  return <StoryVideo project={project} />;
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
