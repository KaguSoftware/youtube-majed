/**
 * Checks one custom shot before it may be used (docs/PLAN.md section 6): the
 * import rule, the typecheck, then the shot drawn ALONE, in a browser of its
 * own, in the 16:9 and the 9:16 frame, at frames spread over its scene and at
 * the words it reacts to. Blank or near-blank frames fail it like a crash does.
 *
 *   tsx scripts/check-shot.ts <project> --scene S12 (--source shot.tsx | --shot C1)
 *       --stills-root <dir> --stills-sub <rel dir> [--cues L3.4:2,L3.5:0]
 *
 * stdout carries one JSON line: {"event":"result", "check": ShotCheck-shaped}.
 * It writes nothing but the stills. The caller decides what a failure means
 * (the library scene is used) and records it (recordCheck in @studio/project).
 * The caller also holds the time limit: it kills this process, and Chrome with
 * it, if the shot hangs.
 */
import { customPaths, lintShot, projectPaths, readShots, readSource, renderCodeHash, sourceHash, stageSources, storyboardPaths, STAGE_DIR } from "@studio/project";
import { validateProject, type FailureKind, type ShotCheck } from "@studio/schema";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shotPropsFor } from "../src/custom/host";
import { wordFrame } from "../src/custom/types";
import { shotInputsHash } from "../src/scene/segments";
import { buildTimeline } from "../src/scene/timeline";
import { REMOTION_DIR } from "./load";

const args = process.argv.slice(2);
const arg = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const id = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const say = (m: string) => process.stderr.write(m + "\n");

/** A frame is flat when its brightness barely varies: a solid colour, a black frame, an empty stage. */
const FLAT_STDDEV = 3;

function fail(kind: FailureKind, message: string, extra: Partial<ShotCheck> = {}): never {
  const check: ShotCheck = { at: new Date().toISOString(), codeHash: "", inputs: "", ok: false, failure: { kind, message }, imports: [], stills: { landscape: [], portrait: [] }, renderMs: 0, warnings: [], ...base, ...extra };
  process.stdout.write(JSON.stringify({ event: "result", check }) + "\n");
  process.exit(0);
}
const base: Partial<ShotCheck> = {};

if (!id) {
  say("usage: tsx scripts/check-shot.ts <project> --scene S12 (--source shot.tsx | --shot C1) --stills-root <dir> --stills-sub <dir> [--cues L3.4:2]");
  process.exit(2);
}
const projectId = id;
const p = projectPaths(projectId);
const sb = storyboardPaths(projectId);
const read = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined);
const valid = validateProject({ scenes: read(sb.scenes), script: read(p.scriptJson), voice: read(p.voiceJson) });
if (!valid.ok) fail("other", `the project is not valid: ${valid.errors.slice(0, 3).join("; ")}`);
const project = valid.ok ? valid.data : (undefined as never);

const shotArg = arg("shot");
const manifestShot = shotArg ? readShots(projectId).shots.find((s) => s.id === shotArg) : undefined;
if (shotArg && !manifestShot) fail("other", `there is no custom shot ${shotArg}`);
const sceneId = arg("scene") ?? manifestShot?.sceneId;
const index = project.scenes.scenes.findIndex((s) => s.id === sceneId);
if (index < 0) fail("other", `scene ${sceneId} does not exist`);
const sourceFile = arg("source");
const source = sourceFile ? readFileSync(sourceFile, "utf8") : manifestShot ? readSource(projectId, manifestShot.source) : undefined;
if (source === undefined) fail("other", "give --source <file> or --shot <id>");
const hash = sourceHash(source!);
const timeline = buildTimeline(project);
const props = shotPropsFor(project, timeline, index);
base.codeHash = renderCodeHash();
base.inputs = shotInputsHash(project, timeline, index);

// ---- 1. the import rule
const lint = lintShot(source!);
base.imports = lint.imports;
base.warnings = lint.warnings;
if (!lint.ok) fail("import_rule", lint.errors.join("; "));

