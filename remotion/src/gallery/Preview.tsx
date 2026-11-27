import { CastMember, Scene, type CastMember as CastMemberT, type Scene as SceneT } from "@studio/schema";
import { AbsoluteFill } from "remotion";
import { SceneView } from "../scene/SceneView";
import { INK, PAPER } from "../theme";

/**
 * One scene from input props, for checking a single item quickly:
 *   npx remotion still src/index.ts ScenePreview out.png --frame=30 \
 *     --props='{"scene":{"bg":"office","grade":"night","chars":[{"id":"a","action":"idle","expr":"happy","pos":"left"}]}}'
 * Missing scene fields get defaults; the result is validated like a real scene.
 */
export type PreviewProps = { scene?: Partial<SceneT>; cast?: Record<string, Partial<CastMemberT>>; label?: string };

const DEFAULT_CAST = (id: string, i: number): Partial<CastMemberT> => ({
  name: id,
  hat: (["keeper_cap", "beanie", "none", "top_hat"] as const)[i % 4],
  color: ["#d0473d", "#2f9e8f", "#e0a24e", "#5b6bd6"][i % 4]!,
});

export function ScenePreview({ scene = {}, cast = {}, label }: PreviewProps) {
  const full = Scene.parse({
    id: "S1",
    lineIds: ["L1.1"],
    bg: "street",
    grade: "day",
    chars: [],
    props: [],
    camera: "static",
    transitionIn: "cut",
    caption: "none",
    ...scene,
  });
  const fullCast: Record<string, CastMemberT> = {};
  full.chars.forEach((c, i) => {
    fullCast[c.id] = CastMember.parse({ ...DEFAULT_CAST(c.id, i), ...cast[c.id] });
  });
  return (
    <AbsoluteFill>
      <SceneView scene={full} cast={fullCast} frames={90} />
      {label && (
        <div style={{ position: "absolute", left: 40, top: 32, background: PAPER, color: INK, padding: "8px 18px", borderRadius: 12, fontFamily: "Fredoka, sans-serif", fontWeight: 700, fontSize: 30 }}>
          {label}
        </div>
      )}
    </AbsoluteFill>
  );
}
