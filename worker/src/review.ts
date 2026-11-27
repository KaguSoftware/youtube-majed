/**
 * Review and script editing (docs/PLAN.md section 4).
 *
 * - review: the fact-check and the retention critic run in parallel as two
 *   separate `claude -p` sessions. Their findings become comments pinned to
 *   line ids. A round is kept in review/history.json so scores before and
 *   after fixes can be compared.
 * - fix: a failed review sends only the flagged lines back to the rewrite
 *   step (plan section 2, fix loops). The rewrites arrive as suggestions.
 * - rewrite: "rewrite with direction" on chosen lines; ids are kept.
 * - decide: accept or reject a comment in one click. Accepting applies its
 *   proposal; a fact fix carries its sources onto the line.
 * - lock: writes script.json for `pnpm voice`. Locked lines are never
 *   rewritten.
 */
import { readJson, storyPaths, writeJson } from "@studio/project";
import {
  CriticOutput,
  FactCheckOutput,
  NarrationFile,
  ReviewHistoryFile,
  allLines,
  budgetOf,
  narrationToScript,
  type Comment,
  type CommentsFile,
  type ReviewRound,
  type ScriptLine,
} from "@studio/schema";
import { checkStory, type CheckReport } from "@studio/story";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { callStep } from "./call";
import { StoryError, briefForClaude, readBrief, readComments, readLoopMap, readNarration, readSteps, type RunOpts } from "./story";
import { typicalDurationMs } from "./usage";

const now = () => new Date().toISOString();
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

function need(id: string) {
  const brief = readBrief(id);
  const loopmap = readLoopMap(id);
  const narration = readNarration(id);
  if (!loopmap || !narration) throw new StoryError(`project "${id}" has no narration yet; pick an option first (\`pnpm story pick ${id} <A|B|C>\`)`);
  return { brief, loopmap, narration };
}

export const isLocked = (n: NarrationFile, line: ScriptLine) => Boolean(n.lockedAt) || line.locked;

/** What the reviewers and the rewrite step see of the narration. */
function narrationForClaude(n: NarrationFile) {
  return { loops: n.loops.map((l) => ({ id: l.id, lines: l.lines.map(({ sources: _s, locked, ...rest }) => ({ ...rest, locked: locked || Boolean(n.lockedAt) })) })) };
}

export function check(id: string): CheckReport {
  const { brief, loopmap, narration } = need(id);
  return checkStory(loopmap, narration, { budget: budgetOf(brief), wpm: brief.wpm });
}

export const readHistory = (id: string) => readJson(storyPaths(id).reviewHistory, ReviewHistoryFile) ?? { version: 1 as const, rounds: [] };

function writeComments(id: string, c: CommentsFile) {
  writeJson(storyPaths(id).comments, c);
}

// ---------------------------------------------------------------- review

/** Shared checks for reviewer output: line ids exist, proposals only touch flagged, unlocked lines. */
function lineChecks(n: NarrationFile) {
  const lines = new Map(allLines(n).map((l) => [l.id, l]));
  return (what: string, lineIds: string[], proposal: { id: string }[]): string[] => {
    const errors: string[] = [];
    for (const lid of lineIds) if (!lines.has(lid)) errors.push(`${what}: there is no line "${lid}"`);
    for (const p of proposal) {
      const line = lines.get(p.id);
      if (!line) errors.push(`${what}: proposal for unknown line "${p.id}"`);
      else if (isLocked(n, line)) errors.push(`${what}: proposes a change to ${p.id}, which is locked`);
      if (!lineIds.includes(p.id)) errors.push(`${what}: proposes a change to ${p.id}, which is not in its lineIds`);
    }
    return errors;
  };
}

export type ReviewResult = { round: ReviewRound; skipped: boolean; flagged: string[] };

