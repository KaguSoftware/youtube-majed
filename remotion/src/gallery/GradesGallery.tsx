import { CastMember, GRADES, type GradeId, type Scene } from "@studio/schema";
import { AbsoluteFill } from "remotion";
import { SceneView } from "../scene/SceneView";
import { H, INK, PAPER, W } from "../theme";

/** The same scene under every grade (3×3), plus the neon cast and a noir pairing. */

const CAST = {
  tom: CastMember.parse({ name: "Tom", color: "#d0473d", hat: "keeper_cap", beard: "full", hairColor: "#e9e5dd", build: "round" }),
  sam: CastMember.parse({ name: "Sam", color: "#2f9e8f", hat: "beanie", hair: "long", hairColor: "#b5652e", outfit: "scarf", build: "slim", height: 1.08 }),
  rex: CastMember.parse({ name: "Rex", color: "#a8763e", hat: "fedora", beard: "stubble", outfit: "tie", height: 1.1 }),
  zed: CastMember.parse({ name: "Zed", color: "#3ff0ff", style: "neon", hair: "messy" }),
  ivy: CastMember.parse({ name: "Ivy", color: "#ff4fd8", style: "neon", hair: "bob", outfit: "dress" }),
};

const base = (grade: GradeId, over: Partial<Scene> = {}): Scene => ({
  id: "S1", lineIds: ["L1.1"], bg: "street", grade, camera: "static", transitionIn: "cut", caption: "none", sfx: [], overlays: [], props: [],
  chars: [{ id: "tom", action: "talk", expr: "happy", pos: "center_left" }, { id: "sam", action: "idle", expr: "neutral", pos: "center_right" }],
  ...over,
});

const CELLS: { label: string; scene: Scene }[] = [
  ...(Object.keys(GRADES) as GradeId[]).map((g) => ({ label: `grade: ${g}`, scene: base(g) })),
  { label: "neon grade + neon cast", scene: base("neon", { bg: "rooftop", chars: [{ id: "zed", action: "dance", expr: "happy", pos: "center_left" }, { id: "ivy", action: "clap", expr: "laughing", pos: "center_right" }] }) },
  { label: "noir · interrogation", scene: base("noir", { bg: "interrogation", chars: [{ id: "rex", action: "cross_arms", expr: "suspicious", pos: "center_left" }, { id: "sam", action: "tremble", expr: "fear", pos: "center_right" }] }) },
];

export function GradesGallery() {
  const k = 1 / 3;
  return (
    <AbsoluteFill style={{ background: INK }}>
      {CELLS.map((c, i) => (
        <div key={c.label} style={{ position: "absolute", left: (i % 3) * (W * k), top: Math.floor(i / 3) * (H * k), width: W, height: H, transform: `scale(${k * 0.985})`, transformOrigin: "0 0", overflow: "hidden" }}>
          <SceneView scene={c.scene} cast={CAST} frames={90} />
          <div style={{ position: "absolute", left: 40, top: 32, background: PAPER, color: INK, padding: "10px 24px", borderRadius: 14, fontFamily: "Fredoka, sans-serif", fontWeight: 700, fontSize: 64 }}>{c.label}</div>
        </div>
      ))}
    </AbsoluteFill>
  );
}
