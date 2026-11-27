/**
 * The story engine without the UI.
 *
 *   pnpm story new "<sentence>" --type <narrative> --format youtube|reel --minutes N [--wpm 170] [--true|--fiction] [--notes "…"] [--id <id>]
 *   pnpm story pick <id> <A|B|C> [--force]        loop map + narration, then the checker
 *   pnpm story check <id>                         loop checker; writes projects/<id>/tension.svg
 *   pnpm story review <id> [--force] [--no-fix]   fact-check + critic in parallel; a failed review sends flagged lines to be rewritten
 *   pnpm story fix <id>                           rewrite only the flagged lines (suggestions)
 *   pnpm story rewrite <id> L2.3,L2.4 "<direction>"
 *   pnpm story comments <id> [--all]
 *   pnpm story accept <id> <comment…>   |   pnpm story reject <id> <comment…>
 *   pnpm story lock <id> [--force]                writes projects/<id>/script.json for `pnpm voice <id>`
 *   pnpm story unlock <id>
 *   pnpm story show <id>    |   pnpm story usage [<id>]   |   pnpm story list
 */
import { storyPaths } from "@studio/project";
import { NARRATIVES, allLines, budgetOf, type Comment, type StepName } from "@studio/schema";
import { formatReport, tensionGraph, tensionSvg } from "@studio/story";
import { writeFileSync } from "node:fs";
import { BusyError, withLock } from "./lock";
import { check, decide, fix, lock, readHistory, review, rewrite, unlock } from "./review";
import { StoryError, createProject, generateOptions, listProjects, pickOption, readBrief, readComments, readLoopMap, readNarration, readOptions, readPick, writeStory, type Progress } from "./story";
import { byStep, readUsage, totals, type UsageTotals } from "./usage";

const VALUE_FLAGS = new Set(["--type", "--format", "--minutes", "--wpm", "--notes", "--id"]);
const args = process.argv.slice(2);
const [command, ...rest] = args;
const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUE_FLAGS.has(rest[i - 1]!)));
const has = (f: string) => rest.includes(`--${f}`);
function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i > -1 ? rest[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const LABEL: Record<StepName, string> = { options: "master loop options", loopmap: "loop map", narration: "narration", rewrite: "rewrite", factcheck: "fact-check", critic: "retention critic" };
const secs = (ms: number) => `${Math.round(ms / 1000)} s`;

/** Prints step progress; on a terminal, a ticking elapsed time. */
function progress(): Progress {
  const started = new Map<string, number>();
  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    if (!process.stdout.isTTY || !started.size) return;
    const now = Date.now();
    process.stdout.write(`\r  … ${[...started].map(([s, t]) => `${LABEL[s as StepName]} ${secs(now - t)}`).join(" · ")}   `);
  };
  return (e) => {
    if (e.phase === "start") {
      started.set(e.step, Date.now());
      console.log(`→ ${LABEL[e.step]}${e.estimateMs ? ` (usually about ${secs(e.estimateMs)})` : ""}`);
      timer ??= setInterval(tick, 1000);
    } else if (e.phase === "attempt" && (e.attempt ?? 1) > 1) {
      console.log(`\n  ↻ ${LABEL[e.step]}: the answer failed validation; retrying once with the errors`);
    } else if (e.phase === "done") {
      if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
      console.log(`✓ ${LABEL[e.step]} (${secs(Date.now() - (started.get(e.step) ?? Date.now()))})`);
      started.delete(e.step);
      if (!started.size && timer) {
        clearInterval(timer);
        timer = undefined;
      }
    } else if (e.phase === "skipped") {
      console.log(`· ${LABEL[e.step]}: already done for this input (use --force to redo)`);
    }
  };
}

function printOptions(id: string) {
  const o = readOptions(id);
  if (!o) return;
  for (const x of o.options) {
    console.log(`\n  ${x.id}  ${x.title}`);
    console.log(`     ${x.logline}`);
    console.log(`     stakes (${x.stakes.type}): ${x.stakes.text}`);
    console.log(`     question: ${x.question}`);
    console.log(`     twist: expect "${x.endingTwist.expected}" → get "${x.endingTwist.actual}"`);
    console.log(`     hook: "${x.hook}"`);
  }
  console.log(`\nPick one: pnpm story pick ${id} <A|B|C>`);
}

function runCheck(id: string): boolean {
  const report = check(id);
  const map = readLoopMap(id)!;
  console.log(formatReport(report, id));
  const svg = storyPaths(id).dir + "/tension.svg";
  writeFileSync(svg, tensionSvg(tensionGraph(map, report), `${id} · tension`));
  console.log(`\n  tension graph: ${svg}`);
  return report.ok;
}

