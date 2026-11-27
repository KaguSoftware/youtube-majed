/**
 * The storyboard step (docs/PLAN.md section 2 step 6, section 6): Claude
 * writes scene JSON for the locked script, code checks and repairs it.
 *
 *   1. `cast` (one call): cast, a look per loop (locations, grade, music
 *      mood), how each plant is shown.
 *   2. `storyboard` (one call per batch of whole loops, ≤ MAX_BATCH_LINES
 *      lines; batches run a few at a time): scenes for every line.
 *   3. Code, on the drafts:
 *      - every library id is checked against the catalogue (read from
 *        catalogue.ts at run time); an unknown id becomes the closest library
 *        item and is flagged; one with no close match breaks its scene;
 *      - repairs that don't change a shot's meaning (a held prop with no
 *        hand, a `to` on an action that doesn't travel, a missing line in the
 *        middle of a scene's range);
 *      - every head-fake line starts its own shot with a reveal device;
 *      - variety guard: the same background with the same actions within
 *        ~30 s sends the scene back to Claude; the same moving camera within
 *        ~30 s (unless every other move has been used since) is swapped by
 *        code; combos used in the last 3 storyboarded projects get a
 *        different camera.
 *   4. Broken scenes (and repeated pictures) go back to Claude in ONE repair
 *      call; anything still broken gets a plain fallback shot, flagged.
 *   5. The result is validated with the strict SceneFile schema and written to
 *      projects/<id>/storyboard/{scenes,storyboard}.json.
 */
import { REPO_DIR, projectPaths, projectsDir, readJson, readVoice, storyboardPaths, writeJson } from "@studio/project";
import {
  ACTIONS,
  BACKGROUNDS,
  CastMember,
  CATALOGUE,
  CAMERAS,
  DEFAULT_WPM,
  MUSIC_MOODS,
  PROPS,
  SceneFile,
  ScriptFile,
  StoryboardFile,
  TRANSITIONS,
  VarietyFile,
  type AvoidLists,
  type VarietyReport,
  ValidationError,
  closest,
  formatIssues,
  idsOf,
  type CastOutput,
  type CatalogueSection,
  type DraftScene,
  type Reveal,
  type StoryboardFlag,
  type StoryboardOutput,
  type VoiceFile,
} from "@studio/schema";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { sfxVocabulary } from "./assets";
import { callStep } from "./call";
import { allFeatures, avoidFrom, avoidInput, featuresFromScenes, historyOf, scoreFeatures, type LooseScene } from "./variety";
import { StoryError, readBrief, readLoopMap, readNarration, readPick, type RunOpts } from "./story";
import { typicalDurationMs } from "./usage";

type SceneIn = z.input<typeof SceneFile>["scenes"][number];
export type Shot = Omit<SceneIn, "id">;

export const VARIETY_WINDOW_S = 30;
export const MAX_BATCH_LINES = Number(process.env.STUDIO_STORYBOARD_BATCH_LINES ?? 40);
const CONCURRENCY = Number(process.env.STUDIO_STORYBOARD_CONCURRENCY ?? 3);
const HISTORY = 3;

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const now = () => new Date().toISOString();

// ---------------------------------------------------------------- the library, as Claude sees it

/** The catalogue as compact text, generated from catalogue.ts on every run (never a hand-written copy). */
export function libraryForClaude(sections: readonly CatalogueSection[] = Object.keys(CATALOGUE) as CatalogueSection[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const section of sections) {
    const entries: Record<string, string> = {};
    for (const [id, raw] of Object.entries(CATALOGUE[section])) {
      const e = raw as Record<string, unknown> & { description: string };
      const notes: string[] = [];
      if (section === "actions") notes.push(e.travels ? "travels" : "stays", String(e.kind));
      if (section === "backgrounds") notes.push(e.interior ? "interior" : "outdoor");
      if (section === "props") notes.push(`placement: ${String(e.placement)}`);
      if (section === "grades") notes.push(String(e.timeOfDay));
      entries[id] = notes.length ? `${e.description} [${notes.join(", ")}]` : e.description;
    }
    out[section] = entries;
  }
  return out;
}

export const catalogueHash = () => hash(CATALOGUE);

const descOf = (section: CatalogueSection, id: string) => (CATALOGUE[section] as Record<string, { description: string }>)[id]?.description ?? "";
const travels = (action: string) => Boolean((ACTIONS as Record<string, { travels?: boolean }>)[action]?.travels);
const placementOf = (prop: string) => (PROPS as Record<string, { placement?: string }>)[prop]?.placement;
const interior = (bg: string) => Boolean((BACKGROUNDS as Record<string, { interior?: boolean }>)[bg]?.interior);

