/**
 * The low-poly style's 3D sources (docs: remotion/README.md, "Low poly").
 *
 *   pnpm assets3d check                 # validate assets/sources-3d.json and that every listed file is there
 *   pnpm assets3d convert [--force]     # assets/3d/mixamo/fbx/<action>.fbx -> assets/3d/mixamo/glb/<action>.glb, indexed
 *
 * Mixamo files are downloaded by hand (an Adobe login), named after the library action they play
 * (walk.fbx, sit_chair.fbx ...; the list is in remotion/README.md). Conversion runs Blender headless
 * (scripts/blender/fbx_to_glb.py). Each converted clip gets an entry in assets/sources-3d.json with the
 * Mixamo licence and the FBX's sha1. assets/3d/ is gitignored; the index is committed.
 */
import { ACTIONS, Asset3DIndex, MIXAMO_LICENCE, type Asset3D } from "@studio/schema";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { REMOTION_DIR, REPO_DIR } from "./load";

const args = process.argv.slice(2);
const cmd = args[0] ?? "check";
const INDEX = join(REPO_DIR, "assets/sources-3d.json");
const ROOT = join(REPO_DIR, "assets/3d");
const FBX = join(ROOT, "mixamo/fbx");
const GLB = join(ROOT, "mixamo/glb");

const read = (): Asset3DIndex => {
  const r = Asset3DIndex.safeParse(JSON.parse(readFileSync(INDEX, "utf8")));
  if (!r.success) throw new Error(`assets/sources-3d.json: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
};

if (cmd === "check") {
  const idx = read();
  const missing = idx.assets.filter((a) => !existsSync(join(ROOT, a.file)) || (a.glb && !existsSync(join(ROOT, a.glb))));
  console.log(`${idx.assets.length} 3D assets indexed, ${missing.length} missing on this machine${missing.length ? `: ${missing.map((a) => a.id).join(", ")}` : ""}`);
  process.exit(missing.length ? 1 : 0);
}

if (cmd === "convert") {
  const blender = spawnSync("which", ["blender"], { encoding: "utf8" }).stdout.trim() || "/Applications/Blender.app/Contents/MacOS/Blender";
  if (!existsSync(FBX)) throw new Error(`put the Mixamo FBX files in ${FBX} (named after the action: walk.fbx, idle.fbx ...)`);
  mkdirSync(GLB, { recursive: true });
  const idx = read();
  const byId = new Map(idx.assets.map((a) => [a.id, a]));
  for (const f of readdirSync(FBX).filter((n) => n.toLowerCase().endsWith(".fbx")).sort()) {
    const action = basename(f, ".fbx").toLowerCase();
    if (!(action in ACTIONS)) {
      console.log(`· skip ${f}: "${action}" is not a library action`);
      continue;
    }
    const src = join(FBX, f);
    const out = join(GLB, `${action}.glb`);
    if (existsSync(out) && byId.has(`mixamo/${action}`) && !args.includes("--force")) continue;
    const r = spawnSync(blender, ["-b", "--factory-startup", "-P", join(REMOTION_DIR, "scripts/blender/fbx_to_glb.py"), "--", src, out, "--clip-name", action], { encoding: "utf8" });
    const ok = r.stdout.split("\n").find((l) => l.startsWith("ok "));
    if (r.status !== 0 || !ok) throw new Error(`blender failed on ${f}:\n${(r.stderr || r.stdout).slice(-1500)}`);
    const entry: Asset3D = {
      id: `mixamo/${action}`,
      kind: "clip",
      file: `mixamo/fbx/${f}`,
      glb: `mixamo/glb/${action}.glb`,
      action,
      description: `Mixamo clip for "${action}"`,
      licence: { ...MIXAMO_LICENCE },
      source: { name: "Mixamo", url: "https://www.mixamo.com", sha1: createHash("sha1").update(readFileSync(src)).digest("hex") },
    };
    byId.set(entry.id, entry);
    console.log(`✓ ${f} → ${basename(out)}  ${ok.slice(ok.indexOf("armature="))}`);
  }
  const next = { ...idx, assets: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  Asset3DIndex.parse(next);
  writeFileSync(INDEX, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`${next.assets.length} 3D assets in assets/sources-3d.json`);
  process.exit(0);
}

console.error("usage: pnpm assets3d check | convert [--force]");
process.exit(1);