export async function review(id: string, o: RunOpts = {}): Promise<ReviewResult> {
  const { brief, loopmap, narration } = need(id);
  if (narration.lockedAt) throw new StoryError(`the script is locked; unlock it to review again`);
  const p = storyPaths(id);
  const input = { brief: briefForClaude(brief), loopmap, narration: narrationForClaude(narration) };
  const inputHash = hash(input);
  const steps = readSteps(id);
  const history = readHistory(id);
  const factFile = join(p.reviewDir, "factcheck.json");
  const criticFile = join(p.reviewDir, "critic.json");
  const doneFact = !o.force && steps.done.factcheck?.inputHash === inputHash && existsSync(factFile);
  const doneCritic = !o.force && steps.done.critic?.inputHash === inputHash && existsSync(criticFile);
  if (doneFact && doneCritic && history.rounds.length) {
    o.progress?.({ step: "factcheck", phase: "skipped" });
    o.progress?.({ step: "critic", phase: "skipped" });
    return { round: history.rounds[history.rounds.length - 1]!, skipped: true, flagged: flaggedLines(id) };
  }

  // one reviewer may already be done for this script (a resumed job): say so instead of showing nothing
  if (doneFact) o.progress?.({ step: "factcheck", phase: "skipped" });
  if (doneCritic) o.progress?.({ step: "critic", phase: "skipped" });
  const check = lineChecks(narration);
  const loopIds = narration.loops.map((l) => l.id);
  const record = (step: "factcheck" | "critic") => {
    const s = readSteps(id);
    s.done[step] = { inputHash, finishedAt: now() };
    writeJson(p.steps, s);
  };

  const fact = doneFact
    ? Promise.resolve(readJson(factFile, FactCheckOutput)!)
    : (async () => {
        o.progress?.({ step: "factcheck", phase: "start", estimateMs: typicalDurationMs("factcheck") });
        const out = await callStep({
          project: id,
          step: "factcheck",
          input,
          tools: brief.factual ? ["WebSearch", "WebFetch"] : [],
          signal: o.signal,
          onAttempt: (attempt) => o.progress?.({ step: "factcheck", phase: "attempt", attempt }),
          check: (f) => [
            ...(f.mode !== (brief.factual ? "facts" : "consistency") ? [`mode must be "${brief.factual ? "facts" : "consistency"}" for this ${brief.factual ? "true" : "fictional"} story`] : []),
            ...f.claims.flatMap((c) => check(`claim ${c.id}`, c.lineIds, c.proposal)),
            ...f.issues.flatMap((k) => check(`issue ${k.id}`, k.lineIds, k.proposal)),
          ],
        });
        writeJson(factFile, out);
        record("factcheck");
        o.progress?.({ step: "factcheck", phase: "done" });
        return out;
      })();
  const critic = doneCritic
    ? Promise.resolve(readJson(criticFile, CriticOutput)!)
    : (async () => {
        o.progress?.({ step: "critic", phase: "start", estimateMs: typicalDurationMs("critic") });
        const out = await callStep({
          project: id,
          step: "critic",
          input,
          signal: o.signal,
          onAttempt: (attempt) => o.progress?.({ step: "critic", phase: "attempt", attempt }),
          check: (c) => [
            ...loopIds.filter((l) => !c.loops.some((s) => s.loopId === l)).map((l) => `loops: no score for loop ${l}`),
            ...c.loops.filter((s) => !loopIds.includes(s.loopId)).map((s) => `loops: there is no loop ${s.loopId}`),
            ...c.weakest.flatMap((w, i) => check(`weakest[${i}]`, w.lineIds, w.proposal)),
          ],
        });
        writeJson(criticFile, out);
        record("critic");
        o.progress?.({ step: "critic", phase: "done" });
        return out;
      })();

  // Both run to the end even if one fails, so a rerun only redoes the one that failed.
  const [f, c] = await Promise.allSettled([fact, critic]);
  if (f.status === "rejected") throw f.reason;
  if (c.status === "rejected") throw c.reason;

  const round = history.rounds.length + 1;
  writeJson(join(p.reviewDir, `factcheck.r${round}.json`), f.value);
  writeJson(join(p.reviewDir, `critic.r${round}.json`), c.value);
  const added = commentsFrom(narration, f.value, c.value, round);
  const existing = readComments(id);
  const at = now();
  // the new round replaces old open findings, and the fix suggestions that answered them (directed rewrites stay)
  const replaced = new Set(existing.comments.filter((x) => x.status === "open" && x.source !== "rewrite").map((x) => x.id));
  const kept = existing.comments.map((x) =>
    x.status === "open" && (replaced.has(x.id) || (x.source === "rewrite" && x.answers.length > 0 && x.answers.every((a) => replaced.has(a) || existing.comments.find((c) => c.id === a)?.status !== "open")))
      ? { ...x, status: "superseded" as const, decidedAt: at }
      : x,
  );
  writeComments(id, { version: 1, comments: [...kept, ...added] });

  const scores = c.value.loops;
  const all = scores.flatMap((s) => [s.stakes, s.question, s.surprise, s.rehook]);
  const blockers = added.filter((x) => x.severity === "blocker").length;
  const r: ReviewRound = {
    round,
    at,
    factual: brief.factual,
    facts: {
      confirmed: f.value.claims.filter((x) => x.verdict === "confirmed").length,
      wrong: f.value.claims.filter((x) => x.verdict === "wrong").length,
      unverifiable: f.value.claims.filter((x) => x.verdict === "unverifiable").length,
      issues: f.value.issues.length,
    },
    scores,
    mean: Math.round((all.reduce((s, n) => s + n, 0) / Math.max(1, all.length)) * 100) / 100,
    blockers,
    passed: blockers === 0 && !all.some((n) => n <= 2),
  };
  writeJson(p.reviewHistory, { version: 1, rounds: [...history.rounds, r] });
  return { round: r, skipped: false, flagged: flaggedLines(id) };
}

