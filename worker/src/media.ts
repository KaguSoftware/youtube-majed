/**
 * Small media helpers for the render and export steps: ffprobe summaries,
 * the fast-start check, content hashes (memoised by size and mtime, so the
 * pipeline status can compare a 90 MB mix on every request), and a child
 * process runner that can be cancelled with its whole process group (Remotion
 * starts Chrome processes of its own).
 */
import { MediaInfo } from "@studio/schema";
import { GROUP, killTree } from "@studio/project";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, existsSync, openSync, readSync, statSync } from "node:fs";

// ---------------------------------------------------------------- hashes

const memo = new Map<string, string>();

/** sha256 of a file's content, first 16 hex chars. "missing" when the file does not exist. */
export async function fileHash(file: string): Promise<string> {
  if (!existsSync(file)) return "missing";
  const st = statSync(file);
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const h = createHash("sha256");
  await new Promise<void>((resolve, reject) => createReadStream(file).on("data", (d) => h.update(d)).on("end", resolve).on("error", reject));
  const digest = h.digest("hex").slice(0, 16);
  memo.set(key, digest);
  return digest;
}

// ---------------------------------------------------------------- child processes

export class ChildError extends Error {
  override name = "ChildError";
  constructor(
    message: string,
    readonly code: number | null,
    readonly tail: string,
  ) {
    super(message);
  }
}

/**
 * Runs a command, calling `onLine` for every stdout line. Resolves with the
 * stderr tail. Aborting kills the process group.
 */
export function runChild(cmd: string, args: string[], o: { cwd?: string; signal?: AbortSignal; onLine?: (line: string) => void; env?: NodeJS.ProcessEnv } = {}): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: o.cwd, env: { ...process.env, ...o.env }, ...GROUP, stdio: ["ignore", "pipe", "pipe"] });
    const kill = () => killTree(child.pid);
    if (o.signal?.aborted) kill();
    o.signal?.addEventListener("abort", kill, { once: true });
    let buf = "";
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      const text = d.toString("utf8");
      stdout = (stdout + text).slice(-20_000);
      buf += text;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) o.onLine?.(line);
      }
    });
    child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString("utf8")).slice(-6000)));
    child.on("error", (e) => reject(new ChildError(`cannot run ${cmd}: ${e.message}`, null, stderr)));
    child.on("close", (code) => {
      o.signal?.removeEventListener("abort", kill);
      if (o.signal?.aborted) return reject(new ChildError("cancelled", code, stderr));
      if (buf.trim()) o.onLine?.(buf.trim());
      if (code === 0) resolve({ stderr, stdout });
      else reject(new ChildError(`${cmd} exited with code ${code}`, code, stderr.trim().slice(-1500)));
    });
  });
}

// ---------------------------------------------------------------- ffprobe

/** True when `moov` comes before `mdat` among the file's top-level atoms (so playback can start before the download ends). */
export function hasFastStart(file: string): boolean {
  const fd = openSync(file, "r");
  try {
    const size = statSync(file).size;
    let pos = 0;
    const head = Buffer.alloc(16);
    while (pos + 8 <= size) {
      readSync(fd, head, 0, 16, pos);
      let len = head.readUInt32BE(0);
      const type = head.toString("latin1", 4, 8);
      if (type === "moov") return true;
      if (type === "mdat") return false;
      if (len === 1) len = Number(head.readBigUInt64BE(8));
      if (len < 8) return false;
      pos += len;
    }
    return false;
  } finally {
    closeSync(fd);
  }
}

type Probe = {
  format: { format_name: string; duration: string; size: string; bit_rate: string };
  streams: { codec_type: string; codec_name: string; profile?: string; width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string; pix_fmt?: string; bit_rate?: string; sample_rate?: string; channels?: number }[];
};

const kbps = (v: string | undefined) => (v ? Math.round(Number(v) / 1000) : 0);
const rate = (v: string | undefined) => {
  const [a, b] = (v ?? "0/1").split("/").map(Number);
  return b ? Math.round(((a ?? 0) / b) * 100) / 100 : 0;
};

export async function probe(file: string): Promise<MediaInfo> {
  const { stdout } = await runChild("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]);
  const j = JSON.parse(stdout) as Probe;
  const v = j.streams.find((s) => s.codec_type === "video");
  if (!v) throw new Error(`${file} has no video stream`);
  const a = j.streams.find((s) => s.codec_type === "audio");
  return MediaInfo.parse({
    container: j.format.format_name,
    durationS: Number(j.format.duration),
    sizeBytes: Number(j.format.size),
    totalKbps: kbps(j.format.bit_rate),
    video: { codec: v.codec_name, profile: v.profile ?? "", width: v.width ?? 0, height: v.height ?? 0, fps: rate(v.avg_frame_rate), pixFmt: v.pix_fmt ?? "", kbps: kbps(v.bit_rate) },
    audio: a ? { codec: a.codec_name, profile: a.profile ?? "", sampleRate: Number(a.sample_rate ?? 0), channels: a.channels ?? 0, kbps: kbps(a.bit_rate) } : null,
    fastStart: hasFastStart(file),
  });
}