/** A cast member's look as JSON Schema, generated from scene.ts on every run, so the cast step follows the rig as it grows. */
export function castLookSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(CastMember.omit({ name: true }), { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function unwrap(s: z.ZodType): z.ZodType {
  let t = s as z.ZodType & { def: { type: string; innerType?: z.ZodType } };
  while ((t.def.type === "default" || t.def.type === "optional" || t.def.type === "nullable") && t.def.innerType) t = t.def.innerType as typeof t;
  return t;
}
const enumOptions = (s: z.ZodType): string[] | undefined => {
  const t = unwrap(s) as z.ZodType & { def: { type: string }; options?: readonly string[] };
  return t.def.type === "enum" ? [...(t.options ?? [])] : undefined;
};

/**
 * Turns the cast step's look JSON into a valid CastMember: library ids are
 * mapped to the closest known id (flagged), unknown fields dropped, and any
 * field that still fails is dropped so its default applies.
 */
export function normaliseLook(id: string, name: string, look: string): { member: CastMember; flags: string[] } {
  const flags: string[] = [];
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(look);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
    else flags.push(`cast "${id}": look is not a JSON object; used the defaults`);
  } catch {
    flags.push(`cast "${id}": look is not valid JSON; used the defaults`);
  }
  const shape = CastMember.shape as Record<string, z.ZodType>;
  const out: Record<string, unknown> = { name };
  for (const [key, value] of Object.entries(raw)) {
    if (key === "name") continue;
    const field = shape[key];
    if (!field) {
      flags.push(`cast "${id}": "${key}" is not a look field; dropped`);
      continue;
    }
    const mapOne = (v: unknown, options: string[]) => {
      if (typeof v !== "string" || options.includes(v)) return v;
      const near = closest(v, options);
      flags.push(near ? `cast "${id}": unknown ${key} "${v}" → "${near}"` : `cast "${id}": unknown ${key} "${v}"; dropped`);
      return near;
    };
    const options = enumOptions(field);
    const inner = unwrap(field) as z.ZodType & { def: { type: string; element?: z.ZodType } };
    if (options) out[key] = mapOne(value, options);
    else if (inner.def.type === "array" && inner.def.element && enumOptions(inner.def.element) && Array.isArray(value)) {
      out[key] = value.map((v) => mapOne(v, enumOptions(inner.def.element!)!)).filter((v) => v !== undefined);
    } else out[key] = value;
    if (out[key] === undefined) delete out[key];
  }
  for (let i = 0; i < 10; i++) {
    const r = CastMember.safeParse(out);
    if (r.success) return { member: r.data, flags };
    const bad = new Set(r.error.issues.map((x) => String(x.path[0] ?? "")));
    for (const key of bad) {
      if (key === "name" || !(key in out)) continue;
      flags.push(`cast "${id}": ${key} ${JSON.stringify(out[key])} is not valid; used the default`);
      delete out[key];
    }
    if (![...bad].some((k) => k in out || k === "")) break;
  }
  return { member: CastMember.parse({ name }), flags };
}

/** Cameras and transitions that sell a reveal, read from their descriptions so new library items count too. */
const REVEALING = /reveal|reaction|shock|impact/i;
export const revealCameras = (): string[] => idsOf("cameras").filter((c) => REVEALING.test(descOf("cameras", c)));
export const revealTransitions = (): string[] => idsOf("transitions").filter((t) => REVEALING.test(descOf("transitions", t)));
const STILL_CAMERA = "static" in CAMERAS ? "static" : idsOf("cameras")[0]!;
const PLAIN_TRANSITION = "cut" in TRANSITIONS ? "cut" : idsOf("transitions")[0]!;

// ---------------------------------------------------------------- the story, as the storyboard reads it

export type SLine = { id: string; text: string; energy: number; delivery: string; beats: string[]; plants: string[]; payoffs: string[] };
export type SLoop = { id: string; title: string; question: string; stakes?: { type: string; text: string }; headFake?: { expected: string; actual: string }; lines: SLine[] };
export type LineTime = { start: number; end: number; words: number };
export type Story = {
  id: string;
  /** narration: the locked story-engine script with beats; script: a bare script.json (head fakes = energy 5 lines) */
  source: "narration" | "script";
  video: { title: string; format: "youtube" | "reel"; minutes: number; narrative: string; factual: boolean };
  loops: SLoop[];
  plants: { id: string; detail: string; loopId: string; paysOffIn: string }[];
  times: Map<string, LineTime>;
  timedBy: "voice" | "estimate";
  seconds: number;
};

const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** Line times from voice.json when the script has been voiced with its current text, else estimated at the brief's rate. */
export function lineTimes(lines: readonly SLine[], voice: VoiceFile | undefined, wpm: number): { times: Map<string, LineTime>; timedBy: "voice" | "estimate"; seconds: number } {
  const voiced = voice ? new Map(voice.lines.map((l) => [l.id, l])) : undefined;
  if (voiced && lines.every((l) => voiced.get(l.id)?.text === l.text)) {
    const times = new Map(lines.map((l) => {
      const v = voiced.get(l.id)!;
      return [l.id, { start: v.words[0]!.start, end: v.words.at(-1)!.end, words: v.words.length }];
    }));
    return { times, timedBy: "voice", seconds: voice!.track.duration };
  }
  const times = new Map<string, LineTime>();
  let t = 0.4;
  lines.forEach((l, i) => {
    const n = words(l.text).length;
    const d = (n / wpm) * 60 * 0.85; // wpm includes pauses; speech alone is faster
    times.set(l.id, { start: t, end: t + d, words: n });
    const next = lines[i + 1];
    const end = l.text.trim().slice(-1);
    t += d + (next && next.id.split(".")[0] !== l.id.split(".")[0] ? 0.7 : end === "…" ? 0.5 : /[.!?]/.test(end) ? 0.3 : 0.05);
  });
  return { times, timedBy: "estimate", seconds: t + 1 };
}

/** A bare sample's title (remotion/samples/<id>/scenes.json), when the project has no brief. */
function sampleTitle(id: string): string | undefined {
  const f = join(REPO_DIR, "remotion", "samples", id, "scenes.json");
  try {
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as { title?: string }).title : undefined;
  } catch {
    return undefined;
  }
}

