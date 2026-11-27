#!/usr/bin/env node
/**
 * A stand-in for `claude -p` (port of legacy/pipeline/fake_claude.py). No
 * network, no account. Reads the prompt on stdin, works out the step from
 * its first line ("/write-story step: narration", "/fact-check", "/critic"),
 * builds an output from the step's actual input, and prints what the real CLI
 * prints with `--output-format json --json-schema`: a result with
 * `structured_output`.
 *
 * FAKE_CLAUDE_MODE picks the behaviour:
 *   ok            well-formed output (default)
 *   limit         the usage-limit error a subscription returns
 *   garbage       not JSON at all
 *   invalid-once  output that fails zod, then a good one when the prompt carries the validator's errors
 *   invalid       output that always fails zod
 *   slow          ok, after FAKE_CLAUDE_DELAY seconds
 *   crash         exits 1 with a stack trace on stderr
 *   leak-once     a loop map whose first loop pays off the ending's plant, then a good one on the retry
 *   break-once    a rewrite that turns its first line into a head fake with no plant, then a good one
 *   break         that broken rewrite every time
 *   messy         storyboard drafts with a misspelt id ("sneek"), an id with no match ("teleport"),
 *                 a skipped line, a held prop with no hand and repeated cameras (repair runs answer cleanly)
 * FAKE_CLAUDE_FAIL_STEP=<step> makes only that step answer with the usage-limit error.
 * FAKE_CLAUDE_LOG=<file> appends {argv, cwd, env keys, step, input} per call, for tests.
 */
import { appendFileSync, readFileSync } from "node:fs";

const prompt = readFileSync(0, "utf8");
const argv = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? "ok";
const first = prompt.split("\n", 1)[0].trim();
const step = /^\/(write-story|plan-scenes|edit-scenes) step:/.test(first) ? first.replace(/^\/[a-z-]+ step:\s*/, "") : first.slice(1);
const inputText = prompt.slice(prompt.indexOf("Input:\n") + 7).split("\n\nYour previous answer")[0];
const input = JSON.parse(inputText);
const isRetry = prompt.includes("Your previous answer to this step was rejected");

if (process.env.FAKE_CLAUDE_LOG) {
  const envKeys = Object.keys(process.env).filter((k) => /^(ANTHROPIC|CLAUDE)/.test(k));
  appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ step, argv, cwd: process.cwd(), envKeys, isRetry, input }) + "\n");
}

function result(structured, extra = {}) {
  return {
    type: "result", subtype: "success", is_error: false, num_turns: 2, duration_ms: 1200, duration_api_ms: 1100,
    result: JSON.stringify(structured), structured_output: structured, total_cost_usd: 0, session_id: "fake",
    usage: { input_tokens: 10, output_tokens: 500, cache_read_input_tokens: 4000, cache_creation_input_tokens: 2000, server_tool_use: { web_search_requests: step === "fact-check" && input.brief?.factual ? 3 : 0 } },
    modelUsage: { fake: { inputTokens: 10, outputTokens: 500, cacheReadInputTokens: 4000, cacheCreationInputTokens: 2000, webSearchRequests: step === "fact-check" && input.brief?.factual ? 3 : 0, costUSD: 0 } },
    ...extra,
  };
}

// --- step outputs, built from the input so the story hangs together

const WORDS = "the keeper climbs the stairs with a lamp and counts the oil drop by drop while the storm hits the glass and the ship blinks out at sea".split(" ");
function sentence(n, seed) {
  const w = Array.from({ length: n }, (_, i) => WORDS[(seed * 7 + i * 3) % WORDS.length]);
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return w.join(" ") + ".";
}

function options() {
  const opt = (id, i) => ({
    id, title: `The ${["Lighthouse", "Island", "Storm"][i]} That Ran Dry`, logline: `A keeper's oil vanishes every night (${id}).`,
    stakes: { type: ["at_risk", "urgent", "character"][i], text: "The lamp has two hours of oil left." },
    question: "Who has been stealing the oil?", endingTwist: { expected: "the new assistant", actual: "the keeper himself, sleepwalking" },
    hook: "The lamp has two hours of oil left.", whyItWorks: "A clear clock and a suspect we can see.",
  });
  return { options: ["A", "B", "C"].map(opt) };
}