function printComment(c: Comment) {
  const mark = c.status === "open" ? (c.severity === "blocker" ? "✗" : "•") : c.status === "accepted" ? "✓" : "–";
  console.log(`\n  ${mark} ${c.id}  [${c.source}${c.severity === "blocker" ? ", blocker" : ""}${c.status === "open" ? "" : `, ${c.status}`}]  ${c.lineIds.join(", ")}`);
  console.log(`     ${c.title}`);
  if (c.message) console.log(`     ${c.message}`);
  for (const p of c.proposal) {
    console.log(`     ${p.id}  − ${p.before}`);
    console.log(`     ${" ".repeat(p.id.length)}  + ${p.text}`);
  }
  for (const s of c.sources) console.log(`     source: ${s.url}${s.title ? ` (${s.title})` : ""}`);
}

function printRound(id: string) {
  const r = readHistory(id).rounds.at(-1);
  if (!r) return;
  console.log(`\nReview round ${r.round}: ${r.passed ? "passed" : "failed"} · mean score ${r.mean.toFixed(2)} · ${r.blockers} blocker(s)`);
  console.log(r.factual ? `  facts: ${r.facts.confirmed} confirmed, ${r.facts.wrong} wrong, ${r.facts.unverifiable} unverifiable` : `  consistency issues: ${r.facts.issues}`);
  console.log("  loop  stakes question surprise rehook  note");
  for (const s of r.scores) console.log(`  ${s.loopId.padEnd(5)} ${String(s.stakes).padEnd(6)} ${String(s.question).padEnd(8)} ${String(s.surprise).padEnd(8)} ${String(s.rehook).padEnd(7)} ${s.note}`);
}

function usageLine(label: string, t: UsageTotals) {
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return `  ${label.padEnd(18)} ${String(t.calls).padStart(3)} call${t.calls === 1 ? " " : "s"}${t.failed ? ` (${t.failed} failed)` : ""}  in ${k(t.inputTokens).padStart(6)}  out ${k(t.outputTokens).padStart(6)}  cache r/w ${k(t.cacheReadTokens)}/${k(t.cacheWriteTokens)}  ${t.webSearches ? `${t.webSearches} searches  ` : ""}${secs(t.durationMs).padStart(6)}  ~$${t.costUsd.toFixed(2)}`;
}

function printUsage(id: string) {
  const records = readUsage(id);
  console.log(`\n${id}:`);
  for (const [step, t] of Object.entries(byStep(records))) console.log(usageLine(LABEL[step as StepName] ?? step, t));
  console.log(usageLine("total", totals(records)));
}

async function locked<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return withLock(label, fn);
}

const need = (n: number, usage: string) => {
  if (positional.length < n) fail(`usage: ${usage}`);
};

