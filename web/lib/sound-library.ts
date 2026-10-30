import "server-only";

import { mediaUrls } from "./media";
import { query } from "./db";

/*
 * The studio's own sound effects (pipeline/migrations/009_sounds.sql), beside
 * the stock ones in lib/sounds.ts. An upload goes into the media store at a
 * content address and into the `media` index, exactly as the studio machine
 * publishes its own files, so its mirror fetches the sound like any other.
 */

/** Largest file accepted, and the formats ffmpeg on the studio machine is
 *  known to read, by their first bytes rather than their names. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export type Upload = { id: number; name: string; seconds: number; by: string | null; url: string | null };

/** Every uploaded sound, newest first, each with a URL to preview it. */
export async function listUploads(): Promise<Upload[]> {
  const rows = await query<{ id: string; name: string; key: string; seconds: number; by: string | null }>(
    `SELECT s.id, s.name, s.key, s.seconds, u.display_name AS by
     FROM sounds s LEFT JOIN users u ON u.id = s.created_by ORDER BY s.id DESC`).catch(() => []);
  const urls = await mediaUrls(rows.map((r) => r.key)).catch(() => ({} as Record<string, string>));
  return rows.map((r) => ({ id: Number(r.id), name: r.name, seconds: r.seconds, by: r.by, url: urls[r.key] ?? null }));
}

/** The audio format of a file by its first bytes, or null. */
export function sniffAudio(head: Uint8Array): { ext: string; type: string } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (ascii(0, 3) === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0)) {
    return { ext: "mp3", type: "audio/mpeg" };
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return { ext: "wav", type: "audio/wav" };
  if (ascii(0, 4) === "OggS") return { ext: "ogg", type: "audio/ogg" };
  if (ascii(0, 4) === "fLaC") return { ext: "flac", type: "audio/flac" };
  if (ascii(4, 8) === "ftyp") return { ext: "m4a", type: "audio/mp4" };
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return { ext: "webm", type: "audio/webm" };
  return null;
}

/** pipeline/media.py BlobRemote.name: the media index is kept per store. */
export function storeName(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN ?? "";
  const parts = token.split("_");
  return `vercel-blob:${parts.length > 4 && token.startsWith("vercel_blob_rw_") ? parts[3] : "unknown"}`;
}
