import {
  DEFAULT_WPM,
  allLines,
  countWords,
  secondsFor,
  type Beat,
  type LoopMapOutput,
  type NarrationFile,
} from "@studio/schema";

/**
 * The loop checker (docs/PLAN.md section 3): code, not Claude. It reads the
 * loop map and the narration and reports, by loop and line id:
 *
 * - stretches of more than ~20 s with no open question (errors),
 * - loops whose stakes are never restated, or that lack a question, a head
 *   fake or a rehook (errors),
 * - head fakes whose plants are missing, unknown or shown too late (errors),
 * - the ending given away: a master plant paid off before the last loop, or
 *   a last loop that pays off none of them (errors),
 * - word-budget overruns per loop and overall (errors), short loops (warnings),
 * - things that break the voice step: digits and symbols (errors), very long
 *   lines (warnings),
 * - craft smells: yes/no questions, several energy-5 lines in a loop, plants
 *   never paid off, long stretches with no turn (warnings).
 *
 * Time is estimated from words at the brief's speaking rate (pauses included).
 */

export type Level = "error" | "warning";
export type Finding = {
  level: Level;
  code: string;
  message: string;
  loopId?: string;
  lineIds: string[];
  /** seconds from the start, where it applies */
  at?: number;
};

export type TimedLine = { id: string; loopId: string; index: number; text: string; words: number; start: number; end: number; energy: number; beats: Beat[]; plants: string[]; payoffs: string[] };
export type Gap = { start: number; end: number; lineIds: string[]; loopIds: string[] };
export type LoopStats = { loopId: string; title: string; words: number; budget: number; seconds: number; start: number; end: number };

export type CheckOptions = {
  /** seconds of narration allowed with no open question (default 20) */
  maxGap?: number;
  /** seconds without any turn inside an open question before a warning (default 35) */
  maxStale?: number;
  /** the stakes must land within this many seconds (default 15) */
  stakesBy?: number;
  /** total word budget (brief); defaults to the sum of the loop budgets */
  budget?: number;
  /** speaking rate, words per minute with pauses (default DEFAULT_WPM) */
  wpm?: number;
};

export type CheckReport = {
  ok: boolean;
  errors: number;
  warnings: number;
  findings: Finding[];
  lines: TimedLine[];
  loops: LoopStats[];
  gaps: Gap[];
  words: number;
  budget: number;
  seconds: number;
  wpm: number;
};

