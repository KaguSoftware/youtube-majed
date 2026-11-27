import { LOW_POLY, assertProject, type CameraId, type CastMember, type GradeId, type HatId, type LowPolyBackgroundId, type Project, type Scene } from "@studio/schema";
import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { SafeGuides } from "../gallery/SafeGuides";
import { StoryVideo } from "../scene/StoryVideo";
import { buildTimeline } from "../scene/timeline";
import { LANDSCAPE, isPortrait, type View } from "../scene/view";
import { FPS, INK, PAPER } from "../theme";

/**
 * Low-poly galleries for Remotion Studio (folders Library-3D and
 * Library-3D-9x16): small real projects in the low_poly style, validated and
 * played by StoryVideo like any story, so what they show is what renders.
 */

type Shot = Partial<Scene> & { label: string; seconds?: number };

function project(title: string, shots: Shot[], cast: Record<string, Partial<CastMember> & { color: string }>): { project: Project; labels: string[] } {
  const scenes = shots.map(({ label: _l, seconds: _s, ...s }, i) => ({
    id: `S${i + 1}`,
    lineIds: [`L1.${i + 1}`],
    bg: "office",
    grade: "day",
    chars: [],
    props: [],
    camera: "static",
    transitionIn: "cut",
    caption: "none",
    sfx: [],
    ...s,
  }));
  const raw = {
    scenes: { version: 1, title, artStyle: "low_poly", cast: Object.fromEntries(Object.entries(cast).map(([id, c]) => [id, { name: id, ...c }])), scenes },
    script: { version: 1, lines: shots.map((_, i) => ({ id: `L1.${i + 1}`, text: "Nobody saw what happened next.", energy: 3, delivery: "calm" })) },
    timing: { version: 1, fps: FPS, seconds: Object.fromEntries(shots.map((s, i) => [`S${i + 1}`, s.seconds ?? 3])) },
  };
  return { project: assertProject(`3D gallery ${title}`, raw), labels: shots.map((s) => s.label) };
}

/** The stick galleries' cast, so the two styles can be compared side by side. */
const CAST = {
  tom: { color: "#d0473d", hat: "keeper_cap", beard: "full", hairColor: "#e9e5dd", build: "round" },
  sam: { color: "#2f9e8f", hat: "beanie", hair: "long", hairColor: "#b5652e", outfit: "scarf", build: "slim", height: 1.08, face: ["freckles"] },
  ana: { color: "#d04f8a", hair: "bob", hairColor: "#1f1a2e", outfit: "dress", face: ["glasses"] },
  rex: { color: "#3f6fd8", hair: "short", hairColor: "#2b2b2b", beard: "moustache", outfit: "tie", build: "broad" },
} as const satisfies Record<string, Partial<CastMember> & { color: string }>;

const duo = (a: string, b: string): Scene["chars"] => [
  { id: a, action: "talk", expr: "happy", pos: "center_left" },
  { id: b, action: "idle", expr: "neutral", pos: "center_right" },
];

const GRADES: GradeId[] = ["day", "dusk", "night"];
const HATS: HatId[] = ["none", "keeper_cap", "beanie", "top_hat", "baseball_cap", "fedora", "cowboy_hat", "crown", "hard_hat", "chef_hat", "police_cap", "beret"];

/** Every low-poly action, three to a scene. */
function actionShots(): Shot[] {
  const ids = [...LOW_POLY.actions];
  const out: Shot[] = [];
  const who = ["sam", "rex", "ana"] as const;
  const pos = ["left", "center", "right"] as const;
  for (let i = 0; i < ids.length; i += 3) {
    const group = ids.slice(i, i + 3);
    const props: Scene["props"] = [];
    const chars = group.map((action, j) => {
      const c = { id: who[j]!, action, expr: "neutral", pos: pos[j]! } as Scene["chars"][number];
      if (action === "sit_chair" || action === "type") props.push({ id: "chair", pos: pos[j]! });
      if (action === "type") props.push({ id: "desk", pos: pos[j]! });
      if (action === "knock") props.push({ id: "door", pos: pos[j]! });
      if (action === "drive") props.push({ id: "car", pos: pos[j]! });
      if (action === "sleep") props.push({ id: "bed", pos: pos[j]! });
      if (action === "text_phone" || action === "phone_call") props.push({ id: "phone", attach: `${who[j]}.hand_r` });
      if (action === "read") props.push({ id: "book", attach: `${who[j]}.hand_r` });
      return c;
    });
    out.push({ label: group.join(" · "), seconds: 4, bg: "house_interior", chars, props });
  }
  return out;
}