export function loadStory(id: string): Story {
  const script = readJson(projectPaths(id).scriptJson, ScriptFile);
  if (!script) throw new StoryError(`project "${id}" has no locked script (script.json); lock it first: \`pnpm story lock ${id}\``);
  let brief;
  try {
    brief = readBrief(id);
  } catch {
    brief = undefined; // a bare sample (lighthouse) has a script but no brief
  }
  const narration = brief ? readNarration(id) : undefined;
  const loopmap = brief ? readLoopMap(id) : undefined;
  const pick = brief ? readPick(id) : undefined;

  let loops: SLoop[];
  let source: Story["source"];
  if (narration?.lockedAt) {
    source = "narration";
    const byScript = new Map(script.lines.map((l) => [l.id, l]));
    for (const l of narration.loops.flatMap((x) => x.lines)) {
      if (byScript.get(l.id)?.text !== l.text) throw new StoryError(`script.json and the narration disagree on ${l.id}; lock the script again`);
    }
    loops = narration.loops.map((loop) => {
      const plan = loopmap?.loops.find((x) => x.id === loop.id);
      return {
        id: loop.id,
        title: plan?.title ?? loop.id,
        question: plan?.question ?? "",
        ...(plan ? { stakes: plan.stakes, headFake: { expected: plan.headFake.expected, actual: plan.headFake.actual } } : {}),
        lines: loop.lines.map((l) => ({ id: l.id, text: l.text, energy: l.energy, delivery: l.delivery, beats: [...l.beats], plants: [...l.plants], payoffs: [...l.payoffs] })),
      };
    });
  } else {
    if (narration && !narration.lockedAt) throw new StoryError(`the script of "${id}" is not locked; lock it first: \`pnpm story lock ${id}\``);
    // A bare script has no beats: its head fakes are its energy-5 lines (the voice rules reserve 5 for reveals).
    source = "script";
    const byLoop = new Map<string, SLine[]>();
    for (const l of script.lines) {
      const loop = l.id.split(".")[0]!;
      const list = byLoop.get(loop) ?? [];
      list.push({ id: l.id, text: l.text, energy: l.energy, delivery: l.delivery, beats: l.energy >= 5 ? ["headfake"] : [], plants: [], payoffs: [] });
      byLoop.set(loop, list);
    }
    loops = [...byLoop].map(([loopId, lines]) => ({ id: loopId, title: loopId, question: "", lines }));
  }

  const all = loops.flatMap((l) => l.lines);
  const voice = readVoice(id);
  const { times, timedBy, seconds } = lineTimes(all, voice?.ok ? voice.data : undefined, brief?.wpm ?? DEFAULT_WPM);
  return {
    id,
    source,
    video: {
      title: pick?.option.title ?? brief?.sentence ?? sampleTitle(id) ?? id,
      format: brief?.format ?? "youtube",
      minutes: brief?.minutes ?? Math.round((seconds / 60) * 10) / 10,
      narrative: brief?.narrative ?? "mystery",
      factual: brief?.factual ?? false,
    },
    loops,
    plants: loopmap?.plants ?? [],
    times,
    timedBy,
    seconds,
  };
}

