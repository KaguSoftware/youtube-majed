/**
 * Voices a project through the local audio service (audio/).
 *
 *   pnpm voice lighthouse                       # voice every line (cached lines are reused)
 *   pnpm voice lighthouse --line L3.4           # retake one line with a new random seed
 *   pnpm voice lighthouse --line L3.4 --seed 7  # ... with this seed
 *   pnpm voice lighthouse --line L3.4 --energy 5
 *   options: --reference <wav>  --url http://127.0.0.1:8765
 *
 * Every run sends one /line request per script line (a line whose text,
 * energy, seed, reference and model are unchanged comes back from the service's
 * cache at once), then one /master request that builds the narration track and
 * voice.json. A retake is remembered in projects/<id>/audio/overrides.json so a
 * later full run does not undo it.
 */
import { ScriptFile, formatIssues, LineId } from "@studio/schema";
import { syncAudio, projectPaths, readVoice } from "@studio/project";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { z } from "zod";

const Overrides = z.record(LineId, z.strictObject({ seed: z.int().optional(), energy: z.int().min(1).max(5).optional() }));
const Take = z.object({
  id: z.string(),
  key: z.string(),
  state: z.enum(["cached", "generated"]),
  seed: z.int(),
  seedUsed: z.int(),
  attempts: z.int(),
  duration: z.number(),
  computeSeconds: z.number().optional(),
  quality: z.object({ status: z.enum(["ok", "warn", "fail"]), wer: z.number(), issues: z.array(z.string()), heard: z.string() }),
});

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const id = process.argv[2];
if (!id || id.startsWith("--")) fail("usage: pnpm voice <project> [--line L3.4 [--seed N] [--energy N]] [--reference clip.wav]");
const base = flag("url") ?? process.env.STUDIO_AUDIO_URL ?? "http://127.0.0.1:8765";
const paths = projectPaths(id);

// --- script
if (!existsSync(paths.scriptJson)) fail(`no script for "${id}": looked for ${paths.scriptJson}`);
const rawScript: unknown = JSON.parse(readFileSync(paths.scriptJson, "utf8"));
const parsedScript = ScriptFile.safeParse(rawScript);
if (!parsedScript.success) fail(`script.json is not valid:\n  - ${formatIssues("script.json", rawScript, parsedScript.error.issues).join("\n  - ")}`);
const lines = parsedScript.data.lines;

// --- retake overrides
let overrides: z.infer<typeof Overrides> = {};
if (existsSync(paths.overrides)) {
  const r = Overrides.safeParse(JSON.parse(readFileSync(paths.overrides, "utf8")));
  if (!r.success) fail(`${paths.overrides} is not valid: ${r.error.message}`);
  overrides = r.data;
}
const retake = flag("line");
if (retake) {
  if (!lines.some((l) => l.id === retake)) fail(`script has no line "${retake}" (lines: ${lines.map((l) => l.id).join(", ")})`);
  const seed = flag("seed") === undefined ? randomInt(1, 1_000_000) : Number(flag("seed"));
  const energy = flag("energy") === undefined ? overrides[retake]?.energy : Number(flag("energy"));
  if (!Number.isInteger(seed)) fail(`--seed must be a whole number`);
  if (energy !== undefined && !(Number.isInteger(energy) && energy >= 1 && energy <= 5)) fail(`--energy must be 1–5`);
  overrides[retake] = { seed, ...(energy === undefined ? {} : { energy }) };
  mkdirSync(paths.audioDir, { recursive: true });
  writeFileSync(paths.overrides, JSON.stringify(overrides, null, 2) + "\n");
  console.log(`retaking ${retake}: seed ${seed}${energy === undefined ? "" : `, energy ${energy}`}`);
} else if (flag("seed") !== undefined || flag("energy") !== undefined) {
  fail("--seed and --energy only apply together with --line <id>");
}

// --- service
async function call<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15 * 60_000),
  });
  if (!res.ok) fail(`audio service ${path} answered ${res.status}: ${(await res.text()).slice(0, 600)}`);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) fail(`audio service ${path} sent something unexpected: ${parsed.error.message}`);
  return parsed.data;
}

const health = await call("/health", z.object({ engine: z.string(), device: z.string(), busy: z.boolean() })).catch(() =>
  fail(`the audio service is not running at ${base}. Start it in another terminal:\n    cd audio && uv run python -m studio_audio.server`),
);
console.log(`voicing ${id}: ${lines.length} lines · ${health.engine} on ${health.device}`);

const reference = flag("reference");
const keys: { id: string; key: string }[] = [];
const bad: string[] = [];
let generated = 0;
let retried = 0;
const started = Date.now();
for (const line of lines) {
  const o = overrides[line.id];
  const take = await call("/line", Take, {
    outDir: paths.audioDir,
    id: line.id,
    text: line.text,
    energy: o?.energy ?? line.energy,
    ...(o?.seed === undefined ? {} : { seed: o.seed }),
    ...(reference ? { reference } : {}),
  });
  keys.push({ id: line.id, key: take.key });
  if (take.state === "generated") generated++;
  if (take.attempts > 1) retried++;
  const note = take.state === "cached" ? "cached" : `${take.computeSeconds?.toFixed(1)}s compute, ${take.attempts} take${take.attempts > 1 ? "s" : ""}`;
  console.log(`  ${take.quality.status === "ok" ? "✓" : take.quality.status === "warn" ? "!" : "✗"} ${line.id.padEnd(5)} ${take.duration.toFixed(2)}s  ${note}${take.quality.issues.length ? `  · ${take.quality.issues[0]}` : ""}`);
  if (take.quality.status !== "ok") bad.push(`${line.id} [${take.quality.status}] heard "${take.quality.heard}": ${take.quality.issues.join("; ")}`);
}

await call("/master", z.object({ version: z.literal(1) }).passthrough(), { outDir: paths.audioDir, lines: keys, ...(reference ? { reference } : {}) });

// voice.json is written by Python; zod is the judge of whether it is right.
const voice = readVoice(id);
if (!voice || !voice.ok) fail(`voice.json written by the service is not valid:\n  - ${voice ? voice.errors.join("\n  - ") : "missing"}`);
syncAudio(id);

const t = voice.data.track;
console.log(
  `\n✓ ${paths.narration}\n  ${t.duration.toFixed(1)} s · ${t.loudness.integratedLufs} LUFS · ${t.loudness.truePeakDbtp} dBTP · ${generated} line(s) generated, ${lines.length - generated} reused, ${retried} needed an automatic retake · ${((Date.now() - started) / 1000).toFixed(0)} s`,
);
if (bad.length) {
  console.log(`\n${bad.length} line(s) need a look (retake with: pnpm voice ${id} --line <id>):`);
  for (const b of bad) console.log(`  - ${b}`);
}
process.exit(voice.data.lines.some((l) => l.quality.status === "fail") ? 2 : 0);