function loopmap() {
  const { brief } = input;
  const n = brief.format === "reel" ? 3 : 6;
  const each = Math.floor(brief.wordBudget / n);
  const loops = Array.from({ length: n }, (_, i) => ({
    id: `L${i + 1}`, level: brief.format === "reel" ? "micro" : "chapter", title: `Loop ${i + 1}`,
    stakes: { type: "at_risk", text: `The oil runs lower, stage ${i + 1}.` }, question: `Where does the oil go in part ${i + 1}?`,
    headFake: { expected: "the assistant took it", actual: "it was the keeper", plantIds: [`P${i + 1}`] },
    rehook: "And then he finds footprints that aren't his.", wordBudget: i === n - 1 ? brief.wordBudget - each * (n - 1) : each,
  }));
  const plants = loops.map((l, i) => ({ id: `P${i + 1}`, loopId: l.id, detail: "Muddy boots by the bed.", paysOffIn: l.id }));
  if (mode === "leak-once" && !isRetry) loops[0].headFake.plantIds = [`P${n}`];
  return { master: { stakes: loops[0].stakes, question: "Who is stealing the oil?", headFake: { expected: "the assistant", actual: "the keeper", plantIds: [`P${n}`] } }, loops, plants };
}

function narration() {
  const loops = input.loopmap.loops.map((loop, li) => {
    const count = Math.max(4, Math.round(loop.wordBudget / 10));
    const lines = Array.from({ length: count }, (_, j) => {
      const beats = [];
      const plants = [];
      const payoffs = [];
      if (j === 0) beats.push("stakes");
      if (j === 1) beats.push("question");
      if (j === 2) { beats.push("plant"); plants.push(`P${li + 1}`); }
      if (j > 2 && j < count - 2 && j % 4 === 0) beats.push("turn");
      if (j === count - 2) { beats.push("headfake"); payoffs.push(`P${li + 1}`); }
      if (j === count - 1) beats.push("rehook");
      return { id: `${loop.id}.${j + 1}`, text: sentence(10, li * 31 + j), energy: j === count - 2 ? 5 : j === count - 3 ? 2 : 3, delivery: j === count - 2 ? "reveal, slow" : "storyteller", beats, plants, payoffs };
    });
    return { id: loop.id, lines };
  });
  return { loops };
}

function rewrite() {
  const byId = new Map(input.narration.loops.flatMap((l) => l.lines).map((l) => [l.id, l]));
  const broken = mode === "break" || (mode === "break-once" && !isRetry);
  const out = {
    lines: input.lineIds.map((id) => {
      const l = byId.get(id);
      return { id, text: `${l.text.replace(/\.$/, "")}, rewritten.`, energy: l.energy, delivery: l.delivery, beats: l.beats, plants: l.plants, payoffs: l.payoffs };
    }),
    note: `Rewrote ${input.lineIds.length} line(s): ${input.direction}`.slice(0, 200),
  };
  if (broken) Object.assign(out.lines[0], { beats: ["headfake"], payoffs: [] });
  return out;
}

function unlockedLines() {
  return input.narration.loops.flatMap((l) => l.lines).filter((l) => !l.locked);
}

function factcheck() {
  const lines = unlockedLines();
  const a = lines[0];
  const b = lines[1] ?? lines[0];
  if (input.brief.factual) {
    return {
      mode: "facts",
      claims: [
        { id: "C1", lineIds: [a.id], claim: "The lamp burned whale oil.", verdict: "confirmed", correction: "", proposal: [], sources: [{ url: "https://example.org/lamps", title: "Lighthouse lamps" }], note: "" },
        { id: "C2", lineIds: [b.id], claim: "The lighthouse was built in eighteen ninety.", verdict: "wrong", correction: "It was built in eighteen seventy-two.", proposal: [{ id: b.id, text: "The lighthouse went up in eighteen seventy-two." }], sources: [{ url: "https://example.org/history", title: "History of the light" }], note: "" },
        { id: "C3", lineIds: [a.id], claim: "The keeper served forty years.", verdict: "unverifiable", correction: "", proposal: [], sources: [], note: "No record found." },
      ],
      issues: [],
      summary: "Three claims: one confirmed, one wrong, one unverifiable.",
    };
  }
  return {
    mode: "consistency", claims: [],
    issues: [{ id: "K1", lineIds: [a.id, b.id], kind: "timeline", severity: "major", issue: `${a.id} says midnight; ${b.id} says dawn.`, proposal: [{ id: b.id, text: "Still midnight. The stairs creak." }] }],
    summary: "One timeline slip.",
  };
}

