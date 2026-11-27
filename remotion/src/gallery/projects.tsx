import { BACKGROUNDS, assertProject, type BackgroundId, type CastMember, type Project, type Scene } from "@studio/schema";
import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { StoryVideo } from "../scene/StoryVideo";
import { buildTimeline } from "../scene/timeline";
import { LANDSCAPE, PORTRAIT, isPortrait, type View } from "../scene/view";
import { FPS, INK, PAPER } from "../theme";
import { SafeGuides } from "./SafeGuides";

/**
 * Galleries that run through the real pipeline: a small hand-made project
 * (scenes + script + timing.json), validated like any other, played by
 * StoryVideo. What you see here is exactly what a story renders.
 */

type Shot = Partial<Scene> & { label: string; seconds?: number; line?: string };

const LINE = "Nobody saw what happened next, and nobody ever forgot it.";

function project(title: string, shots: Shot[], cast: Record<string, Partial<CastMember> & { color: string }>): { project: Project; labels: string[] } {
  const scenes = shots.map(({ label: _label, seconds: _s, line: _l, ...s }, i) => ({
    id: `S${i + 1}`,
    lineIds: [`L1.${i + 1}`],
    bg: "street",
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
    scenes: { version: 1, title, cast: Object.fromEntries(Object.entries(cast).map(([id, c]) => [id, { name: id, ...c }])), scenes },
    script: { version: 1, lines: shots.map((s, i) => ({ id: `L1.${i + 1}`, text: s.line ?? LINE, energy: 3, delivery: "calm" })) },
    timing: { version: 1, fps: FPS, seconds: Object.fromEntries(shots.map((s, i) => [`S${i + 1}`, s.seconds ?? 3])) },
  };
  return { project: assertProject(`gallery ${title}`, raw), labels: shots.map((s) => s.label) };
}

const CAST = {
  tom: { color: "#d0473d", hat: "keeper_cap", beard: "full", hairColor: "#e9e5dd", build: "round" },
  sam: { color: "#2f9e8f", hat: "beanie", hair: "long", hairColor: "#b5652e", outfit: "scarf", build: "slim", height: 1.08, face: ["freckles"] },
  ana: { color: "#d04f8a", hair: "bob", hairColor: "#1f1a2e", outfit: "dress", face: ["glasses"] },
  rex: { color: "#3f6fd8", hair: "short", hairColor: "#2b2b2b", beard: "moustache", outfit: "tie", build: "broad" },
} as const satisfies Record<string, Partial<CastMember> & { color: string }>;

const NEON = {
  zed: { color: "#3ff0ff", style: "neon", hair: "messy" },
  ivy: { color: "#ff4fd8", style: "neon", hair: "bob", outfit: "dress", face: ["lashes"] },
} as const satisfies Record<string, Partial<CastMember> & { color: string }>;

const duo = (a: string, b: string, extra: Partial<Scene["chars"][number]> = {}): Scene["chars"] => [
  { id: a, action: "talk", expr: "happy", pos: "center_left", ...extra },
  { id: b, action: "idle", expr: "neutral", pos: "center_right" },
];

export const GALLERY_PROJECTS = {
  Travel: () =>
    project(
      "Travel",
      [
        { label: "walk · run · sneak", seconds: 4, chars: [{ id: "tom", action: "walk", expr: "happy", pos: "far_left", to: "far_right" }, { id: "sam", action: "run", expr: "shock", pos: "offscreen_left", to: "offscreen_right" }, { id: "ana", action: "sneak", expr: "suspicious", pos: "left", to: "center_right" }] },
        { label: "trudge · march · skip", seconds: 4, chars: [{ id: "tom", action: "trudge", expr: "sad", pos: "far_right", to: "center" }, { id: "rex", action: "march", expr: "determined", pos: "far_left", to: "center_right" }, { id: "sam", action: "skip", expr: "happy", pos: "offscreen_left", to: "right" }] },
        { label: "flee · carry · crawl · sleepwalk", seconds: 4, bg: "park", chars: [{ id: "sam", action: "flee", expr: "fear", pos: "offscreen_left", to: "offscreen_right" }, { id: "rex", action: "carry", expr: "determined", pos: "far_right", to: "center" }, { id: "tom", action: "crawl", expr: "determined", pos: "left", to: "center_left" }, { id: "ana", action: "sleepwalk", expr: "sleepy", pos: "center_right", to: "right" }], props: [{ id: "box", attach: "rex.hand_r" }] },
        { label: "drive (car travels with the driver)", seconds: 4, bg: "road", chars: [{ id: "tom", action: "drive", expr: "happy", pos: "far_left", to: "far_right" }], props: [{ id: "car", pos: "far_left" }] },
      ],
      CAST,
    ),

  Cameras: () =>
    project(
      "Cameras",
      [
        ...(["static", "slow_push", "shake", "zoom_face", "dolly_out", "pan_left", "pan_right", "whip_pan", "tilt_up", "handheld", "dutch_angle"] as const).map((camera, i) => ({
          label: `camera: ${camera}`,
          camera,
          bg: (["street", "office", "city", "park", "kitchen", "beach"] as const)[i % 6],
          chars: duo("sam", "rex"),
        })),
        { label: "framing: medium (static)", framing: "medium", bg: "cafe", chars: duo("ana", "tom") },
        { label: "framing: medium + slow_push", framing: "medium", camera: "slow_push", bg: "cafe", chars: duo("ana", "tom") },
        { label: "framing: medium, 3 characters", framing: "medium", bg: "classroom", chars: [...duo("ana", "tom"), { id: "sam", action: "think", expr: "confused", pos: "right" }] },
      ],
      CAST,
    ),

  Transitions: () =>
    project(
      "Transitions",
      (["cut", "whoosh_wipe", "smash_cut", "dip_to_black", "crossfade", "iris", "glitch", "page_turn", "cut"] as const).map((transitionIn, i) => ({
        label: `transition in: ${transitionIn}`,
        transitionIn,
        seconds: 2,
        bg: (["street", "forest", "office", "desert", "bedroom", "graveyard", "lab", "park", "city"] as const)[i]!,
        grade: i === 5 ? "night" : "day",
        chars: duo(i % 2 ? "sam" : "tom", i % 2 ? "ana" : "rex"),
      })),
      CAST,
    ),

  Text: () =>
    project(
      "Text",
      [
        { label: "caption: word_pop", caption: "word_pop", seconds: 4, chars: duo("sam", "tom") },
        { label: "caption: karaoke", caption: "karaoke", seconds: 4, bg: "park", chars: duo("ana", "rex") },
        { label: "caption: subtitle", caption: "subtitle", seconds: 4, bg: "hospital", grade: "dusk", chars: duo("tom", "sam", { action: "cry", expr: "crying" }) },
        { label: "caption: punch", caption: "punch", seconds: 3, line: "He was the THIEF.", camera: "zoom_face", bg: "interrogation", chars: [{ id: "rex", action: "gasp", expr: "shock", pos: "center" }] },
        { label: "overlay: title_card", seconds: 3, bg: "forest", overlays: [{ style: "title_card", text: "Chapter 2", sub: "The night of the storm" }], chars: duo("sam", "ana") },
        { label: "overlay: time_card", seconds: 3, bg: "office", overlays: [{ style: "time_card", text: "3 hours later" }], chars: [{ id: "rex", action: "type", expr: "sleepy", pos: "center" }], props: [{ id: "chair", pos: "center" }, { id: "desk", pos: "center" }] },
        { label: "overlay: lower_third", seconds: 3, bg: "city", overlays: [{ style: "lower_third", text: "Rex Harlow", sub: "the bank manager" }], chars: [{ id: "rex", action: "hands_on_hips", expr: "smirk", pos: "center" }] },
        { label: "overlay: map_pin", seconds: 4, bg: "road", overlays: [{ style: "map_pin", text: "Cornwall", sub: "England, 1987" }], chars: [{ id: "tom", action: "drive", expr: "happy", pos: "left" }], props: [{ id: "car", pos: "left" }] },
        { label: "overlay: counter", seconds: 3, bg: "street", overlays: [{ style: "counter", to: 1000000, prefix: "$", label: "stolen in one night" }], chars: [{ id: "sam", action: "gasp", expr: "shock", pos: "center" }] },
      ],
      CAST,
    ),

  Weather: () =>
    project(
      "Weather",
      [
        { label: "weather: rain", weather: "rain", bg: "street", grade: "dusk", seconds: 3, chars: [{ id: "ana", action: "walk", expr: "sad", pos: "left", to: "center" }], props: [{ id: "umbrella", attach: "ana.hand_r" }] },
        { label: "weather: storm", weather: "storm", bg: "lighthouse_exterior", grade: "night", seconds: 6, chars: [{ id: "tom", action: "cower", expr: "fear", pos: "center" }] },
        { label: "weather: snow", weather: "snow", bg: "mountain", grade: "day", seconds: 3, chars: [{ id: "sam", action: "tremble", expr: "sad", pos: "center" }] },
        { label: "weather: fog", weather: "fog", bg: "graveyard", grade: "night", seconds: 3, chars: [{ id: "rex", action: "look_around", expr: "fear", pos: "center" }], props: [{ id: "flashlight", attach: "rex.hand_r" }] },
        { label: "weather: fog (day)", weather: "fog", bg: "forest", grade: "day", seconds: 3, chars: [{ id: "ana", action: "sneak", expr: "suspicious", pos: "left", to: "center" }] },
      ],
      CAST,
    ),

  Neon: () =>
    project(
      "Neon",
      [
        { label: "neon cast · neon grade · rooftop", grade: "neon", bg: "rooftop", chars: [{ id: "zed", action: "dance", expr: "happy", pos: "center_left" }, { id: "ivy", action: "clap", expr: "laughing", pos: "center_right" }] },
        { label: "neon cast · night · city", grade: "night", bg: "city", chars: [{ id: "zed", action: "walk", expr: "happy", pos: "left", to: "center" }, { id: "ivy", action: "wave", expr: "smirk", pos: "right" }] },
      ],
      NEON,
    ),

  /** Every background with people in it, by day and by night: the real framing a scene gets, in either frame. */
  Scenery: () =>
    project(
      "Scenery",
      (Object.keys(BACKGROUNDS) as BackgroundId[]).flatMap((bg): Shot[] => [
        { label: `${bg} · day · duo`, bg, seconds: 2, chars: duo("sam", "rex") },
        { label: `${bg} · night · solo, medium`, bg, grade: "night", framing: "medium", seconds: 2, chars: [{ id: "tom", action: "think", expr: "confused", pos: "center" }] },
      ]),
      CAST,
    ),

  /** How a scene is laid out for the number and spread of its characters. */
  Layouts: () =>
    project(
      "Layouts",
      [
        { label: "solo · centre", bg: "street", chars: [{ id: "sam", action: "talk", expr: "happy", pos: "center" }] },
        { label: "solo · left", bg: "street", chars: [{ id: "sam", action: "talk", expr: "happy", pos: "left" }] },
        { label: "solo · far right", bg: "park", chars: [{ id: "ana", action: "point", expr: "shock", pos: "far_right" }] },
        { label: "solo · medium", bg: "office", framing: "medium", chars: [{ id: "rex", action: "talk", expr: "smirk", pos: "center" }] },
        { label: "duo · centre pair", bg: "kitchen", chars: duo("sam", "rex") },
        { label: "duo · left and right", bg: "cafe", chars: [{ id: "ana", action: "talk", expr: "happy", pos: "left" }, { id: "tom", action: "idle", expr: "neutral", pos: "right" }] },
        { label: "duo · far apart", bg: "beach", chars: [{ id: "sam", action: "wave", expr: "happy", pos: "far_left" }, { id: "rex", action: "idle", expr: "neutral", pos: "far_right" }] },
        { label: "duo · medium", bg: "classroom", framing: "medium", chars: duo("ana", "tom") },
        { label: "trio", bg: "lab", chars: [{ id: "sam", action: "think", expr: "confused", pos: "left" }, { id: "rex", action: "talk", expr: "happy", pos: "center" }, { id: "ana", action: "idle", expr: "neutral", pos: "right" }] },
        { label: "four", bg: "classroom", chars: [{ id: "sam", action: "idle", expr: "neutral", pos: "far_left" }, { id: "rex", action: "talk", expr: "happy", pos: "center_left" }, { id: "ana", action: "idle", expr: "neutral", pos: "center_right" }, { id: "tom", action: "idle", expr: "neutral", pos: "far_right" }] },
        { label: "walker · the frame follows", bg: "road", seconds: 4, chars: [{ id: "tom", action: "walk", expr: "happy", pos: "far_left", to: "far_right" }] },
        { label: "two walkers", bg: "street", seconds: 4, chars: [{ id: "sam", action: "walk", expr: "happy", pos: "left", to: "center_right" }, { id: "ana", action: "walk", expr: "happy", pos: "center_left", to: "far_right" }] },
        { label: "walker enters from off screen", bg: "forest", seconds: 4, chars: [{ id: "ana", action: "sneak", expr: "suspicious", pos: "offscreen_left", to: "center" }, { id: "rex", action: "idle", expr: "neutral", pos: "center_right" }] },
        { label: "typist at a desk", bg: "office", chars: [{ id: "rex", action: "type", expr: "sleepy", pos: "center" }], props: [{ id: "chair", pos: "center" }, { id: "desk", pos: "center" }] },
        { label: "driver in a car", bg: "road", chars: [{ id: "tom", action: "drive", expr: "happy", pos: "center" }], props: [{ id: "car", pos: "center" }] },
        { label: "sleeper in a bed", bg: "bedroom", grade: "night", chars: [{ id: "sam", action: "sleep", expr: "sleepy", pos: "center" }], props: [{ id: "bed", pos: "center" }] },
        { label: "no characters", bg: "lighthouse_exterior", grade: "dusk", chars: [] },
        { label: "held prop", bg: "lighthouse_stairs", grade: "night", chars: [{ id: "tom", action: "sneak", expr: "fear", pos: "left", to: "center_right" }], seconds: 4, props: [{ id: "lantern", attach: "tom.hand_r" }] },
      ],
      CAST,
    ),
} satisfies Record<string, () => { project: Project; labels: string[] }>;

export type GalleryProjectId = keyof typeof GALLERY_PROJECTS;

export function galleryFrames(id: GalleryProjectId, view: View = LANDSCAPE): number {
  return buildTimeline(GALLERY_PROJECTS[id]().project, { portrait: isPortrait(view) }).total;
}

export { PORTRAIT };

/** Plays a gallery project with a label naming what the current scene shows. In the 9:16 frame the label sits in the top interface strip, with the safe zones marked. */
export function GalleryVideo({ id, view = LANDSCAPE, guides }: { id: GalleryProjectId; view?: View; guides?: boolean }) {
  const frame = useCurrentFrame();
  const { project: p, labels } = useMemo(() => GALLERY_PROJECTS[id](), [id]);
  const timeline = useMemo(() => buildTimeline(p), [p]);
  const i = timeline.scenes.findIndex((s) => frame >= s.start && frame < s.start + s.frames);
  return (
    <AbsoluteFill>
      <StoryVideo project={p} view={view} />
      {isPortrait(view) && (guides ?? true) && <SafeGuides />}
      <div style={{ position: "absolute", left: 32, top: isPortrait(view) ? 60 : 28, background: PAPER, color: INK, padding: "8px 18px", borderRadius: 12, fontFamily: "Fredoka, sans-serif", fontWeight: 700, fontSize: isPortrait(view) ? 26 : 30 }}>
        {labels[Math.max(0, i)]}
      </div>
    </AbsoluteFill>
  );
}
