import { z } from "zod";
import { BeatOutput, FixScenesOutput, RegenerateOutput } from "./edit";
import { CastOutput, StoryboardOutput } from "./storyboard";
import { CriticOutput, FactCheckOutput, LoopMapOutput, MasterOptionsOutput, NarrationOutput, RewriteOutput, type StepName } from "./story";

/** The zod schema each `claude -p` step's structured output must satisfy. */
export const STEP_OUTPUTS = {
  options: MasterOptionsOutput,
  loopmap: LoopMapOutput,
  narration: NarrationOutput,
  rewrite: RewriteOutput,
  factcheck: FactCheckOutput,
  critic: CriticOutput,
  cast: CastOutput,
  storyboard: StoryboardOutput,
  regenerate: RegenerateOutput,
  beat: BeatOutput,
  fixscenes: FixScenesOutput,
} as const satisfies Record<StepName, z.ZodType>;

/**
 * The JSON Schema for one step, as written to engine/schemas/<step>.json and
 * passed to `claude --json-schema`. Refinements (unique ids and the like) have
 * no JSON Schema form; they are enforced when the result is parsed with zod.
 */
export function stepJsonSchema(step: StepName): Record<string, unknown> {
  const schema = z.toJSONSchema(STEP_OUTPUTS[step], { target: "draft-2020-12", io: "output", unrepresentable: "throw" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
