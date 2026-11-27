import { assertProject, type Project } from "@studio/schema";
import { Composition, Folder, type CalculateMetadataFunction } from "remotion";
import { SAMPLES, compositionId, type SampleId } from "../samples";
import "./fonts";
import { BG_GALLERY_FRAMES, BackgroundGallery, ExpressionGallery } from "./galleries";
import { ACTION_PAGES, ActionsGallery } from "./gallery/ActionsGallery";
import { CastGallery } from "./gallery/CastGallery";
import { GradesGallery } from "./gallery/GradesGallery";
import { PropsGallery } from "./gallery/PropsGallery";
import { GALLERY_PROJECTS, GalleryVideo, galleryFrames, type GalleryProjectId } from "./gallery/projects";
import { ScenePreview, type PreviewProps } from "./gallery/Preview";
import { StoryVideo } from "./scene/StoryVideo";
import { buildTimeline } from "./scene/timeline";
import { PORTRAIT, type View } from "./scene/view";
import { FPS, H, W } from "./theme";
import { fetchVoice, trackUrl } from "./voice";

type SampleProps = { sample: SampleId; project?: Project; audioSrc?: string; view?: View };

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
  return { durationInFrames: buildTimeline(project, { portrait: props.view?.kind === "portrait" }).total, props: { ...props, project, audioSrc } };
};

function Sample({ project, audioSrc, view }: SampleProps) {
  if (!project) throw new Error("project was not loaded (calculateMetadata did not run)");
  return <StoryVideo project={project} audioSrc={audioSrc} view={view} />;
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
      <Folder name="Samples-9x16">
        {(Object.keys(SAMPLES) as SampleId[]).map((sample) => (
          <Composition
            key={sample}
            id={`${compositionId(sample)}Vertical`}
            component={Sample}
            width={PORTRAIT.width}
            height={PORTRAIT.height}
            fps={FPS}
            durationInFrames={1}
            defaultProps={{ sample, view: PORTRAIT } as SampleProps}
            calculateMetadata={loadSample}
          />
        ))}
      </Folder>
      <Folder name="Library-9x16">
        {(Object.keys(GALLERY_PROJECTS) as GalleryProjectId[]).map((id) => (
          <Composition key={id} id={`${id}Vertical`} component={GalleryVideo} width={PORTRAIT.width} height={PORTRAIT.height} fps={FPS} durationInFrames={galleryFrames(id, PORTRAIT)} defaultProps={{ id, view: PORTRAIT }} />
        ))}
      </Folder>
      <Folder name="Library">
        {Array.from({ length: ACTION_PAGES }, (_, page) => (
          <Composition key={page} id={`Actions${page + 1}`} component={ActionsGallery} width={W} height={H} fps={FPS} durationInFrames={FPS * 8} defaultProps={{ page }} />
        ))}
        <Composition id="Expressions" component={ExpressionGallery} width={W} height={H} fps={FPS} durationInFrames={FPS * 6} />
        {(Object.keys(GALLERY_PROJECTS) as GalleryProjectId[]).map((id) => (
          <Composition key={id} id={id} component={GalleryVideo} width={W} height={H} fps={FPS} durationInFrames={galleryFrames(id)} defaultProps={{ id }} />
        ))}
        <Composition id="PropsHeld" component={PropsGallery} width={W} height={H} fps={FPS} durationInFrames={FPS * 6} defaultProps={{ page: 0 as const }} />
        <Composition id="PropsPlaced" component={PropsGallery} width={W} height={H} fps={FPS} durationInFrames={FPS * 6} defaultProps={{ page: 1 as const }} />
        <Composition id="Grades" component={GradesGallery} width={W} height={H} fps={FPS} durationInFrames={FPS * 4} />
        <Composition id="Cast" component={CastGallery} width={W} height={H} fps={FPS} durationInFrames={FPS * 6} />
        <Composition id="Backgrounds" component={BackgroundGallery} width={W} height={H} fps={FPS} durationInFrames={BG_GALLERY_FRAMES} />
      </Folder>
      <Folder name="Dev">
        <Composition id="ScenePreview" component={ScenePreview} width={W} height={H} fps={FPS} durationInFrames={FPS * 3} defaultProps={{} as PreviewProps} />
      </Folder>
    </>
  );
}