try {
  switch (command) {
    case "new": {
      need(1, `pnpm story new "<sentence>" --type <${Object.keys(NARRATIVES).join("|")}> --format youtube|reel --minutes N`);
      const type = flag("type") ?? fail("--type is required");
      const format = flag("format") ?? "youtube";
      if (format !== "youtube" && format !== "reel") fail(`--format is youtube or reel`);
      const minutes = Number(flag("minutes") ?? (format === "reel" ? 1.25 : 8));
      const brief = createProject({
        sentence: positional[0]!,
        narrative: type as keyof typeof NARRATIVES,
        format,
        minutes,
        ...(flag("wpm") ? { wpm: Number(flag("wpm")) } : {}),
        ...(has("true") ? { factual: true } : has("fiction") ? { factual: false } : {}),
        ...(flag("notes") ? { notes: flag("notes") } : {}),
        ...(flag("id") ? { id: flag("id") } : {}),
      });
      console.log(`✓ project ${brief.id}: ${brief.format}, ${brief.minutes} min (${budgetOf(brief)} words at ${brief.wpm} wpm), ${brief.narrative}, ${brief.factual ? "true story (fact-checked)" : "fiction (consistency-checked)"}`);
      await locked(`story new ${brief.id}`, () => generateOptions(brief.id, { progress: progress() }));
      printOptions(brief.id);
      break;
    }
    case "pick": {
      need(2, "pnpm story pick <id> <A|B|C> [--force]");
      const [id, option] = positional as [string, string];
      const pick = pickOption(id, option, { force: has("force") });
      console.log(`✓ picked ${pick.optionId}: ${pick.option.title}`);
      await locked(`story pick ${id}`, () => writeStory(id, { progress: progress(), force: has("force") }));
      console.log("");
      runCheck(id);
      console.log(`\nNext: pnpm story review ${id}`);
      break;
    }
    case "check": {
      need(1, "pnpm story check <id>");
      process.exitCode = runCheck(positional[0]!) ? 0 : 1;
      break;
    }
    case "review": {
      need(1, "pnpm story review <id> [--force] [--no-fix]");
      const id = positional[0]!;
      await locked(`story review ${id}`, async () => {
        const r = await review(id, { progress: progress(), force: has("force") });
        printRound(id);
        const open = readComments(id).comments.filter((c) => c.status === "open");
        open.forEach(printComment);
        if (!r.round.passed && r.flagged.length && !has("no-fix")) {
          console.log(`\nThe review failed: sending ${r.flagged.length} flagged line(s) back to be rewritten (${r.flagged.join(", ")}).`);
          const fixes = await fix(id, { progress: progress() });
          fixes.forEach(printComment);
        }
      });
      console.log(`\nAccept or reject: pnpm story accept ${id} <comment>  ·  pnpm story reject ${id} <comment>  ·  or open the editor`);
      break;
    }
    case "fix": {
      need(1, "pnpm story fix <id>");
      const id = positional[0]!;
      const fixes = await locked(`story fix ${id}`, () => fix(id, { progress: progress() }));
      if (!fixes.length) console.log("Nothing flagged to fix.");
      fixes.forEach(printComment);
      break;
    }
    case "rewrite": {
      need(3, 'pnpm story rewrite <id> L2.3,L2.4 "<direction>"');
      const [id, ids, direction] = positional as [string, string, string];
      const c = await locked(`story rewrite ${id}`, () => rewrite(id, ids.split(",").map((s) => s.trim()).filter(Boolean), direction, { progress: progress() }));
      printComment(c);
      console.log(`\nAccept: pnpm story accept ${id} ${c.id}`);
      break;
    }
    case "comments": {
      need(1, "pnpm story comments <id> [--all]");
      const cs = readComments(positional[0]!).comments.filter((c) => has("all") || c.status === "open");
      if (!cs.length) console.log("No open comments.");
      cs.forEach(printComment);
      break;
    }
    case "accept":
    case "reject": {
      need(2, `pnpm story ${command} <id> <comment…>`);
      const [id, ...ids] = positional as [string, ...string[]];
      for (const cid of ids) {
        decide(id, cid, command);
        console.log(`✓ ${cid} ${command}ed`);
      }
      break;
    }
    case "lock": {
      need(1, "pnpm story lock <id> [--force]");
      const { scriptJson, narration } = lock(positional[0]!, { force: has("force") });
      console.log(`✓ locked ${allLines(narration).length} lines → ${scriptJson}\n  Next: pnpm voice ${positional[0]}`);
      break;
    }
    case "unlock": {
      need(1, "pnpm story unlock <id>");
      unlock(positional[0]!);
      console.log("✓ unlocked");
      break;
    }
    case "show": {
      need(1, "pnpm story show <id>");
      const id = positional[0]!;
      const b = readBrief(id);
      const pick = readPick(id);
      const n = readNarration(id);
      console.log(`${id}: "${b.sentence}" · ${b.format} ${b.minutes} min · ${b.narrative}${pick ? ` · option ${pick.optionId}: ${pick.option.title}` : ""}${n?.lockedAt ? ` · locked ${n.lockedAt}` : ""}`);
      if (!n) {
        printOptions(id);
        break;
      }
      for (const loop of n.loops) {
        console.log(`\n${loop.id}`);
        for (const l of loop.lines) console.log(`  ${l.id.padEnd(6)} [${l.energy}] ${l.text}  (${l.delivery}${l.beats.length ? ` · ${l.beats.join(", ")}` : ""})${l.locked ? " 🔒" : ""}`);
      }
      break;
    }
    case "usage": {
      const ids = positional.length ? positional : listProjects();
      for (const id of ids) printUsage(id);
      break;
    }
    case "list": {
      for (const id of listProjects()) {
        const b = readBrief(id);
        const n = readNarration(id);
        const state = n?.lockedAt ? "locked" : n ? "script" : readPick(id) ? "picked" : readOptions(id) ? "options" : "brief";
        console.log(`  ${id.padEnd(32)} ${b.format.padEnd(7)} ${String(b.minutes).padEnd(5)} ${state}`);
      }
      break;
    }
    default:
      console.log(readFileHeader());
      process.exitCode = command ? 1 : 0;
  }
} catch (e) {
  if (e instanceof StoryError || e instanceof BusyError) fail(e.message);
  if ((e as Error).name === "ClaudeGate") fail(`${(e as Error).message}\n  Nothing was saved for this step; run the same command again later.`);
  if ((e as Error).name === "ValidationError" || (e as Error).name === "ClaudeError") fail((e as Error).message);
  throw e;
}

function readFileHeader(): string {
  return `Story engine commands:

  pnpm story new "<sentence>" --type <narrative> --format youtube|reel --minutes N [--wpm 170] [--true|--fiction] [--notes "…"]
  pnpm story pick <id> <A|B|C> [--force]
  pnpm story check <id>
  pnpm story review <id> [--force] [--no-fix]
  pnpm story fix <id>
  pnpm story rewrite <id> L2.3,L2.4 "<direction>"
  pnpm story comments <id> [--all]
  pnpm story accept|reject <id> <comment…>
  pnpm story lock <id> [--force]   ·   pnpm story unlock <id>
  pnpm story show <id>   ·   pnpm story usage [<id>]   ·   pnpm story list

Narratives: ${Object.keys(NARRATIVES).join(", ")}`;
}