export function commentsFrom(n: NarrationFile, f: FactCheckOutput, c: CriticOutput, round: number): Comment[] {
  const text = new Map(allLines(n).map((l) => [l.id, l.text]));
  const at = now();
  const proposal = (ps: { id: string; text: string }[]) => ps.map((p) => ({ id: p.id, text: p.text, before: text.get(p.id) ?? "" }));
  const base = { round, status: "open" as const, direction: "", answers: [], createdAt: at, decidedAt: null };
  const out: Comment[] = [];
  for (const k of f.claims) {
    if (k.verdict === "confirmed") continue; // shown as a "checked" mark with sources, not as a comment
    out.push({
      ...base,
      id: `r${round}-${k.id}`,
      source: "factcheck",
      lineIds: k.lineIds,
      title: k.verdict === "wrong" ? `Wrong: ${k.claim}` : `Unverifiable: ${k.claim}`,
      message: [k.correction, k.note].filter(Boolean).join(" "),
      severity: k.verdict === "wrong" ? "blocker" : "suggestion",
      proposal: proposal(k.proposal),
      sources: k.sources,
    });
  }
  for (const k of f.issues) {
    const minor = k.severity === "minor";
    out.push({ ...base, id: `r${round}-${k.id}`, source: "consistency", lineIds: k.lineIds, title: `${minor ? "Minor: inconsistent" : "Inconsistent"} ${k.kind.replace("_", " ")}`, message: k.issue, severity: minor ? "suggestion" : "blocker", proposal: proposal(k.proposal), sources: [] });
  }
  c.weakest.forEach((w, i) => {
    out.push({ ...base, id: `r${round}-W${i + 1}`, source: "critic", lineIds: w.lineIds, title: w.problem, message: w.why, severity: "suggestion", proposal: proposal(w.proposal), sources: [] });
  });
  return out;
}

/** Lines a failed review flags: open blockers, plus the critic's moments when a loop scored 2 or less. */
export function flaggedComments(id: string): Comment[] {
  const comments = readComments(id).comments.filter((c) => c.status === "open" && c.source !== "rewrite");
  const last = readHistory(id).rounds.at(-1);
  const weakLoop = last?.scores.some((s) => Math.min(s.stakes, s.question, s.surprise, s.rehook) <= 2) ?? false;
  const answered = new Set(readComments(id).comments.filter((c) => c.source === "rewrite" && c.status === "open").flatMap((c) => c.answers));
  return comments.filter((c) => (c.severity === "blocker" || (weakLoop && c.source === "critic")) && !answered.has(c.id));
}
export function flaggedLines(id: string): string[] {
  return [...new Set(flaggedComments(id).flatMap((c) => c.lineIds))];
}

// ---------------------------------------------------------------- rewrite (directed, and the fix loop)