export const LOW_POLY_GALLERIES = {
  Sets3D: () =>
    project(
      "Sets3D",
      LOW_POLY.backgrounds.flatMap((bg: LowPolyBackgroundId) => GRADES.map((grade): Shot => ({ label: `${bg} · ${grade}`, bg, grade, seconds: 2, chars: duo("sam", "rex") }))),
      CAST,
    ),

  Actions3D: () => project("Actions3D", actionShots(), CAST),

  Cast3D: () =>
    project(
      "Cast3D",
      [
        { label: "the stick galleries' cast", chars: [{ id: "tom", action: "idle", expr: "happy", pos: "far_left" }, { id: "sam", action: "wave", expr: "happy", pos: "center_left" }, { id: "ana", action: "talk", expr: "smirk", pos: "center_right" }, { id: "rex", action: "cross_arms", expr: "deadpan", pos: "far_right" }] },
        ...[0, 4, 8].map((k): Shot => ({
          label: `hats: ${HATS.slice(k, k + 4).join(" · ")}`,
          chars: HATS.slice(k, k + 4).map((_, j) => ({ id: `h${k + j}`, action: "idle", expr: "neutral", pos: (["far_left", "center_left", "center_right", "far_right"] as const)[j]! })),
        })),
        { label: "hair: short · messy · long · bob", chars: ["short", "messy", "long", "bob"].map((_, j) => ({ id: `hair${j}`, action: "idle", expr: "happy", pos: (["far_left", "center_left", "center_right", "far_right"] as const)[j]! })) },
        { label: "hair: bun · ponytail · curly · none + beards", chars: ["bun", "ponytail", "curly", "none"].map((_, j) => ({ id: `hair${j + 4}`, action: "idle", expr: "happy", pos: (["far_left", "center_left", "center_right", "far_right"] as const)[j]! })) },
        { label: "builds: average · slim · broad · round", chars: ["average", "slim", "broad", "round"].map((_, j) => ({ id: `b${j}`, action: "idle", expr: "neutral", pos: (["far_left", "center_left", "center_right", "far_right"] as const)[j]! })) },
        { label: "outfits: tie · scarf · dress · cape · backpack", chars: ["tie", "scarf", "dress", "cape"].map((_, j) => ({ id: `o${j}`, action: "idle", expr: "neutral", pos: (["far_left", "center_left", "center_right", "far_right"] as const)[j]! })) },
        { label: "face: glasses · sunglasses · eyepatch · freckles+blush", camera: "slow_push", framing: "medium", chars: ["f0", "f1", "f2", "f3"].map((id, j) => ({ id, action: "idle", expr: "happy", pos: (["far_left", "center_left", "center_right", "far_right"] as const)[j]! })) },
        { label: "neon style · night", grade: "neon", chars: [{ id: "zed", action: "talk", expr: "happy", pos: "center_left" }, { id: "ivy", action: "wave", expr: "smirk", pos: "center_right" }] },
        { label: "silhouette · night", grade: "night", chars: [{ id: "rex", action: "idle", expr: "neutral", pos: "center", look: "silhouette" }] },
      ],
      {
        ...CAST,
        ...Object.fromEntries(HATS.map((hat, i) => [`h${i}`, { color: ["#d0473d", "#2f9e8f", "#e0a030", "#3f6fd8"][i % 4]!, hat, hair: "short" as const }])),
        ...Object.fromEntries((["short", "messy", "long", "bob", "bun", "ponytail", "curly", "none"] as const).map((hair, i) => [`hair${i}`, { color: ["#d04f8a", "#2f9e8f", "#e0a030", "#3f6fd8"][i % 4]!, hair, hairColor: ["#3b2a22", "#b5652e", "#1f1a2e", "#e0c070"][i % 4]!, beard: (["none", "none", "none", "none", "goatee", "stubble", "moustache", "full"] as const)[i]! }])),
        ...Object.fromEntries((["average", "slim", "broad", "round"] as const).map((build, i) => [`b${i}`, { color: ["#d0473d", "#2f9e8f", "#e0a030", "#3f6fd8"][i]!, build, hair: "short" as const }])),
        ...Object.fromEntries((["tie", "scarf", "dress", "cape"] as const).map((outfit, i) => [`o${i}`, { color: ["#3f6fd8", "#d0473d", "#d04f8a", "#6a3fd8"][i]!, outfit, hair: (i === 2 ? "long" : "short") as "long" | "short" }])),
        f0: { color: "#2f9e8f", face: ["glasses"], hair: "curly" },
        f1: { color: "#e0a030", face: ["sunglasses"], hair: "short" },
        f2: { color: "#d0473d", face: ["eyepatch", "nose"], beard: "stubble" },
        f3: { color: "#d04f8a", face: ["freckles", "blush", "lashes"], hair: "ponytail", hairColor: "#b5652e" },
        zed: { color: "#3ff0ff", style: "neon", hair: "messy" },
        ivy: { color: "#ff4fd8", style: "neon", hair: "bob", outfit: "dress", face: ["lashes"] },
      },
    ),

  Cameras3D: () =>
    project(
      "Cameras3D",
      (["static", "slow_push", "shake", "zoom_face", "dolly_out", "pan_left", "pan_right", "whip_pan", "tilt_up", "handheld", "dutch_angle"] as CameraId[]).map((camera, i) => ({
        label: `camera: ${camera}`,
        camera,
        bg: LOW_POLY.backgrounds[i % LOW_POLY.backgrounds.length]!,
        grade: GRADES[i % 3]!,
        chars: duo("sam", "rex"),
      })),
      CAST,
    ),

  Props3D: () =>
    project(
      "Props3D",
      [
        { label: "held: lantern · oil_can · phone", grade: "night", bg: "lighthouse_stairs", chars: [{ id: "tom", action: "look_around", expr: "fear", pos: "left" }, { id: "sam", action: "idle", expr: "neutral", pos: "center" }, { id: "rex", action: "phone_call", expr: "happy", pos: "right" }], props: [{ id: "lantern", attach: "tom.hand_r" }, { id: "oil_can", attach: "sam.hand_r" }, { id: "phone", attach: "rex.hand_r" }] },
        { label: "held: book · newspaper · money · food", bg: "house_interior", chars: [{ id: "sam", action: "read", expr: "neutral", pos: "far_left" }, { id: "rex", action: "read", expr: "suspicious", pos: "center_left" }, { id: "ana", action: "idle", expr: "happy", pos: "center_right" }, { id: "tom", action: "idle", expr: "happy", pos: "far_right" }], props: [{ id: "book", attach: "sam.hand_r" }, { id: "newspaper", attach: "rex.hand_r" }, { id: "money", attach: "ana.hand_r" }, { id: "food", attach: "tom.hand_r" }] },
        { label: "held: box · suitcase", bg: "street", chars: [{ id: "rex", action: "idle", expr: "neutral", pos: "center_left" }, { id: "sam", action: "walk", expr: "happy", pos: "left", to: "right" }], props: [{ id: "box", attach: "rex.hand_r" }, { id: "suitcase", attach: "sam.hand_r" }] },
        { label: "placed: door · flour_sack · oil_can · box · suitcase", bg: "house_interior", chars: [{ id: "sam", action: "peek", expr: "suspicious", pos: "center_left" }], props: [{ id: "door", pos: "center_left" }, { id: "flour_sack", pos: "far_left" }, { id: "oil_can", pos: "center" }, { id: "box", pos: "right" }, { id: "suitcase", pos: "far_right" }] },
        { label: "placed: bed (sleep) · clock · calendar · wanted_poster", grade: "night", bg: "house_interior", chars: [{ id: "tom", action: "sleep", expr: "sleepy", pos: "center" }], props: [{ id: "bed", pos: "center" }, { id: "clock", pos: "left" }, { id: "calendar", pos: "right" }, { id: "wanted_poster", pos: "far_left" }] },
        { label: "placed: chair (sit_chair) · table · desk · footprints", bg: "office", chars: [{ id: "rex", action: "sit_chair", expr: "neutral", pos: "center_left" }], props: [{ id: "chair", pos: "center_left" }, { id: "table", pos: "center_left" }, { id: "footprints", pos: "center_right" }, { id: "small_footprints", pos: "right" }] },
        { label: "placed: car (drive) · bench (sit_chair)", bg: "city", grade: "dusk", seconds: 4, chars: [{ id: "tom", action: "drive", expr: "happy", pos: "far_left", to: "center" }, { id: "ana", action: "sit_chair", expr: "neutral", pos: "far_right" }], props: [{ id: "car", pos: "far_left" }, { id: "bench", pos: "far_right" }] },
        { label: "placed: fire · ship", bg: "lighthouse_exterior", grade: "night", chars: [{ id: "sam", action: "sit", expr: "sad", pos: "center_left" }], props: [{ id: "fire", pos: "center" }, { id: "ship", pos: "right" }] },
      ],
      CAST,
    ),
} satisfies Record<string, () => { project: Project; labels: string[] }>;

