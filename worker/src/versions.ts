/**
 * Version history (docs/PLAN.md section 8): every committed edit is a
 * version; versions can be listed, compared and rolled back.
 *
 *   projects/<id>/versions/
 *     HEAD                  the version the working files hold, e.g. "7"
 *     0007.json             one manifest per version (Version, packages/schema/src/edit.ts)
 *     objects/<hash>.json   the tracked JSON files, by content hash (a file
 *                           that did not change is stored once)
 *
 * A version holds only small JSON (TRACKED: script, narration, scenes,
 * storyboard report, voice.json, overrides, voice effects, mix plan and
 * result). The heavy media is never copied per version; it lives in caches
 * keyed by content, and a version names what it plays:
 *
 *   audio/lines/<line>.<key>.wav           takes (the audio service's cache)
 *   audio/lines/<line>.<key>.fx-<h>.wav    takes with a voice effect (fx.py)
 *   audio/narration/<sha256>.wav           mastered narration tracks (media.narration)
 *   audio/mix/<key>.wav                    mixes by plan (media.mix)
 *   renders/segments/<profile>/<key>.mp4   render segments (keyed by what they draw)
 *
 * The working files (projects/<id>/script.json, storyboard/scenes.json,
 * audio/voice.json, audio/narration.wav, audio/mix.wav, …) are always one
 * version, materialised: every other step (render, export, the app) reads
 * them as before. Rolling back writes an older version's files back and
 * clones its narration and mix out of the caches: nothing is voiced, mixed or
 * drawn again.
 */
import { projectPaths, storyboardPaths, syncAudio, writeJson } from "@studio/project";
import { TRACKED, Version, VersionDiff, type EditOp, type TrackedFile } from "@studio/schema";
import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export class VersionError extends Error {
  override name = "VersionError";
}

const sha = (data: string | Buffer, n = 16) => createHash("sha256").update(data).digest("hex").slice(0, n);
const fileSha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

export function versionPaths(id: string) {
  const { dir, audioDir } = projectPaths(id);
  const root = join(dir, "versions");
  return { root, head: join(root, "HEAD"), objects: join(root, "objects"), work: join(root, "work"), manifest: (n: number) => join(root, `${String(n).padStart(4, "0")}.json`), narrationStore: join(audioDir, "narration"), mixCache: storyboardPaths(id).mixCache };
}

/** A copy that costs nothing on APFS (copy-on-write clone), a plain copy elsewhere. */
export function cloneFile(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  copyFileSync(src, tmp, constants.COPYFILE_FICLONE);
  renameSync(tmp, dest);
}

// ---------------------------------------------------------------- objects and manifests

function putObject(id: string, text: string): string {
  const p = versionPaths(id);
  const hash = sha(text);
  const file = join(p.objects, `${hash}.json`);
  if (!existsSync(file)) {
    mkdirSync(p.objects, { recursive: true });
    writeFileSync(`${file}.tmp`, text);
    renameSync(`${file}.tmp`, file);
  }
  return hash;
}

export function objectText(id: string, hash: string): string {
  const file = join(versionPaths(id).objects, `${hash}.json`);
  if (!existsSync(file)) throw new VersionError(`version store is missing object ${hash}`);
  return readFileSync(file, "utf8");
}

/** The JSON a version holds for one tracked file, undefined when that version had no such file. */
export function versionFile(id: string, v: Version, file: TrackedFile): unknown {
  const hash = v.files[file];
  return hash ? JSON.parse(objectText(id, hash)) : undefined;
}

export function readHead(id: string): number | undefined {
  const f = versionPaths(id).head;
  return existsSync(f) ? Number(readFileSync(f, "utf8").trim()) : undefined;
}

export function readVersion(id: string, n: number): Version {
  const f = versionPaths(id).manifest(n);
  if (!existsSync(f)) throw new VersionError(`${id} has no version ${n}`);
  return Version.parse(JSON.parse(readFileSync(f, "utf8")));
}

export function listVersions(id: string): Version[] {
  const root = versionPaths(id).root;
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => /^\d{4,}\.json$/.test(f))
    .map((f) => Number(f.slice(0, -5)))
    .sort((a, b) => a - b)
    .map((n) => readVersion(id, n));
}

// ---------------------------------------------------------------- working files

const workingPath = (id: string, f: TrackedFile) => join(projectPaths(id).dir, f);

/** Content hashes of the working tracked files (raw bytes, as stored). */
function workingFiles(id: string): Partial<Record<TrackedFile, string>> {
  const out: Partial<Record<TrackedFile, string>> = {};
  for (const f of TRACKED) {
    const p = workingPath(id, f);
    if (existsSync(p)) out[f] = sha(readFileSync(p));
  }
  return out;
}

