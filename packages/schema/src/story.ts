import { z } from "zod";
import type { ScriptFile } from "./script";

/**
 * The story engine's formats (docs/PLAN.md sections 3 and 4).
 *
 * Two kinds of schema live here:
 *
 * - Step outputs (`*Output`): what one `claude -p` step returns. These are
 *   exported to engine/schemas/<step>.json by `pnpm schemas` and passed to
 *   `claude --json-schema`, then checked again here when the result comes back.
 *   Every field is required (empty arrays/strings where there is nothing to
 *   say): structured output is more reliable without optional fields.
 * - Files on disk (`*File`): what projects/<id>/ holds. The narration file is
 *   the step output plus what the editor adds (locks, fact sources).
 *
 * Structural rules (unique ids, line ids that match their loop, a fact marked
 * wrong has a source) are zod refinements, so a bad file fails with a message
 * that names the id. Story-craft rules (open questions, stakes, plants before
 * head fakes, word budgets) are the loop checker's job (@studio/story).
 */

// ---------------------------------------------------------------- basics

/**
 * The narrator's speaking rate, in words per minute, pauses included. The
 * built-in Chatterbox voice measured 165–174 wpm on the Phase 2 scripts, so
 * new briefs are budgeted at 170. Every brief stores its own rate.
 */
export const DEFAULT_WPM = 170;
/** Briefs written before the rate was stored were budgeted at 150 wpm, and keep it. */
export const LEGACY_WPM = 150;

export const ProjectId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "project ids are lower-case letters, digits, - and _ (max 64)");
export const LoopId = z.string().regex(/^L\d+$/, 'loop ids look like "L3"');
export const StoryLineId = z.string().regex(/^L\d+\.\d+$/, 'line ids look like "L3.4" (loop L3, line 4)');
export const PlantId = z.string().regex(/^P\d+$/, 'plant ids look like "P2"');

/** The loop a line id belongs to: "L3.4" → "L3". */
export function loopOf(lineId: string): string {
  return lineId.slice(0, lineId.indexOf("."));
}

export const StakesType = z.enum(["character", "at_risk", "urgent"]);
export const Stakes = z.strictObject({
  type: StakesType.describe("character = someone to root for; at_risk = something could be lost; urgent = a deadline"),
  text: z.string().min(1).describe("The stakes in one concrete sentence, as the viewer would hear them"),
});

export const Energy = z.int().min(1).max(5);
export const Format = z.enum(["youtube", "reel"]);

/**
 * How a story is told. `factual` decides the review: true stories are
 * fact-checked against the web, fiction is checked for internal consistency.
 */
export const NARRATIVES = {
  true_story: { label: "True story", factual: true, hint: "Something that really happened, told as a story. Every claim is fact-checked." },
  history: { label: "History", factual: true, hint: "A moment from the past, with real people, places and dates." },
  mystery: { label: "Mystery", factual: false, hint: "A puzzle opened early, clues laid fairly, answered late." },
  thriller: { label: "Thriller", factual: false, hint: "A clock is ticking. Every loop makes it worse." },
  horror: { label: "Horror", factual: false, hint: "Dread that builds; the worst thing is the thing you haven't seen yet." },
  comedy: { label: "Comedy", factual: false, hint: "Escalating trouble, each fix making it funnier and worse." },
  fable: { label: "Fable", factual: false, hint: "A simple world, a clear lesson, an ending that turns it." },
  scifi: { label: "Sci-fi", factual: false, hint: "One strange rule of the world, followed to its end." },
  adventure: { label: "Adventure", factual: false, hint: "A journey with a goal, obstacles and a reversal." },
} as const satisfies Record<string, { label: string; factual: boolean; hint: string }>;

export type NarrativeId = keyof typeof NARRATIVES;
export const NarrativeId = z.enum(Object.keys(NARRATIVES) as [NarrativeId, ...NarrativeId[]], {
  error: (issue) => `unknown narrative "${String(issue.input)}". Known: ${Object.keys(NARRATIVES).join(", ")}`,
});

/** Length limits per format: a Reel is 30 s – 3 min, a YouTube story 2–20 min. */
export const FORMAT_MINUTES = { reel: { min: 0.5, max: 3 }, youtube: { min: 2, max: 20 } } as const;

export function wordBudget(minutes: number, wpm: number = DEFAULT_WPM): number {
  return Math.round(minutes * wpm);
}