/** The fact-checker's verdicts, so a rewrite never brings back a claim it rejected (latest round). */
function factsForRewrite(id: string) {
  const f = readJson(join(storyPaths(id).reviewDir, "factcheck.json"), FactCheckOutput);
  if (!f || f.mode !== "facts") return null;
  return {
    doNotState: f.claims.filter((c) => c.verdict !== "confirmed").map((c) => ({ claim: c.claim, verdict: c.verdict, correction: c.correction, lineIds: c.lineIds })),
    confirmed: f.claims.filter((c) => c.verdict === "confirmed").map((c) => c.claim),
  };
}

/** The narration with some lines replaced, for checking a rewrite before it is offered. */
function withLines(n: NarrationFile, lines: RewriteLine[]): NarrationFile {
  const by = new Map(lines.map((l) => [l.id, l]));
  return { ...n, loops: n.loops.map((loop) => ({ ...loop, lines: loop.lines.map((l) => (by.has(l.id) ? { ...l, ...by.get(l.id)! } : l)) })) };
}
type RewriteLine = { id: string; text: string; energy: number; delivery: string; beats: ScriptLine["beats"]; plants: string[]; payoffs: string[] };

async function runRewrite(id: string, lineIds: string[], direction: string, o: RunOpts) {
  const { brief, loopmap, narration } = need(id);
  if (narration.lockedAt) throw new StoryError(`the script is locked; unlock it before rewriting`);
  const lines = new Map(allLines(narration).map((l) => [l.id, l]));
  const unknown = lineIds.filter((l) => !lines.has(l));
  if (unknown.length) throw new StoryError(`there is no line ${unknown.join(", ")}`);
  const locked = lineIds.filter((l) => lines.get(l)!.locked);
  if (locked.length) throw new StoryError(`${locked.join(", ")} ${locked.length === 1 ? "is" : "are"} locked; locked lines are never rewritten`);
  if (!direction.trim()) throw new StoryError("a rewrite needs a direction");
  const order = allLines(narration).map((l) => l.id);
  const ids = [...lineIds].sort((a, b) => order.indexOf(a) - order.indexOf(b));

  // loop-check errors the rewrite would add (problems already in the script don't count against it)
  const opts = { budget: budgetOf(brief), wpm: brief.wpm };
  const key = (f: { code: string; loopId?: string; lineIds: string[] }) => `${f.code}|${f.loopId ?? ""}|${f.lineIds.join(",")}`;
  const before = new Set(checkStory(loopmap, narration, opts).findings.filter((f) => f.level === "error").map(key));
  const added = (r: { lines: RewriteLine[] }) =>
    checkStory(loopmap, withLines(narration, r.lines), opts)
      .findings.filter((f) => f.level === "error" && !before.has(key(f)))
      .map((f) => `loop checker: ${f.message}`);

  o.progress?.({ step: "rewrite", phase: "start", estimateMs: typicalDurationMs("rewrite") });
  const out = await callStep({
    project: id,
    step: "rewrite",
    input: { brief: briefForClaude(brief), loopmap, narration: narrationForClaude(narration), factcheck: factsForRewrite(id), lineIds: ids, direction },
    signal: o.signal,
    onAttempt: (attempt) => o.progress?.({ step: "rewrite", phase: "attempt", attempt }),
    check: (r) => {
      const got = r.lines.map((l) => l.id);
      const errors: string[] = [];
      for (const l of ids) if (!got.includes(l)) errors.push(`lines: ${l} was asked for but is missing`);
      for (const l of got) if (!ids.includes(l)) errors.push(`lines: ${l} was not asked for; return only ${ids.join(", ")}`);
      return errors;
    },
    softCheck: added,
  });
  o.progress?.({ step: "rewrite", phase: "done" });
  return { out, narration, ids, warnings: added(out).map((w) => w.replace(/^loop checker: /, "")) };
}

/** A warning on a suggestion that still breaks a loop check after the retry. */
function withWarnings(message: string, warnings: string[]): string {
  return warnings.length ? [`Breaks a loop check if accepted: ${warnings.join(" ")}`, message].filter(Boolean).join(" ") : message;
}

function proposalFrom(narration: NarrationFile, lines: { id: string; text: string; energy: number; delivery: string; beats: ScriptLine["beats"]; plants: string[]; payoffs: string[] }[]): Comment["proposal"] {
  const before = new Map(allLines(narration).map((l) => [l.id, l]));
  return lines.map((l) => ({ id: l.id, text: l.text, energy: l.energy, delivery: l.delivery, beats: l.beats, plants: l.plants, payoffs: l.payoffs, before: before.get(l.id)?.text ?? "" }));
}

