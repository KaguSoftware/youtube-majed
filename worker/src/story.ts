/**
 * The story steps (docs/PLAN.md section 3): brief → three master loop options
 * → (you pick) → loop map → narration. Each step's output is validated and
 * saved under projects/<id>/; steps.json remembers the input each finished
 * step ran on, so a rerun skips it unless its input changed or `force` is set.
 */
import { projectsDir, readJson, storyPaths, writeJson } from "@studio/project";
import {
  Brief,
  CommentsFile,
  DEFAULT_WPM,
  budgetOf,
  LoopMapOutput,
  MasterOptionsOutput,
  NARRATIVES,
  NarrationFile,
  PickFile,
  StepsFile,
  type LoopMapOutput as LoopMap,
  type NarrativeId,
  type StepName,
} from "@studio/schema";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { checkLoopMap } from "@studio/story";
import { callStep, type StepOutput } from "./call";
import { typicalDurationMs } from "./usage";

export type Progress = (e: { step: StepName; phase: "start" | "attempt" | "done" | "skipped"; attempt?: number; estimateMs?: number }) => void;
export type RunOpts = { force?: boolean; signal?: AbortSignal; progress?: Progress };

export class StoryError extends Error {
  override name = "StoryError";
}

const now = () => new Date().toISOString();
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

// ---------------------------------------------------------------- reading

export function readBrief(id: string): Brief {
  const b = readJson(storyPaths(id).brief, Brief);
  if (!b) throw new StoryError(`there is no project "${id}" (no ${storyPaths(id).brief})`);
  return b;
}
export const readOptions = (id: string) => readJson(storyPaths(id).options, MasterOptionsOutput);
export const readPick = (id: string) => readJson(storyPaths(id).pick, PickFile);
export const readLoopMap = (id: string) => readJson(storyPaths(id).loopmap, LoopMapOutput);
export const readNarration = (id: string) => readJson(storyPaths(id).narration, NarrationFile);
export const readComments = (id: string) => readJson(storyPaths(id).comments, CommentsFile) ?? { version: 1 as const, comments: [] };
export const readSteps = (id: string) => readJson(storyPaths(id).steps, StepsFile) ?? { version: 1 as const, done: {} };

export function listProjects(): string[] {
  const dir = projectsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(storyPaths(d.name).brief))
    .map((d) => d.name)
    .sort();
}

/** What Claude sees of the brief: no bookkeeping, plus the word budget. */
export function briefForClaude(b: Brief) {
  return { sentence: b.sentence, narrative: b.narrative, narrativeHint: NARRATIVES[b.narrative].hint, factual: b.factual, format: b.format, minutes: b.minutes, wpm: b.wpm, wordBudget: budgetOf(b), notes: b.notes };
}

// ---------------------------------------------------------------- steps with skip-if-done

async function once<S extends StepName>(
  id: string,
  step: S,
  input: unknown,
  output: string,
  save: (out: StepOutput<S>) => void,
  o: RunOpts & { tools?: string[]; check?: (out: StepOutput<S>) => string[] },
): Promise<"ran" | "skipped"> {
  const inputHash = hash({ step, input });
  const steps = readSteps(id);
  if (!o.force && steps.done[step]?.inputHash === inputHash && existsSync(output)) {
    o.progress?.({ step, phase: "skipped" });
    return "skipped";
  }
  o.progress?.({ step, phase: "start", estimateMs: typicalDurationMs(step) });
  const out = await callStep({ project: id, step, input, tools: o.tools, check: o.check, signal: o.signal, onAttempt: (attempt) => o.progress?.({ step, phase: "attempt", attempt }) });
  save(out);
  const fresh = readSteps(id);
  fresh.done[step] = { inputHash, finishedAt: now() };
  writeJson(storyPaths(id).steps, fresh);
  o.progress?.({ step, phase: "done" });
  return "ran";
}

// ---------------------------------------------------------------- 1. brief

export type NewBrief = { sentence: string; narrative: NarrativeId; format: "youtube" | "reel"; minutes: number; wpm?: number; factual?: boolean; notes?: string; id?: string };

function slug(sentence: string): string {
  const words = sentence.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w && !["a", "an", "the", "of", "and", "to", "in", "on", "who", "that", "his", "her"].includes(w));
  return words.slice(0, 4).join("-").slice(0, 40) || "story";
}

export function createProject(input: NewBrief): Brief {
  let id = input.id ?? slug(input.sentence);
  if (!input.id) for (let n = 2; existsSync(storyPaths(id).dir); n++) id = `${slug(input.sentence)}-${n}`;
  else if (existsSync(storyPaths(id).brief)) throw new StoryError(`project "${id}" already exists`);
  const r = Brief.safeParse({
    version: 1,
    id,
    sentence: input.sentence,
    narrative: input.narrative,
    factual: input.factual ?? NARRATIVES[input.narrative]?.factual ?? false,
    format: input.format,
    minutes: input.minutes,
    wpm: input.wpm ?? DEFAULT_WPM,
    notes: input.notes ?? "",
    createdAt: now(),
  });
  if (!r.success) throw new StoryError(`the brief is not valid:\n  - ${r.error.issues.map((i) => `${i.path.join(".") || "brief"}: ${i.message}`).join("\n  - ")}`);
  writeJson(storyPaths(id).brief, r.data);
  return r.data;
}