/** Seconds of narration for a piece of text, estimated from its words. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
export function secondsFor(words: number, wpm: number = DEFAULT_WPM): number {
  return (words / wpm) * 60;
}

// ---------------------------------------------------------------- brief (step 1, you)

export const Brief = z
  .strictObject({
    version: z.literal(1),
    id: ProjectId,
    sentence: z.string().trim().min(8, "the premise needs at least a few words").max(800),
    narrative: NarrativeId,
    /** True stories get a fact-check; fiction gets a consistency check. Defaults from the narrative. */
    factual: z.boolean(),
    format: Format,
    minutes: z.number().positive(),
    /** Speaking rate the budget is computed at (words per minute, pauses included). */
    wpm: z.number().min(100).max(240).default(LEGACY_WPM),
    /** Extra direction for the writer (tone, audience, must-include). Optional. */
    notes: z.string().max(2000).default(""),
    createdAt: z.iso.datetime(),
  })
  .superRefine((b, ctx) => {
    const { min, max } = FORMAT_MINUTES[b.format];
    if (b.minutes < min || b.minutes > max) {
      ctx.addIssue({ code: "custom", path: ["minutes"], message: `a ${b.format} story is ${min}–${max} minutes; got ${b.minutes}` });
    }
  });
export type Brief = z.infer<typeof Brief>;

/** The brief's word budget: its length at its speaking rate. */
export function budgetOf(b: Pick<Brief, "minutes" | "wpm">): number {
  return wordBudget(b.minutes, b.wpm);
}

// ---------------------------------------------------------------- master loop options (step 2a, Claude)

export const MasterOption = z.strictObject({
  id: z.enum(["A", "B", "C"]),
  title: z.string().min(1).describe("Working title. It makes the promise the big question pays off"),
  logline: z.string().min(1).describe("One or two sentences: who, what they want, what stands in the way"),
  stakes: Stakes,
  question: z.string().min(1).describe("The big question the whole video answers. Specific, never yes/no"),
  endingTwist: z.strictObject({
    expected: z.string().min(1).describe("What the viewer will predict the answer is"),
    actual: z.string().min(1).describe("What the answer really is"),
  }),
  hook: z.string().min(1).describe("The first line of narration, word for word"),
  whyItWorks: z.string().min(1).describe("One sentence: why a viewer keeps watching"),
});
export type MasterOption = z.infer<typeof MasterOption>;

export const MasterOptionsOutput = z
  .strictObject({ options: z.array(MasterOption).length(3) })
  .superRefine((o, ctx) => {
    const ids = o.options.map((x) => x.id).sort().join("");
    if (ids !== "ABC") ctx.addIssue({ code: "custom", path: ["options"], message: `options need the ids A, B and C once each; got ${o.options.map((x) => x.id).join(", ")}` });
  });
export type MasterOptionsOutput = z.infer<typeof MasterOptionsOutput>;

export const PickFile = z.strictObject({
  version: z.literal(1),
  optionId: z.enum(["A", "B", "C"]),
  option: MasterOption,
  pickedAt: z.iso.datetime(),
});
export type PickFile = z.infer<typeof PickFile>;

// ---------------------------------------------------------------- loop map (step 2b, Claude)

export const HeadFake = z.strictObject({
  expected: z.string().min(1).describe("Expectation A: what the viewer is led to predict"),
  actual: z.string().min(1).describe("What is delivered instead (B)"),
  plantIds: z.array(PlantId).min(1).describe("The earlier plants that make the twist fair"),
});

export const LoopPlan = z.strictObject({
  id: LoopId,
  level: z.enum(["chapter", "micro"]).describe("chapter for YouTube (45–90 s each), micro for a Reel (10–25 s each)"),
  title: z.string().min(1).max(60).describe("A 2–5 word label for the tension graph"),
  stakes: Stakes,
  question: z.string().min(1).describe("This loop's specific question. Never yes/no"),
  headFake: HeadFake,
  rehook: z.string().min(1).describe("The line that closes this question and opens the next, bigger one. The last loop's rehook is the final line"),
  wordBudget: z.int().positive().describe("Words of narration this loop gets"),
});
export type LoopPlan = z.infer<typeof LoopPlan>;

export const Plant = z.strictObject({
  id: PlantId,
  loopId: LoopId.describe("The loop where the plant is shown"),
  detail: z.string().min(1).describe("The concrete detail the viewer sees or hears, innocently, before it matters"),
  paysOffIn: LoopId.describe("The loop whose head fake it makes fair"),
});
export type Plant = z.infer<typeof Plant>;

