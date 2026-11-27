/**
 * What the editor UI (step 8, app/app/p/[id]/editor/) needs on top of the
 * edit engine's routes (src/edit-api.ts). Read-only: every change still goes
 * through POST /projects/:id/edits and friends.
 *
 *   GET /projects/:id/editor                   the live draft (scenes, script, voice as on disk), the timeline, the audio to play
 *   GET /projects/:id/editor/options?scene=S12 the newest regenerate options for a scene (null when there are none)
 *   GET /editor/sfx                            the SFX tags a scene may use, with what they sound like and a file to preview
 *   GET /editor/sfx/audio?asset=<id>           that file (byte ranges)
 *
 * It answers its own requests (server.ts calls `editorRequest` first), because
 * the SFX preview streams a file from assets/, which the JSON routes cannot.
 */
import { ASSETS_DIR, projectPaths, readJson, storyboardPaths } from "@studio/project";
import { SceneOptions } from "@studio/schema";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { readAssets } from "./assets";
import { timelineOf } from "./edit-api";
import { readBrief } from "./story";

const read = (f: string): unknown => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);

/** The project as Remotion reads it, raw (the app validates it with validateProject), plus the timeline and the soundtrack to play under it. */
export function editorState(id: string) {
  const brief = readBrief(id);
  const p = projectPaths(id);
  const timeline = timelineOf(id);
  const mix = join(p.audioDir, "mix.wav");
  const audio = existsSync(mix) ? "audio/mix.wav" : existsSync(p.narration) ? "audio/narration.wav" : null;
  return {
    format: brief.format,
    head: timeline.head,
    project: { scenes: read(storyboardPaths(id).scenes), script: read(p.scriptJson), voice: read(p.voiceJson) },
    // the file changes with every version that changes the sound; the stamp busts the browser's cache
    audio: audio ? { file: audio, stamp: Math.round(statSync(join(p.dir, audio)).mtimeMs) } : null,
    timeline,
  };
}

/** The newest options saved for one scene (projects/<id>/edits/options/<scene>-<stamp>.json). */
export function latestOptions(id: string, scene: string) {
  const dir = join(projectPaths(id).dir, "edits", "options");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith(`${scene}-`) && f.endsWith(".json")).sort();
  for (const f of files.reverse()) {
    const o = readJson(join(dir, f), SceneOptions);
    if (o) return o;
  }
  return null;
}

/** One entry per SFX tag: what it sounds like and the first file that has it, to preview. */
export function sfxCatalogue() {
  const out = new Map<string, { tag: string; description: string; asset: string; duration: number; licence: string }>();
  for (const a of readAssets().filter((x) => x.kind === "sfx")) {
    for (const tag of a.tags) if (!out.has(tag)) out.set(tag, { tag, description: a.description, asset: a.id, duration: a.duration, licence: a.licence });
  }
  return [...out.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

const AUDIO: Record<string, string> = { ".wav": "audio/wav", ".flac": "audio/flac", ".mp3": "audio/mpeg", ".ogg": "audio/ogg" };

function streamAsset(req: IncomingMessage, res: ServerResponse, assetId: string) {
  const asset = readAssets().find((a) => a.id === assetId);
  const root = resolve(ASSETS_DIR);
  const file = asset ? resolve(asset.path) : "";
  if (!asset || !file.startsWith(root + sep) || !existsSync(file)) return json(res, 404, { error: `no asset ${assetId}` });
  const size = statSync(file).size;
  const headers = { "content-type": AUDIO[extname(file)] ?? "application/octet-stream", "accept-ranges": "bytes", "cache-control": "max-age=3600" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      return void res.end();
    }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    return void createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "content-length": size });
  createReadStream(file).pipe(res);
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

/** Answers the editor's requests; false when the request is not one of them. */
export function editorRequest(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "GET") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  let m: RegExpExecArray | null;
  try {
    if ((m = /^\/projects\/([\w-]+)\/editor$/.exec(path))) json(res, 200, editorState(m[1]!));
    else if ((m = /^\/projects\/([\w-]+)\/editor\/options$/.exec(path))) {
      const scene = url.searchParams.get("scene") ?? "";
      if (!/^S\d+$/.test(scene)) json(res, 400, { error: 'scene: expected a scene id like "S12"' });
      else json(res, 200, { options: latestOptions(m[1]!, scene) });
    } else if (path === "/editor/sfx") json(res, 200, { sfx: sfxCatalogue() });
    else if (path === "/editor/sfx/audio") streamAsset(req, res, url.searchParams.get("asset") ?? "");
    else return false;
  } catch (e) {
    const err = e as Error;
    const status = err.name === "ValidationError" ? 422 : err.name === "StoryError" || /no such project|not found|ENOENT/i.test(err.message) ? 404 : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: err.message });
  }
  return true;
}