// ---------------------------------------------------------------- 2a. master loop options

export async function generateOptions(id: string, o: RunOpts = {}) {
  const brief = readBrief(id);
  const p = storyPaths(id);
  await once(id, "options", { brief: briefForClaude(brief) }, p.options, (out) => writeJson(p.options, out), o);
  return readOptions(id)!;
}

// ---------------------------------------------------------------- pick

export function pickOption(id: string, choice: string, o: { force?: boolean } = {}): PickFile {
  const options = readOptions(id);
  if (!options) throw new StoryError(`project "${id}" has no options yet; run \`pnpm story new\` (or generate options) first`);
  const key = /^[1-3]$/.test(choice) ? "ABC"[Number(choice) - 1] : choice.toUpperCase();
  const option = options.options.find((x) => x.id === key);
  if (!option) throw new StoryError(`there is no option "${choice}"; pick A, B or C (or 1–3)`);
  const prev = readPick(id);
  const narration = readNarration(id);
  if (prev && prev.optionId !== option.id && narration && !o.force) {
    throw new StoryError(`option ${prev.optionId} is already written up as a narration; picking ${option.id} would replace it. Pass --force to do that.`);
  }
  if (narration?.lockedAt) throw new StoryError(`the script is locked; unlock it before changing the story`);
  const pick: PickFile = { version: 1, optionId: option.id, option, pickedAt: prev?.optionId === option.id ? prev.pickedAt : now() };
  writeJson(storyPaths(id).pick, pick);
  return pick;
}

// ---------------------------------------------------------------- 2b. loop map

/** Scales loop budgets so they add up to the brief's budget exactly (Claude is close, code is exact). */
export function fitBudgets(map: LoopMap, total: number): LoopMap {
  const sum = map.loops.reduce((s, l) => s + l.wordBudget, 0);
  if (sum === total) return map;
  const scaled = map.loops.map((l) => Math.max(10, Math.round((l.wordBudget * total) / sum)));
  const drift = total - scaled.reduce((s, n) => s + n, 0);
  scaled[scaled.length - 1] = Math.max(10, scaled[scaled.length - 1]! + drift);
  return { ...map, loops: map.loops.map((l, i) => ({ ...l, wordBudget: scaled[i]! })) };
}

export async function generateLoopMap(id: string, o: RunOpts = {}) {
  const brief = readBrief(id);
  const pick = readPick(id);
  if (!pick) throw new StoryError(`pick a master loop option first: \`pnpm story pick ${id} <A|B|C>\``);
  const p = storyPaths(id);
  await once(id, "loopmap", { brief: briefForClaude(brief), option: pick.option }, p.loopmap, (out) => writeJson(p.loopmap, fitBudgets(out, budgetOf(brief))), {
    ...o,
    // the loop checker's map rules (plants, the ending's plants) are cheap to fix here, before any narration is written
    check: (out) => checkLoopMap(out).filter((f) => f.level === "error").map((f) => f.message),
  });
  return readLoopMap(id)!;
}

// ---------------------------------------------------------------- 2c. narration

export async function generateNarration(id: string, o: RunOpts = {}) {
  const brief = readBrief(id);
  const pick = readPick(id);
  const loopmap = readLoopMap(id);
  if (!pick || !loopmap) throw new StoryError(`the loop map is missing; run \`pnpm story pick ${id} <option>\` first`);
  const p = storyPaths(id);
  const existing = readNarration(id);
  const input = { brief: briefForClaude(brief), option: pick.option, loopmap };
  const steps = readSteps(id);
  const changed = steps.done.narration?.inputHash !== hash({ step: "narration", input });
  if (existing && (changed || o.force)) {
    if (existing.lockedAt) throw new StoryError(`the script is locked; unlock it before writing a new narration`);
    const edited = existing.updatedAt !== steps.done.narration?.finishedAt;
    if (edited && !o.force) throw new StoryError(`the narration has been edited since it was written; writing a new one would lose those edits. Pass --force to do that.`);
  }
  await once(
    id,
    "narration",
    input,
    p.narration,
    (out) => {
      const at = now();
      writeJson(p.narration, NarrationFile.parse({ version: 1, loops: out.loops, lockedAt: null, updatedAt: at }));
      // A new narration makes old review comments meaningless.
      const comments = readComments(id);
      if (comments.comments.some((c) => c.status === "open")) {
        writeJson(p.comments, { ...comments, comments: comments.comments.map((c) => (c.status === "open" ? { ...c, status: "superseded" as const, decidedAt: at } : c)) });
      }
    },
    o,
  );
  // The narration's updatedAt is the moment it was written, so "edited since" can be told apart.
  const n = readNarration(id)!;
  const fresh = readSteps(id);
  if (fresh.done.narration && fresh.done.narration.finishedAt !== n.updatedAt) {
    fresh.done.narration.finishedAt = n.updatedAt;
    writeJson(p.steps, fresh);
  }
  return n;
}

/** Loop map and narration, after a pick: what `pnpm story pick` runs. */
export async function writeStory(id: string, o: RunOpts = {}) {
  await generateLoopMap(id, o);
  return generateNarration(id, o);
}