const OPENS: Beat[] = ["question", "turn", "rehook"];
const AUX = /^(will|would|is|are|was|were|does|do|did|can|could|should|has|have|had|am|shall|might|must)\b/i;
const SYMBOLS = /[%$&#@/+=<>{}[\]|\\^~*_]/;

/** Line times from words at `wpm`. The rate already includes the pauses between lines, so none are added. */
export function timeline(narration: Pick<NarrationFile, "loops">, wpm: number = DEFAULT_WPM): TimedLine[] {
  let t = 0;
  let index = 0;
  return narration.loops.flatMap((loop) =>
    loop.lines.map((l) => {
      const words = countWords(l.text);
      const start = t;
      const end = start + secondsFor(words, wpm);
      t = end;
      return { id: l.id, loopId: loop.id, index: index++, text: l.text, words, start, end, energy: l.energy, beats: l.beats, plants: l.plants, payoffs: l.payoffs };
    }),
  );
}

const fmt = (s: number) => `${Math.round(s)} s`;
const span = (ids: string[]) => (ids.length <= 1 ? (ids[0] ?? "") : `${ids[0]}–${ids[ids.length - 1]}`);

/** Stretches with no open question. A question/turn/rehook line opens one; a head fake line answers it (unless it also rehooks). */
export function openQuestionGaps(lines: TimedLine[]): Gap[] {
  const gaps: Gap[] = [];
  let open = false;
  let since = 0;
  let inGap: TimedLine[] = [];
  const close = (until: number) => {
    gaps.push({ start: since, end: until, lineIds: inGap.map((l) => l.id), loopIds: [...new Set(inGap.map((l) => l.loopId))] });
    inGap = [];
  };
  for (const l of lines) {
    const opens = l.beats.some((b) => OPENS.includes(b));
    const answers = l.beats.includes("headfake") && !opens;
    if (!open && opens) {
      close(l.start);
      open = true;
    } else if (!open) {
      inGap.push(l);
    }
    if (answers && open) {
      open = false;
      since = l.end;
    }
  }
  if (!open) close(lines.length ? lines[lines.length - 1]!.end : 0);
  return gaps.filter((g) => g.end > g.start);
}

/** Looks at the question sentence itself: "Midnight. Will he catch the thief?" is yes/no. */
function isYesNo(q: string): boolean {
  const sentences = q.trim().split(/(?<=[.!?…])\s+/);
  const question = sentences.findLast((s) => s.endsWith("?")) ?? sentences[sentences.length - 1] ?? "";
  return AUX.test(question.replace(/^(and|but|so)\s+/i, ""));
}

export function checkLoopMap(map: LoopMapOutput, budget?: number): Finding[] {
  const f: Finding[] = [];
  const order = new Map(map.loops.map((l, i) => [l.id, i]));
  const plants = new Map(map.plants.map((p) => [p.id, p]));
  const plantRef = (ownerLoop: string | undefined, ids: string[], who: string) => {
    for (const pid of ids) {
      const p = plants.get(pid);
      if (!p) {
        f.push({ level: "error", code: "plant-unknown", loopId: ownerLoop, lineIds: [], message: `${who}: its head fake relies on ${pid}, which is not in the plant list.` });
      } else if (ownerLoop && (order.get(p.loopId) ?? 0) > (order.get(ownerLoop) ?? 0)) {
        f.push({ level: "error", code: "plant-late", loopId: ownerLoop, lineIds: [], message: `${who}: its head fake relies on ${pid}, which is only planted later, in ${p.loopId}. A twist needs its plant first.` });
      }
    }
  };
  for (const l of map.loops) {
    plantRef(l.id, l.headFake.plantIds, `Loop ${l.id}`);
    if (isYesNo(l.question)) f.push({ level: "warning", code: "yes-no", loopId: l.id, lineIds: [], message: `Loop ${l.id}: "${l.question}" is a yes/no question. Ask who, what, why or how, so the viewer can guess wrong.` });
  }
  plantRef(undefined, map.master.headFake.plantIds, "Master loop");
  // the ending twist's plants are reserved for the last loop: paying one off earlier gives the ending away
  const master = new Set(map.master.headFake.plantIds);
  const lastLoop = map.loops[map.loops.length - 1];
  for (const l of map.loops.slice(0, -1)) {
    const early = l.headFake.plantIds.filter((pid) => master.has(pid));
    if (early.length) f.push({ level: "error", code: "master-plant-early", loopId: l.id, lineIds: [], message: `Loop ${l.id}: its head fake uses ${early.join(", ")}, which the ending twist needs. Paying ${early.length > 1 ? "them" : "it"} off in ${l.id} gives the ending away; give ${l.id} its own plant.` });
  }
  if (lastLoop && !lastLoop.headFake.plantIds.some((pid) => master.has(pid))) {
    f.push({ level: "error", code: "master-not-last", loopId: lastLoop.id, lineIds: [], message: `The last loop (${lastLoop.id}) pays off none of the ending twist's plants (${[...master].join(", ")}), so the ending twist never lands.` });
  }
  if (isYesNo(map.master.question)) f.push({ level: "warning", code: "yes-no", lineIds: [], message: `Master loop: "${map.master.question}" is a yes/no question.` });
  const usedPlants = new Set([...map.loops.flatMap((l) => l.headFake.plantIds), ...map.master.headFake.plantIds]);
  for (const p of map.plants) {
    if (!usedPlants.has(p.id)) f.push({ level: "warning", code: "plant-unused", loopId: p.loopId, lineIds: [], message: `Plant ${p.id} ("${p.detail}") is never used by a head fake.` });
  }
  if (budget !== undefined) {
    const sum = map.loops.reduce((s, l) => s + l.wordBudget, 0);
    if (Math.abs(sum - budget) > budget * 0.02) f.push({ level: "error", code: "budget-map", lineIds: [], message: `Loop budgets add up to ${sum} words; the brief's budget is ${budget}.` });
  }
  return f;
}

export function checkStory(map: LoopMapOutput, narration: Pick<NarrationFile, "loops">, o: CheckOptions = {}): CheckReport {
  const maxGap = o.maxGap ?? 20;
  const maxStale = o.maxStale ?? 35;
  const stakesBy = o.stakesBy ?? 15;
  const budget = o.budget ?? map.loops.reduce((s, l) => s + l.wordBudget, 0);
  const f: Finding[] = checkLoopMap(map, o.budget);
  const wpm = o.wpm ?? DEFAULT_WPM;
  const lines = timeline(narration, wpm);
  const byLoop = new Map<string, TimedLine[]>();
  for (const l of lines) (byLoop.get(l.loopId) ?? byLoop.set(l.loopId, []).get(l.loopId)!).push(l);

  // --- loops line up with the map
  const mapIds = map.loops.map((l) => l.id);
  const narrIds = narration.loops.map((l) => l.id);
  for (const id of mapIds) if (!narrIds.includes(id)) f.push({ level: "error", code: "loop-missing", loopId: id, lineIds: [], message: `Loop ${id} is in the loop map but has no narration.` });
  for (const id of narrIds) if (!mapIds.includes(id)) f.push({ level: "error", code: "loop-unknown", loopId: id, lineIds: [], message: `The narration has a loop ${id} that the loop map doesn't.` });

  // --- beats per loop
  const last = mapIds[mapIds.length - 1];
  for (const loop of map.loops) {
    const ls = byLoop.get(loop.id) ?? [];
    if (!ls.length) continue;
    const has = (b: Beat) => ls.filter((l) => l.beats.includes(b));
    const ids = ls.map((l) => l.id);
    if (!has("stakes").length) f.push({ level: "error", code: "stakes-missing", loopId: loop.id, lineIds: ids, message: `Loop ${loop.id} (${span(ids)}) never restates the stakes. Mark the line that does with "stakes", or add one: "${loop.stakes.text}"` });
    if (!has("question").length && !(ls[0] && lines[ls[0].index - 1]?.beats.includes("rehook"))) {
      f.push({ level: "error", code: "question-missing", loopId: loop.id, lineIds: ids, message: `Loop ${loop.id} (${span(ids)}) never asks its question ("${loop.question}"), and the previous loop's rehook doesn't lead into it.` });
    }
    const fakes = has("headfake");
    if (!fakes.length) f.push({ level: "error", code: "headfake-missing", loopId: loop.id, lineIds: ids, message: `Loop ${loop.id} (${span(ids)}) has no head fake line. Where does "${loop.headFake.actual}" land?` });
    const rehooks = has("rehook");
    if (loop.id !== last && !rehooks.length) f.push({ level: "error", code: "rehook-missing", loopId: loop.id, lineIds: [ids[ids.length - 1]!], message: `Loop ${loop.id} ends without a rehook (last line ${ids[ids.length - 1]}). Close the question and open the next one: "${loop.rehook}"` });
    else if (rehooks.length && ls.indexOf(rehooks[rehooks.length - 1]!) < ls.length - 2) {
      const r = rehooks[rehooks.length - 1]!;
      f.push({ level: "warning", code: "rehook-early", loopId: loop.id, lineIds: [r.id], message: `Loop ${loop.id}: the rehook (${r.id}) is followed by ${ls.length - 1 - ls.indexOf(r)} more lines. A rehook should end the loop.` });
    }
    const fives = ls.filter((l) => l.energy === 5);
    if (fives.length > 1) f.push({ level: "warning", code: "energy-5", loopId: loop.id, lineIds: fives.map((l) => l.id), message: `Loop ${loop.id} has ${fives.length} energy-5 lines (${fives.map((l) => l.id).join(", ")}). Keep 5 for the one reveal, so it lands.` });

    // --- head fake plants: shown before, by an earlier line
    for (const fake of fakes) {
      if (!fake.payoffs.length) f.push({ level: "error", code: "headfake-no-plant", loopId: loop.id, lineIds: [fake.id], message: `${fake.id} is a head fake that pays off no plant. List the plant ids it pays off; a twist with no plant is rejected.` });
      for (const pid of fake.payoffs) {
        const shown = lines.find((l) => l.plants.includes(pid));
        if (!shown) f.push({ level: "error", code: "plant-not-shown", loopId: loop.id, lineIds: [fake.id], message: `${fake.id} pays off ${pid}, but no line shows ${pid}.` });
        else if (shown.index >= fake.index) f.push({ level: "error", code: "plant-late", loopId: loop.id, lineIds: [shown.id, fake.id], message: `${fake.id} pays off ${pid}, but ${pid} is only shown at ${shown.id}, ${shown.index === fake.index ? "in the same line" : "after it"}. The plant has to come first.` });
      }
    }
    if (fakes.length) {
      const firstFake = fakes[0]!;
      for (const pid of loop.headFake.plantIds) {
        const shown = lines.find((l) => l.plants.includes(pid));
        if (!shown) f.push({ level: "error", code: "plant-not-shown", loopId: loop.id, lineIds: [firstFake.id], message: `Loop ${loop.id}'s head fake needs ${pid} (loop map), but no line shows it. Show it before ${firstFake.id}.` });
        else if (shown.index > firstFake.index) f.push({ level: "error", code: "plant-late", loopId: loop.id, lineIds: [shown.id, firstFake.id], message: `Loop ${loop.id}'s head fake (${firstFake.id}) needs ${pid}, which is only shown at ${shown.id}.` });
      }
    }

    // --- question lines that are yes/no
    for (const q of has("question")) {
      if (q.text.trim().endsWith("?") && isYesNo(q.text)) f.push({ level: "warning", code: "yes-no", loopId: loop.id, lineIds: [q.id], message: `${q.id} asks a yes/no question ("${q.text}"). Ask who, what, why or how.` });
    }
  }

  // --- the ending twist: its plants pay off in the last loop and nowhere before
  const masterPlants = new Set(map.master.headFake.plantIds);
  const finalLoop = last ? (byLoop.get(last) ?? []) : [];
  for (const l of lines) {
    if (l.loopId === last) continue;
    const early = l.payoffs.filter((pid) => masterPlants.has(pid));
    if (early.length) f.push({ level: "error", code: "master-plant-early", loopId: l.loopId, lineIds: [l.id], message: `${l.id} pays off ${early.join(", ")}, which the ending twist needs, so the ending is given away in ${l.loopId}. Pay off a loop plant here instead, or move the reveal to ${last}.` });
  }
  if (finalLoop.length && !finalLoop.some((l) => l.payoffs.some((pid) => masterPlants.has(pid)))) {
    f.push({ level: "error", code: "master-not-last", loopId: last, lineIds: [finalLoop.at(-1)!.id], message: `Nothing in the last loop (${last}) pays off the ending twist's plants (${[...masterPlants].join(", ")}). The ending twist has to land there.` });
  }

  // --- master stakes early
  const firstStakes = lines.find((l) => l.beats.includes("stakes"));
  if (firstStakes && firstStakes.start > stakesBy) f.push({ level: "error", code: "stakes-late", loopId: firstStakes.loopId, lineIds: [firstStakes.id], message: `The stakes first land at ${firstStakes.id}, ${fmt(firstStakes.start)} in. They must land in the first ${stakesBy} s.` });

  // --- open-question gaps
  const gaps = openQuestionGaps(lines);
  for (const g of gaps.filter((g) => g.end - g.start > maxGap)) {
    const where = g.loopIds.length ? `Loop ${g.loopIds.join("/")}` : "Opening";
    f.push({ level: "error", code: "gap", loopId: g.loopIds[0], lineIds: g.lineIds, at: g.start, message: `${where} · ${span(g.lineIds)}: ${fmt(g.end - g.start)} with no open question (${fmt(g.start)}–${fmt(g.end)}). Move the rehook up or open a question sooner.` });
  }

  // --- stale stretches: a question is open but nothing has turned for a long time
  let lastBeat = 0;
  let staleFrom: TimedLine | undefined;
  for (const l of lines) {
    const moves = l.beats.some((b) => b !== "plant");
    if (moves) {
      if (staleFrom && l.start - lastBeat > maxStale) {
        const ids = lines.slice(staleFrom.index, l.index).map((x) => x.id);
        f.push({ level: "warning", code: "no-turn", loopId: staleFrom.loopId, lineIds: ids, at: lastBeat, message: `${span(ids)}: ${fmt(l.start - lastBeat)} without a turn, question or reveal. Add a micro turn ("but then…").` });
      }
      lastBeat = l.end;
      staleFrom = undefined;
    } else staleFrom ??= l;
  }

  // --- word budgets
  const loops: LoopStats[] = map.loops.map((m) => {
    const ls = byLoop.get(m.id) ?? [];
    const words = ls.reduce((s, l) => s + l.words, 0);
    return { loopId: m.id, title: m.title, words, budget: m.wordBudget, seconds: ls.length ? ls[ls.length - 1]!.end - ls[0]!.start : 0, start: ls[0]?.start ?? 0, end: ls[ls.length - 1]?.end ?? 0 };
  });
  for (const s of loops) {
    if (!s.words) continue;
    if (s.words > s.budget * 1.1) f.push({ level: "error", code: "budget-over", loopId: s.loopId, lineIds: (byLoop.get(s.loopId) ?? []).map((l) => l.id), message: `Loop ${s.loopId} is ${s.words} words; its budget is ${s.budget} (+${Math.round((s.words / s.budget - 1) * 100)}%). Cut at least ${Math.ceil(s.words - s.budget * 1.1)} word${Math.ceil(s.words - s.budget * 1.1) === 1 ? "" : "s"}.` });
    else if (s.words < s.budget * 0.8) f.push({ level: "warning", code: "budget-under", loopId: s.loopId, lineIds: [], message: `Loop ${s.loopId} is ${s.words} words; its budget is ${s.budget}. It may feel rushed.` });
  }
  const words = lines.reduce((s, l) => s + l.words, 0);
  if (words > budget * 1.05) f.push({ level: "error", code: "budget-total", lineIds: [], message: `The script is ${words} words; the budget is ${budget} (+${Math.round((words / budget - 1) * 100)}%, about ${fmt(secondsFor(words - budget, wpm))} too long).` });
  else if (words < budget * 0.9) f.push({ level: "warning", code: "budget-total-under", lineIds: [], message: `The script is ${words} words; the budget is ${budget} (about ${fmt(secondsFor(budget - words, wpm))} short).` });

  // --- the voice step
  for (const l of lines) {
    const digits = l.text.match(/\d[\d,.:]*/g);
    if (digits) f.push({ level: "error", code: "digits", loopId: l.loopId, lineIds: [l.id], message: `${l.id} has digits (${digits.map((d) => `"${d}"`).join(", ")}). Write numbers as words, the way the narrator says them; the voice step's alignment reads letters only.` });
    const sym = l.text.match(SYMBOLS);
    if (sym) f.push({ level: "error", code: "symbol", loopId: l.loopId, lineIds: [l.id], message: `${l.id} has the symbol "${sym[0]}". Write it as words.` });
    if (l.words > 24) f.push({ level: "warning", code: "long-line", loopId: l.loopId, lineIds: [l.id], message: `${l.id} is ${l.words} words. Split it: one breath is 4–18 words.` });
  }

  // --- plants shown but never paid off
  const paid = new Set(lines.flatMap((l) => l.payoffs));
  for (const l of lines) for (const pid of l.plants) if (!paid.has(pid)) f.push({ level: "warning", code: "plant-unpaid", loopId: l.loopId, lineIds: [l.id], message: `${l.id} shows ${pid}, but no head fake pays it off.` });

  const seen = new Set<string>();
  const findings = f.filter((x) => {
    const key = `${x.code}|${x.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const errors = findings.filter((x) => x.level === "error").length;
  return { ok: errors === 0, errors, warnings: findings.length - errors, findings, lines, loops, gaps, words, budget, seconds: lines.length ? lines[lines.length - 1]!.end : 0, wpm };
}

export { allLines };