/** "Rewrite with direction": Claude rewrites only these lines, keeping their ids. The result is a suggestion to accept or reject. */
export async function rewrite(id: string, lineIds: string[], direction: string, o: RunOpts = {}): Promise<Comment> {
  const { out, narration, ids, warnings } = await runRewrite(id, lineIds, direction, o);
  const comments = readComments(id);
  const n = comments.comments.filter((c) => c.source === "rewrite").length + 1;
  const comment: Comment = {
    id: `rw${n}`,
    source: "rewrite",
    round: 0,
    lineIds: ids,
    title: `Rewrite: ${direction.trim().slice(0, 80)}`,
    message: withWarnings(out.note, warnings),
    severity: "suggestion",
    proposal: proposalFrom(narration, out.lines),
    sources: [],
    status: "open",
    direction: direction.trim(),
    answers: [],
    createdAt: now(),
    decidedAt: null,
  };
  writeComments(id, { version: 1, comments: [...comments.comments, comment] });
  return comment;
}

/** The fix loop: only the flagged lines go back to the rewrite step, with the findings as direction. */
export async function fix(id: string, o: RunOpts = {}): Promise<Comment[]> {
  const narration = readNarration(id);
  const locked = new Set(narration ? allLines(narration).filter((l) => l.locked).map((l) => l.id) : []);
  const findings = flaggedComments(id).filter((c) => c.lineIds.some((l) => !locked.has(l)));
  if (!findings.length) return [];
  const lineIds = [...new Set(findings.flatMap((c) => c.lineIds.filter((l) => !locked.has(l))))];
  const direction = [
    "Fix these reviewer findings. Rewrite only the listed lines.",
    ...findings.map((c) => {
      const parts = [`- [${c.lineIds.join(", ")}] ${c.title}.`];
      if (c.message) parts.push(c.message);
      if (c.sources.length) parts.push(`Source: ${c.sources.map((s) => s.url).join(", ")}.`);
      if (c.proposal.length) parts.push(`Reviewer's suggestion: ${c.proposal.map((p) => `${p.id} "${p.text}"`).join(" ")}`);
      return parts.join(" ");
    }),
  ].join("\n");
  const { out, narration: n, warnings } = await runRewrite(id, lineIds, direction, o);
  const comments = readComments(id);
  let k = comments.comments.filter((c) => c.source === "rewrite").length;
  const assigned = new Set<string>();
  const added: Comment[] = [];
  for (const finding of findings) {
    // a line shared by several findings is rewritten once; that rewrite answers all of them
    for (const c of added) if (c.lineIds.some((l) => finding.lineIds.includes(l))) c.answers.push(finding.id);
    const mine = out.lines.filter((l) => finding.lineIds.includes(l.id) && !assigned.has(l.id));
    if (!mine.length) continue;
    mine.forEach((l) => assigned.add(l.id));
    added.push({
      id: `rw${++k}`,
      source: "rewrite",
      round: finding.round,
      lineIds: mine.map((l) => l.id),
      title: `Fix for ${finding.id}: ${finding.title.length > 72 ? `${finding.title.slice(0, 71).trimEnd()}…` : finding.title}`,
      // the rewrite's note covers the whole batch: say it once, on the first fix
      message: added.length === 0 ? withWarnings(out.note, warnings) : "",
      severity: "suggestion",
      proposal: proposalFrom(n, mine),
      sources: finding.sources,
      status: "open",
      direction: finding.message,
      answers: [finding.id],
      createdAt: now(),
      decidedAt: null,
    });
  }
  writeComments(id, { version: 1, comments: [...comments.comments, ...added] });
  return added;
}

// ---------------------------------------------------------------- decide (accept / reject)

