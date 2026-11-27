/**
 * Voices a project through the local audio service (audio/). The work behind
 * both `pnpm voice` (src/voice.ts) and the app's voice step (a queued job).
 *
 * One /line request per script line (a line whose text, energy, seed,
 * reference and model are unchanged comes back from the service's cache at
 * once), then one /master request that builds the narration track and
 * voice.json. A retake is remembered in projects/<id>/audio/overrides.json so
 * a later full run does not undo it.
 */
import { LineId, ScriptFile, formatIssues, type VoiceFile } from "@studio/schema";
import { projectPaths, readVoice, syncAudio } from "@studio/project";
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

export class VoiceError extends Error {
  override name = "VoiceError";
}

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
type Take = z.infer<typeof Take>;

export type VoiceOptions = {
  /** retake this line (new random seed unless `seed` is given) */
  line?: string;
  seed?: number;
  energy?: number;
  /** clone a recording instead of the built-in voice */
  reference?: string;
  url?: string;
  signal?: AbortSignal;
  /** one call per line as it finishes, and one before the first (i = 0) */
  onLine?: (e: { i: number; total: number; line: string; take?: Take }) => void;
  log?: (message: string) => void;
};

export type VoiceSummary = {
  lines: number;
  generated: number;
  reused: number;
  retried: number;
  durationS: number;
  wpm: number;
  lufs: number;
  truePeakDbtp: number;
  seconds: number;
  engine: string;
  device: string;
  /** lines whose take is not ok, to retake by ear */
  flagged: { id: string; status: "warn" | "fail"; heard: string; issues: string[] }[];
  failed: number;
  voice: VoiceFile;
};

export const audioUrl = (o: { url?: string } = {}) => o.url ?? process.env.STUDIO_AUDIO_URL ?? "http://127.0.0.1:8765";

export async function voiceProject(id: string, o: VoiceOptions = {}): Promise<VoiceSummary> {
  const log = o.log ?? (() => {});
  const base = audioUrl(o);
  const paths = projectPaths(id);

  if (!existsSync(paths.scriptJson)) throw new VoiceError(`no script for "${id}": looked for ${paths.scriptJson}`);
  const rawScript: unknown = JSON.parse(readFileSync(paths.scriptJson, "utf8"));
  const parsedScript = ScriptFile.safeParse(rawScript);
  if (!parsedScript.success) throw new VoiceError(`script.json is not valid:\n  - ${formatIssues("script.json", rawScript, parsedScript.error.issues).join("\n  - ")}`);
  const lines = parsedScript.data.lines;

  let overrides: z.infer<typeof Overrides> = {};
  if (existsSync(paths.overrides)) {
    const r = Overrides.safeParse(JSON.parse(readFileSync(paths.overrides, "utf8")));
    if (!r.success) throw new VoiceError(`${paths.overrides} is not valid: ${r.error.message}`);
    overrides = r.data;
  }
  if (o.line) {
    if (!lines.some((l) => l.id === o.line)) throw new VoiceError(`script has no line "${o.line}" (lines: ${lines.map((l) => l.id).join(", ")})`);
    const seed = o.seed ?? randomInt(1, 1_000_000);
    const energy = o.energy ?? overrides[o.line]?.energy;
    if (!Number.isInteger(seed)) throw new VoiceError(`seed must be a whole number`);
    if (energy !== undefined && !(Number.isInteger(energy) && energy >= 1 && energy <= 5)) throw new VoiceError(`energy must be 1–5`);
    overrides[o.line] = { seed, ...(energy === undefined ? {} : { energy }) };
    mkdirSync(paths.audioDir, { recursive: true });
    writeFileSync(paths.overrides, JSON.stringify(overrides, null, 2) + "\n");
    log(`retaking ${o.line}: seed ${seed}${energy === undefined ? "" : `, energy ${energy}`}`);
  } else if (o.seed !== undefined || o.energy !== undefined) {
    throw new VoiceError("seed and energy only apply together with a line");
  }

  async function call<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const signals = [AbortSignal.timeout(15 * 60_000), ...(o.signal ? [o.signal] : [])];
    const res = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any(signals),
    });
    if (!res.ok) throw new VoiceError(`audio service ${path} answered ${res.status}: ${(await res.text()).slice(0, 600)}`);
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) throw new VoiceError(`audio service ${path} sent something unexpected: ${parsed.error.message}`);
    return parsed.data;
  }

  const health = await call("/health", z.object({ engine: z.string(), device: z.string(), busy: z.boolean() })).catch((e) => {
    if (o.signal?.aborted) throw e;
    throw new VoiceError(`the audio service is not running at ${base}. Start it in another terminal:\n    cd audio && uv run python -m studio_audio.server`);
  });
  log(`voicing ${id}: ${lines.length} lines · ${health.engine} on ${health.device}`);

  const keys: { id: string; key: string }[] = [];
  const flagged: VoiceSummary["flagged"] = [];
  let generated = 0;
  let retried = 0;
  const started = Date.now();
  o.onLine?.({ i: 0, total: lines.length, line: lines[0]!.id });
  for (const [i, line] of lines.entries()) {
    const ov = overrides[line.id];
    const take = await call("/line", Take, {
      outDir: paths.audioDir,
      id: line.id,
      text: line.text,
      energy: ov?.energy ?? line.energy,
      ...(ov?.seed === undefined ? {} : { seed: ov.seed }),
      ...(o.reference ? { reference: o.reference } : {}),
    });
    keys.push({ id: line.id, key: take.key });
    if (take.state === "generated") generated++;
    if (take.attempts > 1) retried++;
    const note = take.state === "cached" ? "cached" : `${take.computeSeconds?.toFixed(1)}s compute, ${take.attempts} take${take.attempts > 1 ? "s" : ""}`;
    log(`  ${take.quality.status === "ok" ? "✓" : take.quality.status === "warn" ? "!" : "✗"} ${line.id.padEnd(5)} ${take.duration.toFixed(2)}s  ${note}${take.quality.issues.length ? `  · ${take.quality.issues[0]}` : ""}`);
    if (take.quality.status !== "ok") flagged.push({ id: line.id, status: take.quality.status, heard: take.quality.heard, issues: take.quality.issues });
    o.onLine?.({ i: i + 1, total: lines.length, line: line.id, take });
  }

  await call("/master", z.object({ version: z.literal(1) }).passthrough(), { outDir: paths.audioDir, lines: keys, ...(o.reference ? { reference: o.reference } : {}) });

  // voice.json is written by Python; zod is the judge of whether it is right.
  const voice = readVoice(id);
  if (!voice || !voice.ok) throw new VoiceError(`voice.json written by the service is not valid:\n  - ${voice ? voice.errors.join("\n  - ") : "missing"}`);
  syncAudio(id);

  const t = voice.data.track;
  // the speaking rate the story engine budgets with (docs/PLAN.md section 3): words over the whole track, pauses included
  const spoken = lines.reduce((n, l) => n + l.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length, 0);
  return {
    lines: lines.length,
    generated,
    reused: lines.length - generated,
    retried,
    durationS: t.duration,
    wpm: Math.round((spoken / t.duration) * 60),
    lufs: t.loudness.integratedLufs,
    truePeakDbtp: t.loudness.truePeakDbtp,
    seconds: (Date.now() - started) / 1000,
    engine: health.engine,
    device: health.device,
    flagged,
    failed: voice.data.lines.filter((l) => l.quality.status === "fail").length,
    voice: voice.data,
  };
}