function uniqueIds(items: readonly { id: string }[], what: string, path: PropertyKey[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  items.forEach((x, i) => {
    if (seen.has(x.id)) ctx.addIssue({ code: "custom", path: [...path, i, "id"], message: `${what} id "${x.id}" is used twice` });
    seen.add(x.id);
  });
}

export const LoopMapOutput = z
  .strictObject({
    master: z.strictObject({
      stakes: Stakes,
      question: z.string().min(1),
      headFake: HeadFake.describe("The ending twist"),
    }),
    loops: z.array(LoopPlan).min(2).max(16),
    plants: z.array(Plant).min(1),
  })
  .superRefine((m, ctx) => {
    uniqueIds(m.loops, "loop", ["loops"], ctx);
    uniqueIds(m.plants, "plant", ["plants"], ctx);
    m.loops.forEach((l, i) => {
      if (l.id !== `L${i + 1}`) ctx.addIssue({ code: "custom", path: ["loops", i, "id"], message: `loops are numbered in order from L1; loop #${i + 1} is "${l.id}"` });
    });
    const loops = new Set(m.loops.map((l) => l.id));
    m.plants.forEach((p, i) => {
      for (const key of ["loopId", "paysOffIn"] as const) {
        if (!loops.has(p[key])) ctx.addIssue({ code: "custom", path: ["plants", i, key], message: `plant ${p.id}: there is no loop "${p[key]}"` });
      }
    });
  });
export type LoopMapOutput = z.infer<typeof LoopMapOutput>;

// ---------------------------------------------------------------- narration (step 2c, Claude)

/**
 * What a line does in its loop. A line may do several things (restate the
 * stakes and ask the question) or none (plain story).
 * - question: opens or sharpens the loop's question
 * - turn: a micro loop ("but then…", "except one thing was wrong")
 * - headfake: delivers B instead of A; answers the open question
 * - rehook: closes the question and opens the next one in the same breath
 */
export const Beat = z.enum(["stakes", "question", "plant", "turn", "headfake", "rehook"]);
export type Beat = z.infer<typeof Beat>;

const lineFields = {
  id: StoryLineId,
  text: z.string().trim().min(1).describe("Exactly what the narrator says. One breath, usually 4–18 words"),
  energy: Energy.describe("1 calm/hushed … 3 normal storytelling … 5 peak reveal (use 5 rarely)"),
  delivery: z.string().describe('A short performance note, e.g. "hushed, slow" or "deadpan"'),
  beats: z.array(Beat).describe("What this line does in its loop; [] for plain story"),
  plants: z.array(PlantId).describe("Plant ids this line shows; [] if none"),
  payoffs: z.array(PlantId).describe("Plant ids this line pays off; [] if none"),
};

export const NarrationLineOutput = z.strictObject(lineFields);
export type NarrationLineOutput = z.infer<typeof NarrationLineOutput>;

function checkLoopLines(loops: readonly { id: string; lines: readonly { id: string }[] }[], ctx: z.RefinementCtx) {
  uniqueIds(loops, "loop", ["loops"], ctx);
  const seen = new Set<string>();
  loops.forEach((loop, i) => {
    loop.lines.forEach((line, j) => {
      if (loopOf(line.id) !== loop.id) ctx.addIssue({ code: "custom", path: ["loops", i, "lines", j, "id"], message: `line "${line.id}" sits in loop ${loop.id}; its id must start with "${loop.id}."` });
      if (seen.has(line.id)) ctx.addIssue({ code: "custom", path: ["loops", i, "lines", j, "id"], message: `line id "${line.id}" is used twice` });
      seen.add(line.id);
    });
  });
}

export const NarrationOutput = z
  .strictObject({
    loops: z.array(z.strictObject({ id: LoopId, lines: z.array(NarrationLineOutput).min(1) })).min(1),
  })
  .superRefine((n, ctx) => checkLoopLines(n.loops, ctx));
export type NarrationOutput = z.infer<typeof NarrationOutput>;

/** A rewrite of some lines ("rewrite with direction", or the fix loop after a failed review). Ids are kept. */
export const RewriteOutput = z
  .strictObject({
    lines: z.array(NarrationLineOutput).min(1),
    note: z.string().describe("One sentence on what changed and why"),
  })
  .superRefine((r, ctx) => uniqueIds(r.lines, "line", ["lines"], ctx));
export type RewriteOutput = z.infer<typeof RewriteOutput>;

// ---------------------------------------------------------------- narration file (what the editor edits)

export const Source = z.strictObject({ url: z.url(), title: z.string() });
export type Source = z.infer<typeof Source>;

export const ScriptLine = z.strictObject({
  ...lineFields,
  /** A locked line is never rewritten by Claude. */
  locked: z.boolean().default(false),
  /** Where a fact in this line comes from (kept when a fact fix is accepted). */
  sources: z.array(Source).default([]),
});
export type ScriptLine = z.infer<typeof ScriptLine>;

export const NarrationFile = z
  .strictObject({
    version: z.literal(1),
    loops: z.array(z.strictObject({ id: LoopId, lines: z.array(ScriptLine).min(1) })).min(1),
    /** Set by "lock script"; script.json is written at the same moment. */
    lockedAt: z.iso.datetime().nullable().default(null),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((n, ctx) => checkLoopLines(n.loops, ctx));
export type NarrationFile = z.infer<typeof NarrationFile>;

export function allLines(n: { loops: readonly { lines: readonly ScriptLine[] }[] }): ScriptLine[] {
  return n.loops.flatMap((l) => l.lines);
}

/** The locked narration as the voice step's script.json (packages/schema/src/script.ts). */
export function narrationToScript(n: NarrationFile): ScriptFile {
  return { version: 1, lines: allLines(n).map(({ id, text, energy, delivery }) => ({ id, text, energy, delivery })) };
}

// ---------------------------------------------------------------- review (step 3, Claude ×2)

/** A proposed replacement for one line, keeping its id. */
export const ProposalLine = z.strictObject({
  id: StoryLineId,
  text: z.string().trim().min(1),
});
export type ProposalLine = z.infer<typeof ProposalLine>;

export const FactClaim = z.strictObject({
  id: z.string().regex(/^C\d+$/, 'claim ids look like "C3"'),
  lineIds: z.array(StoryLineId).min(1),
  claim: z.string().min(1).describe("The factual claim, restated plainly"),
  verdict: z.enum(["confirmed", "wrong", "unverifiable"]),
  correction: z.string().describe('What is actually true, for "wrong"; "" otherwise'),
  proposal: z.array(ProposalLine).describe('For "wrong": the affected lines rewritten to be true (same ids). [] otherwise'),
  sources: z.array(Source).describe("Pages that confirm or correct the claim"),
  note: z.string().describe("Anything the editor should know (disputed figures, rounding); may be empty"),
});

export const ConsistencyIssue = z.strictObject({
  id: z.string().regex(/^K\d+$/, 'issue ids look like "K2"'),
  lineIds: z.array(StoryLineId).min(1),
  kind: z.enum(["name", "timeline", "world_rule", "logic", "fairness", "other"]),
  severity: z
    .enum(["major", "minor"])
    .default("major")
    .describe("major = a viewer would notice and trip on it (blocks the lock); minor = style, repetition, a nitpick"),
  issue: z.string().min(1).describe("What contradicts what, naming both lines"),
  proposal: z.array(ProposalLine).min(1).describe("The smallest rewrite that fixes it (same ids)"),
});

export const FactCheckOutput = z
  .strictObject({
    mode: z.enum(["facts", "consistency"]),
    claims: z.array(FactClaim),
    issues: z.array(ConsistencyIssue),
    summary: z.string().min(1),
  })
  .superRefine((f, ctx) => {
    f.claims.forEach((c, i) => {
      const at = (key: string) => ["claims", i, key];
      if (c.verdict === "wrong") {
        if (!c.correction.trim()) ctx.addIssue({ code: "custom", path: at("correction"), message: `claim ${c.id} is marked wrong but has no correction` });
        if (!c.sources.length) ctx.addIssue({ code: "custom", path: at("sources"), message: `claim ${c.id} is marked wrong but has no source URL` });
        if (!c.proposal.length) ctx.addIssue({ code: "custom", path: at("proposal"), message: `claim ${c.id} is marked wrong but proposes no rewrite` });
      }
      if (c.verdict === "confirmed" && !c.sources.length) ctx.addIssue({ code: "custom", path: at("sources"), message: `claim ${c.id} is marked confirmed but has no source URL` });
    });
    uniqueIds(f.claims, "claim", ["claims"], ctx);
    uniqueIds(f.issues, "issue", ["issues"], ctx);
  });
export type FactCheckOutput = z.infer<typeof FactCheckOutput>;

const Score = z.int().min(1).max(5);
export const LoopScore = z.strictObject({
  loopId: LoopId,
  stakes: Score,
  question: Score,
  surprise: Score,
  rehook: Score,
  note: z.string().describe("One sentence: the main reason for the lowest score"),
});
export type LoopScore = z.infer<typeof LoopScore>;

export const CriticOutput = z.strictObject({
  loops: z.array(LoopScore).min(1),
  weakest: z
    .array(
      z.strictObject({
        lineIds: z.array(StoryLineId).min(1),
        problem: z.string().min(1).describe("What a viewer feels here (bored, confused, ahead of the story)"),
        proposal: z.array(ProposalLine).min(1).describe("The rewrite (same ids)"),
        why: z.string().min(1).describe("Why the rewrite holds attention better"),
      }),
    )
    .length(3),
  verdict: z.string().min(1).describe("Two or three sentences on the whole script's retention"),
});
export type CriticOutput = z.infer<typeof CriticOutput>;

/**
 * Reviewer findings and rewrites, as comments pinned to lines in the editor.
 * Accepting a comment applies its proposal (locked lines excepted); fact fixes
 * carry their sources onto the line.
 */
export const CommentSource = z.enum(["factcheck", "consistency", "critic", "rewrite"]);
export const Comment = z.strictObject({
  id: z.string().min(1),
  source: CommentSource,
  /** Review round (1, 2, …) or the rewrite request that made it. */
  round: z.int().nonnegative(),
  lineIds: z.array(StoryLineId).min(1),
  title: z.string().min(1),
  message: z.string(),
  /** blocker: the review fails until it is resolved (a wrong fact, a contradiction). */
  severity: z.enum(["blocker", "suggestion", "info"]),
  proposal: z.array(
    z.strictObject({
      id: StoryLineId,
      text: z.string().min(1),
      energy: Energy.optional(),
      delivery: z.string().optional(),
      /** A rewrite may change what the line does ("make this the reveal" adds headfake). */
      beats: z.array(Beat).optional(),
      plants: z.array(PlantId).optional(),
      payoffs: z.array(PlantId).optional(),
      /** The line's text when the proposal was made, for the diff and for staleness. */
      before: z.string(),
    }),
  ),
  sources: z.array(Source).default([]),
  status: z.enum(["open", "accepted", "rejected", "superseded"]),
  /** For rewrites: the direction given, and the comments this rewrite answers (fix loop). */
  direction: z.string().default(""),
  answers: z.array(z.string()).default([]),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable().default(null),
});
export type Comment = z.infer<typeof Comment>;

export const CommentsFile = z.strictObject({ version: z.literal(1), comments: z.array(Comment) });
export type CommentsFile = z.infer<typeof CommentsFile>;

/** One review round, kept so scores before and after fixes can be compared. */
export const ReviewRound = z.strictObject({
  round: z.int().positive(),
  at: z.iso.datetime(),
  factual: z.boolean(),
  facts: z.strictObject({ confirmed: z.int(), wrong: z.int(), unverifiable: z.int(), issues: z.int() }),
  scores: z.array(LoopScore),
  /** Mean of all loop scores, 1–5. */
  mean: z.number(),
  blockers: z.int(),
  passed: z.boolean(),
});
export type ReviewRound = z.infer<typeof ReviewRound>;
export const ReviewHistoryFile = z.strictObject({ version: z.literal(1), rounds: z.array(ReviewRound) });
export type ReviewHistoryFile = z.infer<typeof ReviewHistoryFile>;

// ---------------------------------------------------------------- run bookkeeping

export const StepName = z.enum(["options", "loopmap", "narration", "rewrite", "factcheck", "critic"]);
export type StepName = z.infer<typeof StepName>;

/** projects/<id>/usage.jsonl: one line per `claude -p` call. */
export const UsageRecord = z.strictObject({
  at: z.iso.datetime(),
  project: ProjectId,
  step: StepName,
  model: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  attempt: z.int().positive(),
  durationMs: z.number().nonnegative(),
  apiMs: z.number().nonnegative(),
  turns: z.int().nonnegative(),
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  cacheReadTokens: z.int().nonnegative(),
  cacheWriteTokens: z.int().nonnegative(),
  webSearches: z.int().nonnegative(),
  /** What the CLI reports as the API-equivalent price. On a subscription nothing is billed per call. */
  costUsd: z.number().nonnegative().nullable(),
  sessionId: z.string().nullable(),
});
export type UsageRecord = z.infer<typeof UsageRecord>;

/** projects/<id>/steps.json: finished steps and the inputs they ran on, so a rerun skips them. */
export const StepsFile = z.strictObject({
  version: z.literal(1),
  done: z.record(z.string(), z.strictObject({ inputHash: z.string(), finishedAt: z.iso.datetime() })),
});
export type StepsFile = z.infer<typeof StepsFile>;