function critic() {
  const lines = unlockedLines();
  const pick = (k) => lines[Math.min(lines.length - 1, k * 3)];
  return {
    loops: input.narration.loops.map((l, i) => ({ loopId: l.id, stakes: 3, question: i === 1 ? 2 : 4, surprise: 3, rehook: 4, note: "The question repeats the last loop's." })),
    weakest: [0, 1, 2].map((k) => ({ lineIds: [pick(k).id], problem: "The viewer is ahead of the story here.", proposal: [{ id: pick(k).id, text: `Sharper line number ${k + 1}, with a hook.` }], why: "It withholds the answer one beat longer." })),
    verdict: "Strong opening, saggy middle. Fix loop two's question first.",
  };
}

function cast() {
  const bgs = Object.keys(input.library.backgrounds);
  const grades = Object.keys(input.library.grades);
  const hats = Object.keys(input.library.hats);
  return {
    cast: [
      { id: "hero", name: "Tom", role: "the keeper", look: JSON.stringify({ color: "#d0473d", hat: hats[1] ?? hats[0] }) },
      { id: "rival", name: "Sam", role: "the assistant", look: JSON.stringify({ color: "#2f9e8f", hat: "beenie", sparkles: true }) },
    ],
    loops: input.loops.map((l, i) => ({ loopId: l.id, locations: [bgs[i % bgs.length]], grade: grades[i % grades.length], music: i % 2 ? "tense" : "mystry", intent: "Show the oil going down." })),
    plants: input.plants.map((p) => ({ plantId: p.id, show: "the oil can in frame", props: ["oil_can"] })),
    style: "Cold nights in the tower.",
  };
}

function storyboard() {
  const lib = input.library;
  const actions = Object.keys(lib.actions).filter((a) => !/^(walk|run|sneak|sleepwalk)$/.test(a));
  const exprs = Object.keys(lib.expressions);
  const cams = Object.keys(lib.cameras);
  const tags = Object.keys(input.sfx ?? {});
  const messy = mode === "messy" && !input.regenerate;
  const wanted = input.regenerate ? new Set(input.regenerate.flatMap((g) => g.lineIds)) : null;
  const lines = input.batch.loops.flatMap((l) => l.lines).filter((l) => !wanted || wanted.has(l.id));
  const look = (lineId) => input.plan.loops.find((x) => x.loopId === lineId.split(".")[0]) ?? input.plan.loops[0];
  const hero = input.plan.cast[0].id;
  let n = 0;
  const scenes = lines.map((l) => {
    const k = n++ + (input.regenerate ? 7 : 0);
    const lk = look(l.id);
    return {
      lineIds: [l.id],
      bg: lk?.locations[0] ?? Object.keys(lib.backgrounds)[0],
      grade: lk?.grade ?? Object.keys(lib.grades)[0],
      chars: [{ id: hero, action: actions[k % actions.length], expr: exprs[k % exprs.length], pos: "center", to: "", facing: "auto", look: "normal" }],
      props: [],
      camera: messy ? cams[1] : cams[k % cams.length],
      transitionIn: "cut",
      caption: "word_pop",
      sfx: k === 0 && tags.length ? [{ tag: tags[0], at: `${l.id}:0` }] : [],
      why: "story",
    };
  });
  if (messy && scenes.length > 4) {
    scenes[0].chars[0].action = "sneek";
    scenes[1].chars[0].action = "teleport";
    scenes[2].props = [{ id: "lantern", attach: "", pos: "left" }];
    scenes.splice(3, 1); // a skipped line
  }
  const reveals = lines.filter((l) => l.beats.includes("headfake")).map((l) => ({ lineId: l.id, at: `${l.id}:1`, kind: "hit" }));
  return { scenes, reveals };
}


