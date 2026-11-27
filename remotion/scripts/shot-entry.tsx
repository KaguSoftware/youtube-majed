/**
 * A third Remotion entry point (after src/index.ts and project-entry.tsx): one
 * custom shot, drawn alone, in both frames. scripts/check-shot.ts bundles this
 * with the shot staged next to it and draws stills before the shot may be used
 * in a video (docs/PLAN.md section 6, section 12 "Custom shots crashing").
 */
import { Composition, registerRoot, type CalculateMetadataFunction } from "remotion";
import { AbsoluteFill } from "remotion";
import "../src/fonts";
import { shotComponent } from "../src/custom/registry";
import { ShotContext, type ShotProps } from "../src/custom/types";
import { LANDSCAPE, PORTRAIT, ViewContext } from "../src/scene/view";
import { FPS, INK } from "../src/theme";

type Props = { hash: string; shot: ShotProps };

const SAMPLE: Props = {
  hash: "none",
  shot: {
    sceneId: "S1",
    scene: { id: "S1", lineIds: ["L1.1"], bg: "street", grade: "day", chars: [], props: [], camera: "static", transitionIn: "cut", sfx: [], caption: "none", overlays: [] },
    cast: {},
    frames: 30,
    fps: FPS,
    words: [],
    lines: [],
  },
};

const meta: CalculateMetadataFunction<Props> = ({ props }) => ({ durationInFrames: props.shot.frames });

const Alone = (portrait: boolean) =>
  function AloneShot({ hash, shot }: Props) {
    const Shot = shotComponent(hash);
    return (
      <ViewContext.Provider value={portrait ? PORTRAIT : LANDSCAPE}>
        <AbsoluteFill style={{ background: INK }}>
          <ShotContext.Provider value={shot}>
            <Shot {...shot} />
          </ShotContext.Provider>
        </AbsoluteFill>
      </ViewContext.Provider>
    );
  };

registerRoot(() => (
  <>
    <Composition id="ShotLandscape" component={Alone(false)} width={LANDSCAPE.width} height={LANDSCAPE.height} fps={FPS} durationInFrames={30} defaultProps={SAMPLE} calculateMetadata={meta} />
    <Composition id="ShotPortrait" component={Alone(true)} width={PORTRAIT.width} height={PORTRAIT.height} fps={FPS} durationInFrames={30} defaultProps={SAMPLE} calculateMetadata={meta} />
  </>
));