export function decide(id: string, commentId: string, decision: "accept" | "reject"): { comment: Comment; narration: NarrationFile } {
  const narration = readNarration(id);
  if (!narration) throw new StoryError(`project "${id}" has no narration`);
  if (narration.lockedAt) throw new StoryError("the script is locked; unlock it to change it");
  const comments = readComments(id);
  const comment = comments.comments.find((c) => c.id === commentId);
  if (!comment) throw new StoryError(`there is no comment "${commentId}"`);
  if (comment.status !== "open") throw new StoryError(`comment ${commentId} is already ${comment.status}`);
  const at = now();
  let next = narration;
  if (decision === "accept") {
    if (!comment.proposal.length) throw new StoryError(`comment ${commentId} has no proposed text to accept; edit the line or reject it`);
    const byId = new Map(comment.proposal.map((p) => [p.id, p]));
    const lockedHit = allLines(narration).filter((l) => byId.has(l.id) && l.locked).map((l) => l.id);
    if (lockedHit.length) throw new StoryError(`${lockedHit.join(", ")} ${lockedHit.length === 1 ? "is" : "are"} locked`);
    next = NarrationFile.parse({
      ...narration,
      updatedAt: at,
      loops: narration.loops.map((loop) => ({
        ...loop,
        lines: loop.lines.map((l) => {
          const p = byId.get(l.id);
          if (!p) return l;
          const sources = [...l.sources, ...comment.sources.filter((s) => !l.sources.some((x) => x.url === s.url))];
          return { ...l, text: p.text, energy: p.energy ?? l.energy, delivery: p.delivery ?? l.delivery, beats: p.beats ?? l.beats, plants: p.plants ?? l.plants, payoffs: p.payoffs ?? l.payoffs, sources };
        }),
      })),
    });
    writeJson(storyPaths(id).narration, next);
  }
  const status = decision === "accept" ? "accepted" : "rejected";
  const updated = comments.comments.map((c) => {
    if (c.id === commentId) return { ...c, status, decidedAt: at } as Comment;
    if (decision !== "accept" || c.status !== "open") return c;
    // accepting a fix settles the finding it answers, and vice versa
    if (comment.answers.includes(c.id) || c.answers.includes(commentId)) return { ...c, status: "superseded", decidedAt: at } as Comment;
    return c;
  });
  writeComments(id, { version: 1, comments: updated });
  return { comment: updated.find((c) => c.id === commentId)!, narration: next };
}

// ---------------------------------------------------------------- editor save, lock

/** Saves the editor's narration. Locked lines cannot change; a locked script cannot change at all. */
export function saveNarration(id: string, raw: unknown): NarrationFile {
  const current = readNarration(id);
  if (!current) throw new StoryError(`project "${id}" has no narration`);
  if (current.lockedAt) throw new StoryError("the script is locked; unlock it to edit");
  const parsed = NarrationFile.safeParse(raw);
  if (!parsed.success) throw new StoryError(`the narration is not valid:\n  - ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  - ")}`);
  const before = new Map(allLines(current).map((l) => [l.id, l]));
  for (const l of allLines(parsed.data)) {
    const b = before.get(l.id);
    if (b?.locked && l.locked && (b.text !== l.text || b.energy !== l.energy || b.delivery !== l.delivery)) throw new StoryError(`${l.id} is locked; unlock the line to edit it`);
  }
  const next = { ...parsed.data, lockedAt: null, updatedAt: now() };
  writeJson(storyPaths(id).narration, next);
  return next;
}

export function lock(id: string, o: { force?: boolean } = {}): { narration: NarrationFile; scriptJson: string; report: CheckReport } {
  const { narration } = need(id);
  const report = check(id);
  const blockers = readComments(id).comments.filter((c) => c.status === "open" && c.severity === "blocker");
  if (!o.force) {
    const problems = [
      ...report.findings.filter((f) => f.level === "error").map((f) => `[${f.code}] ${f.message}`),
      ...blockers.map((c) => `open review finding ${c.id} (${c.lineIds.join(", ")}): ${c.title}`),
    ];
    if (problems.length) throw new StoryError(`the script can't be locked yet:\n  - ${problems.join("\n  - ")}\nFix these (or pass --force to lock anyway).`);
  }
  const next = { ...narration, lockedAt: now() };
  writeJson(storyPaths(id).narration, next);
  const scriptJson = storyPaths(id).scriptJson;
  writeFileSync(scriptJson, JSON.stringify(narrationToScript(next), null, 2) + "\n");
  return { narration: next, scriptJson, report };
}

export function unlock(id: string): NarrationFile {
  const { narration } = need(id);
  const next = { ...narration, lockedAt: null, updatedAt: now() };
  writeJson(storyPaths(id).narration, next);
  return next;
}