// ---- 2. the typecheck
stageSources([{ hash, source: source! }]);
const staged = join(STAGE_DIR, `${hash}.tsx`);
const work = mkdtempSync(join(tmpdir(), "shot-check-"));
writeFileSync(join(work, "tsconfig.json"), JSON.stringify({ extends: join(REMOTION_DIR, "tsconfig.json"), compilerOptions: { noEmit: true, incremental: false, typeRoots: [join(REMOTION_DIR, "node_modules/@types")] }, include: [], files: [staged] }));
const tsc = spawnSync(join(REMOTION_DIR, "node_modules/.bin/tsc"), ["-p", join(work, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8", cwd: REMOTION_DIR });
const diagnostics = (tsc.stdout + tsc.stderr).split("\n").filter((l) => /error TS\d+/.test(l));
const mine = diagnostics.filter((l) => l.includes(`${hash}.tsx`)).map((l) => l.replace(/^.*?\.staged\/[0-9a-f]+\.tsx/, "shot.tsx"));
const other = diagnostics.length - mine.length;
rmSync(work, { recursive: true, force: true });
if (mine.length) fail("typecheck", mine.slice(0, 6).join("\n"));
if (other) base.warnings = [...(base.warnings ?? []), `${other} type error${other === 1 ? "" : "s"} in library files (not this shot's)`];

// ---- 3. draw it alone, in both frames
const t0 = Date.now();
const rel = arg("stills-sub") ?? `${shotArg ?? "candidate"}/${hash}`;
const root = arg("stills-root") ?? customPaths(projectId).stillsDir;
const outDir = join(root, rel);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const cues = (arg("cues")?.split(",").filter(Boolean) ?? manifestShot?.timing.map((t) => t.at) ?? []).flatMap((c) => {
  const f = wordFrame(props, c);
  return f === undefined ? [] : [f];
});
const last = props.frames - 1;
const frames = [...new Set([0, Math.round(last * 0.25), Math.round(last * 0.5), Math.round(last * 0.75), last, ...cues.flatMap((c) => [Math.min(last, c + 4), Math.min(last, c + 14)])])].sort((a, b) => a - b).slice(0, 10);

// The bundle copies its public folder: give it only the fonts (remotion/public also holds every project's audio, ~300 MB),
// and delete the bundle when done (Remotion leaves it in the system temp folder).
const publicDir = mkdtempSync(join(tmpdir(), "shot-public-"));
cpSync(join(REMOTION_DIR, "public", "fonts"), join(publicDir, "fonts"), { recursive: true });
let serveUrl = "";
const cleanup = () => {
  rmSync(publicDir, { recursive: true, force: true });
  if (serveUrl) rmSync(serveUrl, { recursive: true, force: true });
};
process.on("exit", cleanup);
try {
  serveUrl = await bundle({ entryPoint: join(REMOTION_DIR, "scripts/shot-entry.tsx"), publicDir });
} catch (e) {
  fail("crash", `the shot does not bundle: ${(e as Error).message.split("\n").slice(0, 4).join(" ")}`);
}
const browser = await openBrowser("chrome", { chromiumOptions: {}, forceDeviceScaleFactor: 0.5 });
const stills: ShotCheck["stills"] = { landscape: [], portrait: [] };
const flat: Record<string, number> = { landscape: 0, portrait: 0 };
let identical = true;
const pictures = new Map<string, string>();
try {
  for (const frame of ["landscape", "portrait"] as const) {
    const id = frame === "landscape" ? "ShotLandscape" : "ShotPortrait";
    const inputProps = { hash, shot: props };
    const composition = await selectComposition({ serveUrl, id, inputProps, puppeteerInstance: browser });
    for (const f of frames) {
      const name = `${frame}-${String(f).padStart(4, "0")}.jpg`;
      const output = join(outDir, name);
      try {
        await renderStill({ composition, serveUrl, frame: f, output, inputProps, imageFormat: "jpeg", jpegQuality: 85, scale: 0.5, puppeteerInstance: browser, timeoutInMilliseconds: 30_000 });
      } catch (e) {
        const msg = (e as Error).message.split("\n").filter((l) => l.trim()).slice(0, 5).join(" | ");
        fail("crash", `the ${frame} frame fails at frame ${f}: ${msg}`, { stills, renderMs: Date.now() - t0 });
      }
      stills[frame].push(`${rel}/${name}`);
      const g = spawnSync("ffmpeg", ["-v", "error", "-i", output, "-vf", "scale=96:54:flags=area", "-pix_fmt", "gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 20 });
      const px = g.stdout;
      if (px.length) {
        const mean = px.reduce((s, v) => s + v, 0) / px.length;
        const sd = Math.sqrt(px.reduce((s, v) => s + (v - mean) ** 2, 0) / px.length);
        if (sd < FLAT_STDDEV) flat[frame]!++;
        const key = Buffer.from(px).toString("base64");
        const was = pictures.get(frame);
        if (was !== undefined && was !== key) identical = false;
        pictures.set(frame, was === undefined ? key : was);
      }
    }
  }
} finally {
  await browser.close({ silent: true });
}
const renderMs = Date.now() - t0;
const warnings = [...(base.warnings ?? [])];
for (const frame of ["landscape", "portrait"] as const) {
  if (flat[frame]! * 2 >= frames.length) fail("blank", `${flat[frame]} of ${frames.length} ${frame} frames are blank or near-blank (one flat colour)`, { stills, renderMs });
}
if (identical) warnings.push("every sampled frame is the same picture: nothing moves");
const check: ShotCheck = { at: new Date().toISOString(), codeHash: base.codeHash!, inputs: base.inputs!, ok: true, imports: lint.imports, stills, renderMs, warnings };
process.stdout.write(JSON.stringify({ event: "result", check }) + "\n");
process.exit(0);