function workingMedia(id: string): Version["media"] {
  const p = projectPaths(id);
  const sb = storyboardPaths(id);
  const narration = existsSync(p.narration) ? fileSha256(p.narration) : null;
  let mix: string | null = null;
  const mixJson = join(p.audioDir, "mix.json");
  if (existsSync(sb.mix) && existsSync(mixJson) && existsSync(sb.mixCache)) {
    const want = readFileSync(mixJson, "utf8");
    mix = readdirSync(sb.mixCache).find((f) => /^[0-9a-f]{20}\.json$/.test(f) && readFileSync(join(sb.mixCache, f), "utf8") === want)?.slice(0, -5) ?? null;
  }
  return { narration, mix };
}

const sameFiles = (a: Version["files"], b: Version["files"]) => TRACKED.every((f) => a[f] === b[f]);

/** Writes a version's tracked files and media back as the working files. */
export function materialise(id: string, v: Version): void {
  const p = projectPaths(id);
  const vp = versionPaths(id);
  for (const f of TRACKED) {
    const dest = workingPath(id, f);
    const hash = v.files[f];
    if (!hash) {
      rmSync(dest, { force: true });
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, objectText(id, hash));
    renameSync(tmp, dest);
  }
  if (v.media.narration) {
    const stored = join(vp.narrationStore, `${v.media.narration}.wav`);
    if (!existsSync(stored)) throw new VersionError(`the narration track of version ${v.n} is missing from ${vp.narrationStore}`);
    cloneFile(stored, p.narration);
  }
  if (v.media.mix) {
    const wav = join(vp.mixCache, `${v.media.mix}.wav`);
    if (!existsSync(wav)) throw new VersionError(`the mix of version ${v.n} (${v.media.mix}) is missing from ${vp.mixCache}`);
    cloneFile(wav, storyboardPaths(id).mix);
  }
  syncAudio(id);
}

/** Keeps a narration track in the store by its sha256 (what mix plans and versions name). */
export function storeNarration(id: string, file: string): string {
  const hash = fileSha256(file);
  const dest = join(versionPaths(id).narrationStore, `${hash}.wav`);
  if (!existsSync(dest)) cloneFile(file, dest);
  return hash;
}

// ---------------------------------------------------------------- commit

export type CommitInput = {
  kind: Version["kind"];
  label: string;
  ops?: EditOp[];
  /** the version's tracked files as data (written as projects write JSON), or raw text; undefined = the file does not exist */
  files: Partial<Record<TrackedFile, unknown>>;
  media: Version["media"];
  work?: Record<string, number>;
  restores?: number;
};

const asText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2) + "\n");

/** Stores a new version on top of HEAD, makes it HEAD and writes it as the working files. */
export function commit(id: string, c: CommitInput): Version {
  const vp = versionPaths(id);
  const all = listVersions(id);
  const parent = readHead(id) ?? null;
  const files: Version["files"] = {};
  for (const f of TRACKED) if (c.files[f] !== undefined) files[f] = putObject(id, asText(c.files[f]));
  const n = (all.at(-1)?.n ?? 0) + 1;
  const draft: Version = { version: 1, n, label: c.label, kind: c.kind, parent, ...(c.restores ? { restores: c.restores } : {}), createdAt: new Date().toISOString(), ops: c.ops ?? [], files, media: c.media, changes: null, work: c.work ?? {} };
  const v = Version.parse({ ...draft, changes: parent ? diffVersions(id, readVersion(id, parent), draft) : null });
  writeJson(vp.manifest(n), v);
  writeFileSync(`${vp.head}.tmp`, `${n}\n`);
  renameSync(`${vp.head}.tmp`, vp.head);
  materialise(id, v);
  return v;
}

/**
 * Makes sure the project has a history whose HEAD matches the working files.
 * The first call stores the working files as version 1 ("start"). Files
 * changed outside the editor since (a re-voice, a new storyboard) become a
 * version of their own ("outside"), so no edit is ever applied to something
 * the history does not know.
 */
export function ensureVersions(id: string): Version {
  const head = readHead(id);
  const files = workingFiles(id);
  if (!files["storyboard/scenes.json"] || !files["audio/voice.json"]) throw new VersionError(`${id} needs a voice and a storyboard before it can be edited`);
  const media = workingMedia(id);
  if (media.narration) storeNarration(id, projectPaths(id).narration);
  const raw = Object.fromEntries(TRACKED.filter((f) => files[f]).map((f) => [f, readFileSync(workingPath(id, f), "utf8")]));
  if (head === undefined) return commit(id, { kind: "start", label: "as it was before editing", files: raw, media });
  const current = readVersion(id, head);
  if (sameFiles(current.files, files) && current.media.narration === media.narration && current.media.mix === media.mix) return current;
  return commit(id, { kind: "outside", label: "changes made outside the editor", files: raw, media });
}