// --- edit-scenes: built from the scene(s) in the input, with another action and camera per option
function draftOf(scene, k) {
  const lib = input.library;
  const actions = Object.keys(lib.actions).filter((a) => !/^(walk|run|sneak|sleepwalk|drive|sit|lie|sit_think)$/.test(a) && !lib.actions[a].includes("needs"));
  const cams = Object.keys(lib.cameras);
  const hero = scene?.chars?.[0]?.id ?? Object.keys(input.cast)[0];
  return {
    lineIds: scene.lineIds,
    bg: scene.bg ?? Object.keys(lib.backgrounds)[0],
    grade: scene.grade ?? Object.keys(lib.grades)[0],
    chars: [{ id: hero, action: actions[(k * 5 + 3) % actions.length], expr: "shock", pos: "center", to: "", facing: "auto", look: "normal" }],
    props: [],
    camera: cams[(k + 2) % cams.length],
    transitionIn: "cut",
    caption: "word_pop",
    sfx: [],
    why: `option ${k + 1}: ${input.note ?? input.beat ?? "fix"}`,
  };
}
function regenerate() {
  return { options: Array.from({ length: input.count ?? 3 }, (_, k) => draftOf(input.scene, k)) };
}
function beat() {
  const add = !/no line/.test(input.beat);
  const first = add ? [input.newLineId] : [input.canCover[0]];
  const scenes = [draftOf({ ...input.around.before?.[0], lineIds: first }, 0)];
  if (add && input.canCover.length) scenes.push(draftOf({ ...input.around.after?.[0], lineIds: [input.canCover[0]] }, 1));
  return { line: { add, text: add ? "A dog barks at him and he jumps." : "", energy: 4, delivery: "punchy" }, scenes, why: "a reaction beat" };
}
function fixscenes() {
  return { scenes: input.fix.map((f, k) => ({ sceneId: f.sceneId, scene: draftOf(f.scene, k) })) };
}

// --- reel-cut: the loop with the best critic scores, from its first line on, until about 66 s are kept
function reelCut() {
  const score = (l) => (l.critic ? l.critic.stakes + l.critic.question + l.critic.surprise + l.critic.rehook : 0);
  const best = input.loops.reduce((b, l) => (score(l) > score(b) ? l : b), input.loops[0]);
  const ids = input.lines.map((l) => l.id);
  const span = new Map(input.lines.map((l) => [l.id, l.seconds]));
  let from = ids.findIndex((id) => id.startsWith(best.id + "."));
  let to = from;
  let total = span.get(ids[from]);
  while (total < 66 && (to + 1 < ids.length || from > 0)) {
    if (to + 1 < ids.length) total += span.get(ids[++to]);
    else total += span.get(ids[--from]);
  }
  const kept = ids.slice(from, to + 1);
  const scene = input.scenes.find((s) => s.lineIds.includes(kept[0])) ?? input.scenes[0];
  const hook = process.env.FAKE_CLAUDE_NO_HOOK ? null : { text: "Nobody believed him at first.", energy: 4, delivery: "hushed, slow", showScene: scene.id };
  return { loopId: best.id, why: `Loop ${best.id} has the best critic scores (${score(best)} of 20) and a fair head fake; the cut starts at its first line.`, title: "The part nobody believed", lineIds: kept, hook, ending: null };
}

const builders = { options, loopmap, narration, rewrite, "fact-check": factcheck, critic, cast, storyboard, regenerate, beat, fixscenes, "reel-cut": reelCut };

// --- behaviour

if (mode === "slow") await new Promise((r) => setTimeout(r, Number(process.env.FAKE_CLAUDE_DELAY ?? "30") * 1000));
if (mode === "limit" || process.env.FAKE_CLAUDE_FAIL_STEP === step) {
  console.log(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, api_error_status: 429, result: "Claude usage limit reached. Your limit will reset at 6pm." }));
  process.exit(1);
}
if (mode === "garbage") {
  console.log("I could not write this story.");
  process.exit(0);
}
if (mode === "crash") {
  console.error("TypeError: cannot read properties of undefined\n    at fake (claude.mjs:1:1)");
  process.exit(1);
}
const build = builders[step];
if (!build) {
  console.error(`fake claude: unknown step "${step}"`);
  process.exit(2);
}
let out = build();
if (mode === "invalid" || (mode === "invalid-once" && !isRetry)) out = { ...out, unexpected: true };
console.log(JSON.stringify(result(out)));