/** Whole loops packed into batches of at most `max` lines (a longer loop is a batch on its own). */
export function batchLoops(loops: readonly SLoop[], max: number = MAX_BATCH_LINES): SLoop[][] {
  const batches: SLoop[][] = [];
  let current: SLoop[] = [];
  let count = 0;
  for (const loop of loops) {
    if (current.length && count + loop.lines.length > max) {
      batches.push(current);
      current = [];
      count = 0;
    }
    current.push(loop);
    count += loop.lines.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

// ---------------------------------------------------------------- normalising a draft scene

type Flag = Omit<StoryboardFlag, "sceneId">;
export type Slot = { lineIds: string[]; shot?: Shot; problems: string[]; flags: Flag[]; why: string };

export type Ctx = { cast: Set<string>; sfx: Record<string, string>; lineWords: Map<string, number>; protagonist: string };

const NOUN: Partial<Record<CatalogueSection, string>> = { actions: "action", expressions: "expression", backgrounds: "background", props: "prop", cameras: "camera move", transitions: "transition", grades: "grade", captions: "caption style", positions: "position" };

/** Maps a library id: exact, else the closest (flagged), else undefined with a problem. */
function mapId(section: CatalogueSection, value: string, slot: Slot): string | undefined {
  const ids = idsOf(section) as string[];
  if (ids.includes(value)) return value;
  const near = closest(value, ids);
  if (near) {
    slot.flags.push({ kind: "mapped", message: `unknown ${NOUN[section] ?? section} "${value}" → "${near}"`, fixed: true });
    return near;
  }
  slot.problems.push(`"${value}" is not a ${NOUN[section] ?? section} in the library`);
  return undefined;
}

export function normaliseShot(d: DraftScene, lineIds: string[], ctx: Ctx): Slot {
  const slot: Slot = { lineIds, problems: [], flags: [], why: d.why };
  const repaired = (message: string) => slot.flags.push({ kind: "repaired", message, fixed: true });
  const bg = mapId("backgrounds", d.bg, slot);
  const grade = mapId("grades", d.grade, slot);
  const camera = mapId("cameras", d.camera, slot);
  const transitionIn = mapId("transitions", d.transitionIn, slot);
  const caption = mapId("captions", d.caption, slot);

  const chars: Shot["chars"] = [];
  for (const c of d.chars) {
    let id: string | undefined = c.id;
    if (!ctx.cast.has(id)) {
      const near = closest(id, [...ctx.cast]);
      if (near) slot.flags.push({ kind: "mapped", message: `"${c.id}" is not in the cast → "${near}"`, fixed: true });
      else slot.problems.push(`"${c.id}" is not in the cast (${[...ctx.cast].join(", ")})`);
      id = near;
    }
    if (!id) continue;
    if (chars.some((x) => x.id === id)) {
      repaired(`"${id}" appeared twice; kept the first`);
      continue;
    }
    if (chars.length === 4) {
      repaired(`more than 4 characters; dropped "${id}"`);
      continue;
    }
    const action = mapId("actions", c.action, slot);
    const expr = mapId("expressions", c.expr, slot);
    const pos = mapId("positions", c.pos, slot);
    if (!action || !expr || !pos) continue;
    let to: string | undefined = c.to ? mapId("positions", c.to, slot) : undefined;
    if (to && !travels(action)) {
      repaired(`"${action}" doesn't travel; dropped its "to"`);
      to = undefined;
    }
    chars.push({ id, action: action as never, expr: expr as never, pos: pos as never, ...(to ? { to: to as never } : {}), ...(c.facing !== "auto" ? { facing: c.facing } : {}), ...(c.look === "silhouette" ? { look: "silhouette" as const } : {}) });
  }

  const props: NonNullable<Shot["props"]> = [];
  const owners = new Set(chars.map((c) => c.id));
  const freePos = () => (["center_left", "center_right", "left", "right", "center"].find((p) => !chars.some((c) => c.pos === p) && !props.some((x) => x.pos === p)) ?? "center") as never;
  for (const p of d.props.slice(0, 4)) {
    const id = mapId("props", p.id, slot);
    if (!id) continue;
    const placement = placementOf(id);
    const attachOk = /^[a-z][a-z0-9_]*\.(hand_r|hand_l|head)$/.test(p.attach) && owners.has(p.attach.split(".")[0]!);
    const pos = p.pos ? mapId("positions", p.pos, slot) : undefined;
    const holder = chars[0] ? `${chars[0].id}.hand_r` : undefined;
    if (placement === "hand") {
      if (attachOk) props.push({ id: id as never, attach: p.attach });
      else if (holder) {
        props.push({ id: id as never, attach: holder });
        repaired(`"${id}" must be held; put it in ${holder}`);
      } else slot.flags.push({ kind: "dropped", message: `"${id}" must be held but nobody is in the shot; dropped it`, fixed: true });
    } else if (placement === "hand_or_ground") {
      if (attachOk) props.push({ id: id as never, attach: p.attach });
      else if (pos) props.push({ id: id as never, pos: pos as never });
      else {
        props.push({ id: id as never, ...(holder ? { attach: holder } : { pos: freePos() }) });
        repaired(`"${id}" had neither a hand nor a position; gave it one`);
      }
    } else if (placement === "horizon") {
      if (bg && interior(bg)) slot.flags.push({ kind: "dropped", message: `"${id}" needs an outdoor sea background, not "${bg}"; dropped it`, fixed: true });
      else props.push({ id: id as never });
    } else if (placement === "wall" && bg && !interior(bg)) {
      slot.flags.push({ kind: "dropped", message: `"${id}" hangs on a wall; "${bg}" has none; dropped it`, fixed: true });
    } else {
      if (!pos) repaired(`"${id}" needs a position; placed it`);
      props.push({ id: id as never, pos: (pos ?? freePos()) as never });
    }
  }

  const sfx: NonNullable<Shot["sfx"]> = [];
  const known = Object.keys(ctx.sfx);
  for (const s of d.sfx.slice(0, 3)) {
    let tag: string | undefined = s.tag;
    if (known.length && !known.includes(tag)) {
      tag = closest(tag, known);
      slot.flags.push(tag ? { kind: "mapped", message: `unknown sound "${s.tag}" → "${tag}"`, fixed: true } : { kind: "dropped", message: `unknown sound "${s.tag}"; dropped it`, fixed: true });
    }
    if (!tag) continue;
    const [lineId, word] = s.at.split(":") as [string, string];
    if (!lineIds.includes(lineId)) {
      slot.flags.push({ kind: "dropped", message: `sound "${tag}" at ${s.at} is not on one of this shot's lines; dropped it`, fixed: true });
      continue;
    }
    const max = (ctx.lineWords.get(lineId) ?? 1) - 1;
    const index = Math.min(Number(word), max);
    if (index !== Number(word)) repaired(`sound "${tag}" pointed past the end of ${lineId}; moved it to the last word`);
    sfx.push({ tag, at: `${lineId}:${index}` });
  }

  if (bg && grade && camera && transitionIn && caption) {
    slot.shot = { lineIds, bg: bg as never, grade: grade as never, chars, props, camera: camera as never, transitionIn: transitionIn as never, sfx, caption: caption as never };
  }
  return slot;
}

/**
 * Turns one call's draft scenes into slots covering `lines` exactly once, in
 * order. Lines skipped inside a scene's range are folded into it; lines
 * covered twice keep their first scene; lines no scene covers become an empty
 * slot with a problem (sent back to Claude).
 */
export function cover(drafts: readonly DraftScene[], lines: readonly string[], ctx: Ctx): Slot[] {
  const index = new Map(lines.map((id, i) => [id, i]));
  const slots: Slot[] = [];
  let last = -1;
  const gap = (from: number, to: number) => {
    if (to >= from) slots.push({ lineIds: lines.slice(from, to + 1), problems: ["no scene covered these lines"], flags: [], why: "" });
  };
  for (const d of drafts) {
    const known = d.lineIds.map((id) => index.get(id)).filter((i): i is number => i !== undefined);
    const outside = d.lineIds.length - known.length;
    const fresh = known.filter((i) => i > last);
    if (!fresh.length) continue;
    const first = Math.min(...fresh);
    const end = Math.max(...fresh);
    gap(last + 1, first - 1);
    const ids = lines.slice(first, end + 1);
    const slot = normaliseShot(d, ids, ctx);
    if (outside) slot.flags.push({ kind: "repaired", message: `dropped ${outside} line id(s) that are not in this batch`, fixed: true });
    if (ids.length !== fresh.length) slot.flags.push({ kind: "repaired", message: `filled skipped line(s) inside ${ids[0]}–${ids.at(-1)}`, fixed: true });
    if (fresh.length < known.length) slot.flags.push({ kind: "repaired", message: "dropped line(s) another scene already covered", fixed: true });
    slots.push(slot);
    last = end;
  }
  gap(last + 1, lines.length - 1);
  return slots;
}

// ---------------------------------------------------------------- checks on the whole storyboard

const actionsOf = (s: Shot) => s.chars.map((c) => c.action).sort().join("+") || "-";
const pictureOf = (s: Shot) => `${s.bg}|${actionsOf(s)}`;
export const comboOf = (s: Shot) => `${pictureOf(s)}|${s.camera}`;

/** Head-fake lines that don't start a shot get one; every head-fake shot gets a reveal device. */
export function ensurePayoffs(slots: Slot[], headfakes: ReadonlySet<string>): void {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const k = slot.lineIds.findIndex((id) => headfakes.has(id));
    if (k > 0 && slot.shot) {
      const before: Slot = { ...slot, lineIds: slot.lineIds.slice(0, k), shot: { ...slot.shot, lineIds: slot.lineIds.slice(0, k), sfx: slot.shot.sfx?.filter((s) => slot.lineIds.slice(0, k).includes(s.at.split(":")[0]!)) }, flags: [...slot.flags] };
      const after: Slot = { lineIds: slot.lineIds.slice(k), shot: { ...slot.shot, lineIds: slot.lineIds.slice(k), sfx: slot.shot.sfx?.filter((s) => slot.lineIds.slice(k).includes(s.at.split(":")[0]!)), transitionIn: PLAIN_TRANSITION as never }, problems: [], flags: [{ kind: "payoff", message: `head fake ${slot.lineIds[k]} was inside a shot; it now starts its own`, fixed: true }], why: "reveal" };
      slots.splice(i, 1, before, after);
      continue; // the new slot is checked on the next turn
    }
    if (k !== 0 || !slot.shot) continue;
    const shot = slot.shot;
    if (revealTransitions().includes(shot.transitionIn) || revealCameras().includes(shot.camera)) continue;
    const faceCam = revealCameras().find((c) => /face/.test(c + descOf("cameras", c)));
    if (shot.chars.length && faceCam) {
      shot.camera = faceCam as never;
      slot.flags.push({ kind: "payoff", message: `head fake ${slot.lineIds[0]} had no reveal device; camera → ${faceCam}`, fixed: true });
    } else if (revealTransitions()[0]) {
      shot.transitionIn = revealTransitions()[0] as never;
      slot.flags.push({ kind: "payoff", message: `head fake ${slot.lineIds[0]} had no reveal device; transition → ${shot.transitionIn}`, fixed: true });
    }
  }
}

/** Repeated pictures (same background and actions) within the window: index of the repeat → index of the earlier shot. */
export function pictureRepeats(slots: readonly Slot[], startOf: (s: Slot) => number, window = VARIETY_WINDOW_S): Map<number, number> {
  const hits = new Map<number, number>();
  slots.forEach((s, i) => {
    if (!s.shot) return;
    for (let j = i - 1; j >= 0 && startOf(s) - startOf(slots[j]!) <= window; j--) {
      const o = slots[j]!.shot;
      if (o && pictureOf(o) === pictureOf(s.shot)) {
        hits.set(i, j);
        break;
      }
    }
  });
  return hits;
}

/** Is `camera` free at slot i: not used by a shot within the window, unless every other moving camera has been used since. */
function cameraFree(slots: readonly Slot[], i: number, camera: string, startOf: (s: Slot) => number, window: number): boolean {
  if (camera === STILL_CAMERA) return true;
  const moving = idsOf("cameras").filter((c) => c !== STILL_CAMERA && c !== camera);
  const since = new Set<string>();
  for (let j = i - 1; j >= 0 && startOf(slots[i]!) - startOf(slots[j]!) <= window; j--) {
    const c = slots[j]!.shot?.camera;
    if (c === camera) return j < i - 1 && moving.every((m) => since.has(m));
    if (c) since.add(c);
  }
  return true;
}

/** Is `camera` unused by the shots after slot i within the window (static is always free)? */
function freeAhead(slots: readonly Slot[], i: number, camera: string, startOf: (s: Slot) => number, window: number): boolean {
  if (camera === STILL_CAMERA) return true;
  for (let k = i + 1; k < slots.length && startOf(slots[k]!) - startOf(slots[i]!) <= window; k++) if (slots[k]!.shot?.camera === camera) return false;
  return true;
}

/** Swaps repeated moving cameras. A head fake whose camera is its reveal device only gets another reveal camera (or a smash cut). */
export function fixCameras(slots: Slot[], headfakes: ReadonlySet<string>, startOf: (s: Slot) => number, window = VARIETY_WINDOW_S): void {
  slots.forEach((slot, i) => {
    const shot = slot.shot;
    if (!shot || cameraFree(slots, i, shot.camera, startOf, window)) return;
    const was = shot.camera;
    const isReveal = headfakes.has(slot.lineIds[0]!) && !revealTransitions().includes(shot.transitionIn);
    const sameKind = (c: string) => revealCameras().includes(c) === revealCameras().includes(was);
    const pool = isReveal ? revealCameras() : [...idsOf("cameras").filter((c) => c !== STILL_CAMERA && sameKind(c)), STILL_CAMERA];
    const pick = pool.find((c) => c !== was && cameraFree(slots, i, c, startOf, window));
    if (pick) {
      shot.camera = pick as never;
      slot.flags.push({ kind: "variety", message: `camera "${was}" repeated within ${window} s → "${pick}"`, fixed: true });
    } else if (isReveal && revealTransitions()[0]) {
      shot.transitionIn = revealTransitions()[0] as never;
      shot.camera = STILL_CAMERA as never;
      slot.flags.push({ kind: "variety", message: `reveal camera "${was}" repeated within ${window} s → ${shot.transitionIn} in, ${STILL_CAMERA} camera`, fixed: true });
    } else {
      slot.flags.push({ kind: "variety", message: `camera "${was}" repeated within ${window} s; no free alternative`, fixed: false });
    }
  });
}

/** Combos (background · actions · camera) of the last few storyboarded projects, newest first. */
export function recentCombos(except: string, n = HISTORY): { projects: string[]; combos: Set<string> } {
  const dir = projectsDir();
  if (!existsSync(dir)) return { projects: [], combos: new Set() };
  const done = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== except)
    .flatMap((d) => {
      try {
        const r = readJson(storyboardPaths(d.name).report, StoryboardFile);
        return r ? [{ id: d.name, at: r.createdAt, combos: r.combos }] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, n);
  return { projects: done.map((d) => d.id), combos: new Set(done.flatMap((d) => d.combos)) };
}

/** Gives a shot whose combo appeared in a recent video a camera that makes it new (without breaking the camera rule). */
export function avoidRecent(slots: Slot[], recent: ReadonlySet<string>, headfakes: ReadonlySet<string>, startOf: (s: Slot) => number, window = VARIETY_WINDOW_S): void {
  if (!recent.size) return;
  slots.forEach((slot, i) => {
    const shot = slot.shot;
    if (!shot || !recent.has(comboOf(shot))) return;
    const was = shot.camera;
    const isReveal = headfakes.has(slot.lineIds[0]!) && !revealTransitions().includes(shot.transitionIn);
    const pool = isReveal ? revealCameras() : idsOf("cameras");
    const pick = pool.find((c) => c !== was && !recent.has(`${pictureOf(shot)}|${c}`) && cameraFree(slots, i, c, startOf, window) && freeAhead(slots, i, c, startOf, window));
    if (pick) {
      shot.camera = pick as never;
      slot.flags.push({ kind: "variety", message: `"${comboOf({ ...shot, camera: was as never })}" was used in a recent video → camera "${pick}"`, fixed: true });
    } else slot.flags.push({ kind: "variety", message: `"${comboOf(shot)}" was used in a recent video; no free camera to change it`, fixed: false });
  });
}

/** The scenes of a draft, in the shape the variety guard reads. */
const looseOf = (slots: readonly Slot[]): LooseScene[] =>
  slots.flatMap((s, i) => (s.shot ? [{ ...s.shot, id: `S${i + 1}`, chars: s.shot.chars, overlays: s.shot.overlays ?? [] } as LooseScene] : []));

/**
 * Cross-video avoid-list pass (docs/PLAN.md section 6): a camera that recent videos leaned on is swapped on every other
 * scene that uses it, for one the lists do not name and the 30-second rule allows. A strong preference, not a ban:
 * "slow_push" builds tension and some scenes keep it. Head-fake reveal cameras only trade for another reveal camera.
 * Backgrounds, action pairs, grades and music are Claude's to choose (the lists are in its input); code never moves a
 * scene to another place.
 */
export function avoidOverused(slots: Slot[], avoid: AvoidLists | null, headfakes: ReadonlySet<string>, startOf: (s: Slot) => number, recent: ReadonlySet<string> = new Set(), window = VARIETY_WINDOW_S): void {
  if (!avoid?.cameras.length) return;
  const seen = new Map<string, number>();
  slots.forEach((slot, i) => {
    const shot = slot.shot;
    if (!shot || !avoid.cameras.includes(shot.camera)) return;
    const n = (seen.get(shot.camera) ?? 0) + 1;
    seen.set(shot.camera, n);
    if (n % 2 === 0) return; // every other one stays
    const was = shot.camera;
    const isReveal = headfakes.has(slot.lineIds[0]!) && !revealTransitions().includes(shot.transitionIn);
    const pool = isReveal ? revealCameras() : idsOf("cameras").filter((c) => revealCameras().includes(c) === revealCameras().includes(was) || c === STILL_CAMERA);
    const pick = pool.find((c) => c !== was && !avoid.cameras.includes(c) && !recent.has(`${pictureOf(shot)}|${c}`) && cameraFree(slots, i, c, startOf, window) && freeAhead(slots, i, c, startOf, window));
    if (pick) {
      shot.camera = pick as never;
      slot.flags.push({ kind: "variety", message: `avoid-list: camera "${was}" is overused in ${avoid.against.join(", ")} → "${pick}"`, fixed: true });
    }
  });
}

/** A plain shot for lines Claude could not storyboard twice: the neighbour's place, the main character idle. */
function fallbackShot(slots: readonly Slot[], i: number, protagonist: string, look?: { bg?: string; grade?: string }): Shot {
  const near = slots.slice(0, i).reverse().find((s) => s.shot)?.shot ?? slots.slice(i + 1).find((s) => s.shot)?.shot;
  const bg = near?.bg ?? (look?.bg && idsOf("backgrounds").includes(look.bg as never) ? look.bg : idsOf("backgrounds")[0]!);
  const grade = near?.grade ?? (look?.grade && idsOf("grades").includes(look.grade as never) ? look.grade : idsOf("grades")[0]!);
  return {
    lineIds: slots[i]!.lineIds,
    bg: bg as never,
    grade: grade as never,
    chars: [{ id: protagonist, action: (idsOf("actions").includes("idle" as never) ? "idle" : idsOf("actions")[0]) as never, expr: (idsOf("expressions").includes("neutral" as never) ? "neutral" : idsOf("expressions")[0]) as never, pos: "center" as never }],
    props: [],
    camera: STILL_CAMERA as never,
    transitionIn: PLAIN_TRANSITION as never,
    sfx: [],
    caption: (idsOf("captions").includes("word_pop" as never) ? "word_pop" : idsOf("captions")[0]) as never,
  };
}

const STOP = new Set(["the", "a", "an", "and", "but", "his", "her", "its", "their", "with", "that", "this", "then", "there", "they", "into", "from", "over", "just", "only", "back", "straight", "every", "still"]);

/** Where a reveal lands when Claude didn't say: the first content word of the line. */
export function defaultReveal(line: SLine): Reveal {
  const ws = words(line.text).map((w) => w.toLowerCase().replace(/[^a-z']/g, ""));
  const k = ws.findIndex((w) => w.length >= 3 && !STOP.has(w));
  return { lineId: line.id, at: `${line.id}:${Math.max(0, k)}`, kind: line.energy >= 5 ? "hit" : "silence" };
}

// ---------------------------------------------------------------- the step

export type StoryboardResult = { scenes: z.output<typeof SceneFile>; report: StoryboardFile };

async function pool<T, R>(items: readonly T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }));
  return out;
}

type Draft<T> = { inputHash: string; output: T };

/** One call, reusing a saved draft for the same input unless `force`. */
async function draft<S extends "cast" | "storyboard">(project: string, step: S, name: string, input: unknown, o: RunOpts): Promise<S extends "cast" ? CastOutput : StoryboardOutput> {
  const file = join(storyboardPaths(project).drafts, `${name}.json`);
  const inputHash = hash({ step, input });
  if (!o.force && existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Draft<unknown>;
      if (saved.inputHash === inputHash) {
        o.progress?.({ step, phase: "skipped" });
        return saved.output as never;
      }
    } catch {
      // a broken draft is simply redone
    }
  }
  o.progress?.({ step, phase: "start", estimateMs: typicalDurationMs(step) });
  const output = await callStep({ project, step, input, signal: o.signal, onAttempt: (attempt) => o.progress?.({ step, phase: "attempt", attempt }) });
  writeJson(file, { inputHash, output });
  o.progress?.({ step, phase: "done" });
  return output as never;
}

export const compactShot = (s: Shot | undefined) =>
  s ? { lineIds: s.lineIds, bg: s.bg, grade: s.grade, chars: s.chars.map((c) => `${c.id}:${c.action}/${c.expr}@${c.pos}`), camera: s.camera, transitionIn: s.transitionIn } : null;

export async function storyboard(id: string, o: RunOpts = {}): Promise<StoryboardResult> {
  const story = loadStory(id);
  const paths = storyboardPaths(id);
  const allLines = story.loops.flatMap((l) => l.lines);
  const headfakes = new Set(allLines.filter((l) => l.beats.includes("headfake")).map((l) => l.id));
  const sfx = sfxVocabulary();
  const library = libraryForClaude();

  // the last videos' habits: the avoid-lists Claude is asked to steer clear of, and this project's previous storyboard to compare with
  const featurePool = allFeatures();
  const history = historyOf(id, { pool: featurePool });
  const avoid = avoidFrom(history);
  const avoidIn = avoidInput(avoid);
  const before = featurePool.find((f) => f.id === id);
  const previous: VarietyReport | null = before ? scoreFeatures(id, before, history, { avoid: null }) : null;

  // 1. cast, locations, moods, plant shots
  const castInput = {
    video: story.video,
    loops: story.loops.map((l) => ({ id: l.id, title: l.title, question: l.question, stakes: l.stakes ?? null, headFake: l.headFake ?? null, lines: l.lines.map((x) => ({ id: x.id, text: x.text, beats: x.beats, plants: x.plants, payoffs: x.payoffs })) })),
    plants: story.plants,
    library: libraryForClaude((Object.keys(CATALOGUE) as CatalogueSection[]).filter((k) => !["actions", "expressions", "cameras", "transitions", "captions", "positions", "attachPoints"].includes(k))),
    castLook: castLookSchema(),
    moods: MUSIC_MOODS,
    ...(avoidIn ? { avoid: avoidIn } : {}),
  };
  const plan = await draft(id, "cast", "cast", castInput, o);

  // the cast, checked against the library
  const castFlags: Flag[] = [];
  const cast: Record<string, CastMember> = {};
  for (const c of plan.cast) {
    const { member, flags } = normaliseLook(c.id, c.name, c.look);
    cast[c.id] = member;
    castFlags.push(...flags.map((message) => ({ kind: /dropped|default/.test(message) && !/→/.test(message) ? ("repaired" as const) : ("mapped" as const), message, fixed: true })));
  }
  const protagonist = plan.cast[0]!.id;
  const lineWords = new Map(allLines.map((l) => [l.id, story.times.get(l.id)!.words]));
  const ctx: Ctx = { cast: new Set(Object.keys(cast)), sfx, lineWords, protagonist };

  const looks = new Map(plan.loops.map((l) => [l.loopId, l]));
  const moods = Object.keys(MUSIC_MOODS);
  let lastMood = "mystery";
  const music = story.loops.map((l) => {
    const raw = looks.get(l.id)?.music;
    const mood = raw ? (moods.includes(raw) ? raw : (closest(raw, moods) ?? lastMood)) : lastMood;
    lastMood = mood;
    return { loopId: l.id, mood };
  });

  const timeOf = (lineId: string) => story.times.get(lineId)!;
  const lineView = (l: SLine) => ({ id: l.id, text: l.text, energy: l.energy, delivery: l.delivery, beats: l.beats, plants: l.plants, payoffs: l.payoffs, seconds: Math.round((timeOf(l.id).end - timeOf(l.id).start) * 10) / 10, words: timeOf(l.id).words });
  const loopView = (l: SLoop) => ({ id: l.id, title: l.title, question: l.question, headFake: l.headFake ?? null, lines: l.lines.map(lineView) });
  const planFor = (loops: readonly SLoop[]) => ({
    style: plan.style,
    cast: plan.cast,
    plants: plan.plants,
    loops: plan.loops.filter((x) => loops.some((l) => l.id === x.loopId) || loops.some((l) => Number(l.id.slice(1)) - 1 === Number(x.loopId.slice(1)))),
  });
  const storyText = allLines.map((l) => `${l.id}: ${l.text}`);

  // 2. scenes, batch by batch
  const batches = batchLoops(story.loops);
  const outputs = await pool(batches, CONCURRENCY, (loops, i) =>
    draft(id, "storyboard", `batch-${i + 1}`, { video: story.video, plan: planFor(loops), story: storyText, batch: { loops: loops.map(loopView) }, library, sfx, ...(avoidIn ? { avoid: avoidIn } : {}) }, o),
  );

  // 3. assemble and check
  let slots: Slot[] = [];
  const reveals = new Map<string, Reveal>();
  outputs.forEach((out, i) => {
    slots.push(...cover(out.scenes, batches[i]!.flatMap((l) => l.lines.map((x) => x.id)), ctx));
    for (const r of out.reveals) if (headfakes.has(r.lineId) && r.at.startsWith(`${r.lineId}:`) && Number(r.at.split(":")[1]) < (lineWords.get(r.lineId) ?? 0)) reveals.set(r.lineId, r);
  });
  const startOf = (s: Slot) => timeOf(s.lineIds[0]!).start;
  ensurePayoffs(slots, headfakes);

  // 4. one repair call for broken scenes and repeated pictures
  const repeats = pictureRepeats(slots, startOf);
  const todo = slots.flatMap((s, i) => {
    const problems = [...s.problems];
    const j = repeats.get(i);
    if (j !== undefined) {
      const ago = Math.round(startOf(s) - startOf(slots[j]!));
      problems.push(`same background and actions (${pictureOf(s.shot!)}) as the shot on ${slots[j]!.lineIds[0]} ${ago} s earlier: change the place, the actions or who is in frame`);
    }
    return problems.length ? [{ i, problems }] : [];
  });
  let regenerated = 0;
  if (todo.length) {
    const lines = new Set(todo.flatMap((t) => slots[t.i]!.lineIds));
    const loops = story.loops.filter((l) => l.lines.some((x) => lines.has(x.id)));
    const input = {
      video: story.video,
      plan: planFor(loops),
      story: storyText,
      batch: { loops: loops.map(loopView) },
      regenerate: todo.map((t) => ({ lineIds: slots[t.i]!.lineIds, problem: t.problems.join("; ") })),
      around: todo.map((t) => ({ lineIds: slots[t.i]!.lineIds, before: compactShot(slots[t.i - 1]?.shot), after: compactShot(slots[t.i + 1]?.shot) })),
      library,
      sfx,
      ...(avoidIn ? { avoid: avoidIn } : {}),
    };
    const out = await draft(id, "storyboard", "repair", input, o);
    const replaced = new Map<number, Slot[]>();
    for (const t of todo) {
      const group = slots[t.i]!.lineIds;
      const mine = out.scenes.filter((d) => d.lineIds.some((x) => group.includes(x)));
      const fresh = cover(mine, group, ctx);
      const ok = fresh.every((s) => s.shot && !s.problems.length);
      if (ok) {
        fresh.forEach((s) => s.flags.unshift({ kind: "regenerated", message: t.problems.join("; "), fixed: true }));
        replaced.set(t.i, fresh);
        regenerated++;
      }
    }
    for (const r of out.reveals) if (headfakes.has(r.lineId) && r.at.startsWith(`${r.lineId}:`) && Number(r.at.split(":")[1]) < (lineWords.get(r.lineId) ?? 0)) reveals.set(r.lineId, r);
    slots = slots.flatMap((s, i) => replaced.get(i) ?? [s]);
  }
  slots.forEach((s, i) => {
    if (s.shot && !s.problems.length) return;
    const look = looks.get(s.lineIds[0]!.split(".")[0]!);
    s.shot = fallbackShot(slots, i, protagonist, { bg: look?.locations[0], grade: look?.grade });
    s.flags.push({ kind: "fallback", message: `Claude could not storyboard this twice (${s.problems.join("; ") || "repeat"}); plain fallback shot`, fixed: false });
    s.problems = [];
  });

  // the draft as Claude (and the repair call) left it, before the code passes below: what the avoid-lists achieved on their own
  const stamp = now();
  const extras = (r: Iterable<string>) => ({ at: stamp, format: story.video.format as "youtube" | "reel", moods: music.map((m) => m.mood), reveals: [...r] });
  const firstPass = scoreFeatures(id, featuresFromScenes(id, looseOf(slots), extras(headfakes)), history, { avoid });

  // 5. deterministic passes
  ensurePayoffs(slots, headfakes);
  fixCameras(slots, headfakes, startOf);
  const recent = recentCombos(id);
  avoidRecent(slots, recent.combos, headfakes, startOf);
  avoidOverused(slots, avoid, headfakes, startOf, recent.combos);
  for (const [i, j] of pictureRepeats(slots, startOf)) {
    slots[i]!.flags.push({ kind: "variety", message: `same background and actions as the shot on ${slots[j]!.lineIds[0]} within ${VARIETY_WINDOW_S} s`, fixed: false });
  }
  for (const l of allLines) if (headfakes.has(l.id) && !reveals.has(l.id)) reveals.set(l.id, defaultReveal(l));

  // 6. ids, strict validation, files
  const raw = { version: 1, title: story.video.title, cast, scenes: slots.map((s, i) => ({ id: `S${i + 1}`, ...s.shot! })) };
  const parsed = SceneFile.safeParse(raw);
  if (!parsed.success) throw new ValidationError(`storyboard for ${id}`, formatIssues("scenes.json", raw, parsed.error.issues));

  const flags: StoryboardFlag[] = [...castFlags.map((f) => ({ ...f, sceneId: "cast" })), ...slots.flatMap((s, i) => s.flags.map((f) => ({ ...f, sceneId: `S${i + 1}` })))];
  const variety = flags.filter((f) => f.kind === "variety");
  const report: StoryboardFile = {
    version: 1,
    createdAt: now(),
    catalogue: catalogueHash(),
    source: story.source,
    style: plan.style,
    music,
    reveals: [...reveals.values()].sort((a, b) => allLines.findIndex((l) => l.id === a.lineId) - allLines.findIndex((l) => l.id === b.lineId)),
    batches: batches.map((loops) => {
      const ids = new Set(loops.flatMap((l) => l.lines.map((x) => x.id)));
      return { loopIds: loops.map((l) => l.id), lines: ids.size, scenes: slots.filter((s) => ids.has(s.lineIds[0]!)).length };
    }),
    flags,
    combos: [...new Set(slots.map((s) => comboOf(s.shot!)))],
    stats: {
      scenes: slots.length,
      lines: allLines.length,
      seconds: Math.round(story.seconds * 10) / 10,
      timedBy: story.timedBy,
      regenerated,
      varietyHits: variety.length,
      varietyFixed: variety.filter((f) => f.fixed).length,
      mappedIds: flags.filter((f) => f.kind === "mapped").length,
    },
  };
  writeJson(paths.scenes, parsed.data);
  writeJson(paths.report, StoryboardFile.parse(report));
  const finalFeatures = featuresFromScenes(id, looseOf(slots), { ...extras(report.reveals.map((r) => r.lineId)), at: report.createdAt });
  writeJson(
    varietyPath(id),
    VarietyFile.parse({
      version: 1,
      createdAt: report.createdAt,
      against: history.map((h) => h.id),
      avoid,
      firstPass,
      final: scoreFeatures(id, finalFeatures, history, { avoid }),
      previous,
      swaps: flags.filter((f) => f.kind === "variety" && f.fixed).map((f) => ({ sceneId: f.sceneId, what: f.message })),
    }),
  );
  return { scenes: parsed.data, report };
}

/** projects/<id>/storyboard/variety.json: what the variety guard asked for and what changed (VarietyFile). */
export const varietyPath = (id: string) => join(storyboardPaths(id).dir, "variety.json");
export const readVarietyFile = (id: string) => readJson(varietyPath(id), VarietyFile);
export const readStoryboard = (id: string) => readJson(storyboardPaths(id).report, StoryboardFile);
export const readScenes = (id: string) => readJson(storyboardPaths(id).scenes, SceneFile);