/** A new version with an older version's files and media (nothing re-made: every file comes out of a cache). */
export function rollback(id: string, to: number): Version {
  ensureVersions(id);
  const target = readVersion(id, to);
  const files = Object.fromEntries(TRACKED.filter((f) => target.files[f]).map((f) => [f, objectText(id, target.files[f]!)]));
  return commit(id, { kind: "rollback", label: `back to version ${to}: ${target.label}`, files, media: target.media, restores: to });
}

// ---------------------------------------------------------------- diff

const ByIdScene = z.object({ scenes: z.array(z.looseObject({ id: z.string() })) });
const ByIdLines = z.object({ lines: z.array(z.looseObject({ id: z.string(), file: z.string().optional(), fx: z.looseObject({ file: z.string() }).optional() })) });
const Cues = z.object({ cues: z.array(z.looseObject({ kind: z.string(), reason: z.string(), start: z.number(), asset: z.string() })) });
const Track = z.object({ track: z.object({ duration: z.number() }) });

function read<T>(id: string, v: Pick<Version, "files">, f: TrackedFile, schema: z.ZodType<T>): T | undefined {
  const hash = v.files[f];
  if (!hash) return undefined;
  const r = schema.safeParse(JSON.parse(objectText(id, hash)));
  return r.success ? r.data : undefined;
}

function diffById<T extends { id: string }>(a: T[], b: T[], ignore: string[] = []) {
  const ma = new Map(a.map((x) => [x.id, x]));
  const mb = new Map(b.map((x) => [x.id, x]));
  const changed: Record<string, string[]> = {};
  for (const [k, x] of mb) {
    const y = ma.get(k);
    if (!y) continue;
    const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((key) => !ignore.includes(key));
    const fields = keys.filter((key) => JSON.stringify((x as Record<string, unknown>)[key]) !== JSON.stringify((y as Record<string, unknown>)[key]));
    if (fields.length) changed[k] = fields;
  }
  const common = (xs: T[], other: Map<string, T>) => xs.map((x) => x.id).filter((k) => other.has(k));
  return { added: [...mb.keys()].filter((k) => !ma.has(k)), removed: [...ma.keys()].filter((k) => !mb.has(k)), changed, reordered: common(a, mb).join() !== common(b, ma).join() };
}

/** Which scenes, lines, takes and sound cues differ between two versions. */
export function diffVersions(id: string, a: Pick<Version, "files">, b: Pick<Version, "files">): VersionDiff {
  const scenes = diffById(read(id, a, "storyboard/scenes.json", ByIdScene)?.scenes ?? [], read(id, b, "storyboard/scenes.json", ByIdScene)?.scenes ?? []);
  const lines = diffById(read(id, a, "script.json", ByIdLines)?.lines ?? [], read(id, b, "script.json", ByIdLines)?.lines ?? []);
  const take = (l: { file?: string; fx?: { file: string } }) => l.fx?.file ?? l.file;
  const va = new Map((read(id, a, "audio/voice.json", ByIdLines)?.lines ?? []).map((l) => [l.id, take(l)]));
  const voiced = (read(id, b, "audio/voice.json", ByIdLines)?.lines ?? []).filter((l) => va.get(l.id) !== take(l)).map((l) => l.id);
  const cueKey = (c: { kind: string; reason: string }) => `${c.kind}: ${c.reason}`;
  const ca = new Map((read(id, a, "audio/mixplan.json", Cues)?.cues ?? []).map((c) => [cueKey(c), c]));
  const cb = new Map((read(id, b, "audio/mixplan.json", Cues)?.cues ?? []).map((c) => [cueKey(c), c]));
  const cues = {
    added: [...cb.keys()].filter((k) => !ca.has(k)),
    removed: [...ca.keys()].filter((k) => !cb.has(k)),
    moved: [...cb].filter(([k, c]) => ca.has(k) && (Math.abs(ca.get(k)!.start - c.start) > 0.001 || ca.get(k)!.asset !== c.asset)).map(([k]) => k),
  };
  return VersionDiff.parse({
    scenes,
    lines: { added: lines.added, removed: lines.removed, changed: lines.changed },
    voiced,
    cues,
    durationS: { from: read(id, a, "audio/voice.json", Track)?.track.duration ?? null, to: read(id, b, "audio/voice.json", Track)?.track.duration ?? null },
  });
}