export type LowPolyGalleryId = keyof typeof LOW_POLY_GALLERIES;

export function lowPolyGalleryFrames(id: LowPolyGalleryId, view: View = LANDSCAPE): number {
  return buildTimeline(LOW_POLY_GALLERIES[id]().project, { portrait: isPortrait(view) }).total;
}

export function LowPolyGallery({ id, view = LANDSCAPE }: { id: LowPolyGalleryId; view?: View }) {
  const frame = useCurrentFrame();
  const { project: p, labels } = useMemo(() => LOW_POLY_GALLERIES[id](), [id]);
  const timeline = useMemo(() => buildTimeline(p, { portrait: isPortrait(view) }), [p, view]);
  const i = timeline.scenes.findIndex((s) => frame >= s.start && frame < s.start + s.frames);
  return (
    <AbsoluteFill>
      <StoryVideo project={p} view={view} />
      {isPortrait(view) && <SafeGuides />}
      <div style={{ position: "absolute", left: 32, top: isPortrait(view) ? 60 : 28, background: PAPER, color: INK, padding: "8px 18px", borderRadius: 12, fontFamily: "Fredoka, sans-serif", fontWeight: 700, fontSize: isPortrait(view) ? 26 : 30 }}>
        {labels[Math.max(0, i)]}
      </div>
    </AbsoluteFill>
  );
}
