import type { CastMember as CastMemberT, ExpressionId } from "@studio/schema";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ACTION_LIB } from "../library/actions";
import { alive, blink } from "../rig/animate";
import { Figure } from "../rig/Figure";
import { H, PAPER, W, hash01 } from "../theme";
import { Cell, cast } from "./kit";

/**
 * Cast looks: colours, hats, hair, beards, face features, builds, heights,
 * outfits, and the neon style (bottom row, on a dark card). Every look option
 * appears at least once.
 */
type Entry = { title: string; sub: string; look: Partial<CastMemberT> & { color: string }; expr?: ExpressionId; action?: "idle" | "talk" | "celebrate" | "walk" };

export const CAST_ENTRIES: Entry[] = [
  { title: "keeper", sub: "round · full beard · keeper_cap", look: { color: "#d0473d", hat: "keeper_cap", beard: "full", hairColor: "#e9e5dd", build: "round" } },
  { title: "student", sub: "slim · long · scarf · freckles", look: { color: "#2f9e8f", hat: "beanie", hair: "long", hairColor: "#b5652e", outfit: "scarf", build: "slim", height: 1.08, face: ["freckles"] }, expr: "happy" },
  { title: "boss", sub: "broad · tie · moustache", look: { color: "#3f6fd8", hair: "short", hairColor: "#2b2b2b", beard: "moustache", outfit: "tie", build: "broad" }, expr: "smirk", action: "talk" },
  { title: "detective", sub: "fedora · stubble · tie", look: { color: "#a8763e", hat: "fedora", beard: "stubble", outfit: "tie", height: 1.1, face: ["nose"] }, expr: "suspicious" },
  { title: "queen", sub: "crown · dress · cape · lashes", look: { color: "#8e3fd0", hat: "crown", hair: "bun", hairColor: "#7a4b2a", outfit: "cape", face: ["lashes", "blush"] }, expr: "smirk" },
  { title: "kid", sub: "scale 0.7 · ponytail · backpack", look: { color: "#e0a24e", hair: "ponytail", hairColor: "#5a3825", outfit: "backpack", scale: 0.7 }, expr: "happy", action: "celebrate" },
  { title: "chef", sub: "chef_hat · round · goatee", look: { color: "#d0473d", hat: "chef_hat", beard: "goatee", build: "round", height: 0.9 } },
  { title: "builder", sub: "hard_hat · broad · short", look: { color: "#e07b2a", hat: "hard_hat", hair: "short", build: "broad", height: 1.15 }, expr: "determined" },
  { title: "artist", sub: "beret · bob · glasses · dress", look: { color: "#d04f8a", hat: "beret", hair: "bob", hairColor: "#1f1a2e", outfit: "dress", face: ["glasses"] }, expr: "happy", action: "talk" },
  { title: "cowboy", sub: "cowboy_hat · moustache", look: { color: "#b5532e", hat: "cowboy_hat", beard: "moustache", hairColor: "#6b4426", height: 1.2, build: "slim" }, expr: "smirk" },
  { title: "officer", sub: "police_cap · sunglasses", look: { color: "#2c4a8a", hat: "police_cap", face: ["sunglasses"], outfit: "tie" }, expr: "deadpan" },
  { title: "pirate", sub: "eyepatch · curly · full beard", look: { color: "#c0392b", hair: "curly", hairColor: "#2b1b12", beard: "full", face: ["eyepatch"], build: "broad" }, expr: "laughing" },
  { title: "fan", sub: "baseball_cap · messy", look: { color: "#1f9d55", hat: "baseball_cap", hair: "messy", hairColor: "#c9a227" }, expr: "shock", action: "walk" },
  { title: "line + fill", sub: "custom line #3b2a6b, fill #ffe9c7", look: { color: "#f2994a", line: "#3b2a6b", fill: "#ffe9c7", hair: "messy", hairColor: "#3b2a6b" }, expr: "happy" },
  { title: "gent", sub: "top_hat · slim · tall", look: { color: "#6d2e46", hat: "top_hat", beard: "moustache", build: "slim", height: 1.25 } },
];

export const NEON_ENTRIES: Entry[] = [
  { title: "neon · cyan", sub: "style neon", look: { color: "#3ff0ff", style: "neon", hair: "messy" }, expr: "happy", action: "talk" },
  { title: "neon · pink", sub: "neon · bob · dress", look: { color: "#ff4fd8", style: "neon", hair: "bob", outfit: "dress", face: ["lashes"] }, expr: "smirk" },
  { title: "neon · lime", sub: "neon · cap · round", look: { color: "#b6ff3f", style: "neon", hat: "baseball_cap", build: "round" }, expr: "laughing", action: "celebrate" },
  { title: "neon · amber", sub: "neon · fedora · tie", look: { color: "#ffb02e", style: "neon", hat: "fedora", outfit: "tie", beard: "stubble" }, expr: "suspicious" },
  { title: "neon · violet", sub: "neon · crown · cape", look: { color: "#a06bff", style: "neon", hat: "crown", outfit: "cape", hair: "long" }, expr: "determined", action: "walk" },
];

function Char({ e, cx, gy, k, dark }: { e: Entry; cx: number; gy: number; k: number; dark?: boolean }) {
  const frame = useCurrentFrame();
  const phase = hash01(e.title);
  const def = ACTION_LIB[e.action ?? "idle"];
  const { pose, breath } = alive(def, frame, phase);
  const prev = alive(def, frame - 1, phase).pose;
  const c = cast(e.look);
  return (
    <g transform={`translate(${cx} ${gy}) scale(${k})`}>
      <Figure
        pose={{ ...pose, x: 0 }} prevPose={{ ...prev, x: 0 }} breath={breath} x={0} groundY={0} facing={1} cast={c}
        expr={e.expr ?? "neutral"} silhouette={false} blink={blink(frame, phase)} tod={dark ? "night" : "day"} frame={frame} attachments={[]}
      />
    </g>
  );
}

export function CastGallery() {
  const cols = 5;
  const rowsTop = Math.ceil(CAST_ENTRIES.length / cols);
  const w = W / cols;
  const h = H / (rowsTop + 1);
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        {CAST_ENTRIES.map((e, i) => (
          <Cell key={e.title} x={(i % cols) * w} y={Math.floor(i / cols) * h} w={w} h={h} title={e.title} sub={e.sub}>
            <Char e={e} cx={w / 2} gy={h - 56} k={0.42} />
          </Cell>
        ))}
        {NEON_ENTRIES.map((e, i) => (
          <Cell key={e.title} x={i * w} y={rowsTop * h} w={w} h={h} title={e.title} sub={e.sub} dark>
            <Char e={e} cx={w / 2} gy={h - 56} k={0.42} dark />
          </Cell>
        ))}
      </svg>
    </AbsoluteFill>
  );
}
