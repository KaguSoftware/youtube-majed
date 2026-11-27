"use server";

import { createHash } from "node:crypto";

import { put } from "@vercel/blob";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { currentVersion, getCut, shotMarks, timecode } from "@/lib/cuts";
import { one, query, transaction } from "@/lib/db";
import { ring, warm } from "@/lib/doorbell";
import { MAX_UPLOAD_BYTES, sniffAudio, storeName } from "@/lib/sound-library";
import { isStock, MAX_CUES, MAX_UPLOAD_SECONDS, STOCK, UPLOAD, VOLUMES } from "@/lib/sounds";

import type { ActionState } from "./actions";

const LIVE = "state IN ('queued', 'running')";

/** Ask Claude for a change to the film as it is now. The edit is made on the
 *  current cut and becomes the next one (pipeline/editor.py). */
export async function requestEdit(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const request = String(form.get("request") ?? "").replace(/\s+/g, " ").trim();
  const atRaw = String(form.get("at") ?? "");
  const at = atRaw === "" ? null : Number(atRaw);
  if (request.length < 4) return { error: "Say what should change, for example: the mood at 1:24 doesn't match." };
  if (request.length > 1000) return { error: "Keep it to a few sentences; ask for one change at a time." };
  const base = await currentVersion(projectId);
  if (base === null) return { error: "There is no film to change yet." };
  return enqueueEdit(projectId, user.id, base, { request, at: at !== null && Number.isFinite(at) ? Math.max(0, at) : null });
}

/** pipeline/editor.py MAX_REPAINT. */
const MAX_REPAINT = 12;

/** Paint the frames a person marked as wrong again, from the same words on a
 *  new seed. No request for Claude: the person already chose the shots
 *  (pipeline/editor.py repaint). One cut for all of them, so one undo. */
export async function requestRepaint(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const asked = [...new Set(form.getAll("shot").map(String))];
  if (!asked.length) return { error: "Mark the frames to paint again first." };
  if (asked.length > MAX_REPAINT) return { error: `Mark up to ${MAX_REPAINT} frames at a time.` };
  const base = await currentVersion(projectId);
  if (base === null) return { error: "There is no film to change yet." };
  const marks = await shotMarks(projectId, base);
  const picked = marks.filter((m) => asked.includes(m.id));
  if (picked.length !== asked.length) return { error: "The film changed since this page was loaded. Reload and mark the frames again." };
  const when = picked.map((m) => timecode(m.start));
  const request = `Paint ${picked.length === 1 ? "the frame" : `${picked.length} frames`} again: ${when.join(", ")}`;
  return enqueueEdit(projectId, user.id, base, { request, at: null, repaint: picked.map((m) => m.id) });
}

type Placed = { sound: string; at: number; volume: string };

/** Sounds placed on the film and sounds taken off it in the studio, as one
 *  cut (so one undo), without asking Claude (pipeline/editor.py
 *  place_sounds). Form: `add` as JSON {sound, at, volume}, `remove` cue ids. */
export async function requestSounds(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const remove = [...new Set(form.getAll("remove").map(String))];
  let add: Placed[];
  try {
    add = form.getAll("add").map((raw) => {
      const a = JSON.parse(String(raw)) as Partial<Placed>;
      return { sound: String(a.sound ?? ""), at: Number(a.at), volume: String(a.volume ?? "normal") };
    });
  } catch {
    return { error: "The sounds could not be read. Reload the page and place them again." };
  }
  if (!add.length && !remove.length) return { error: "Place a sound first." };
  if (add.length + remove.length > MAX_CUES) return { error: `Place up to ${MAX_CUES} sounds at a time.` };
  const base = await currentVersion(projectId);
  if (base === null) return { error: "There is no film to change yet." };
  const cut = await getCut(projectId, base);
  if (!cut) return { error: "There is no film to change yet." };
  const asked = add.filter((a) => a.sound.startsWith(UPLOAD)).map((a) => Number(a.sound.slice(UPLOAD.length)) || 0);
  const rows = asked.length
    ? await query<{ id: string; name: string }>("SELECT id, name FROM sounds WHERE id = ANY($1::bigint[])", [asked])
    : [];
  const uploads = new Map(rows.map((r) => [`${UPLOAD}${r.id}`, r.name]));
  const nameOf = (sound: string) => STOCK.find((s) => s.id === sound)?.name ?? uploads.get(sound);
  for (const a of add) {
    if (!isStock(a.sound) && !uploads.has(a.sound)) return { error: "One of those sounds is no longer in the library. Choose another." };
    if (!Number.isFinite(a.at) || a.at < 0 || a.at >= cut.duration) return { error: `${nameOf(a.sound)} is placed outside the film.` };
    if (!VOLUMES.some((v) => v.id === a.volume)) return { error: "A sound's volume is quiet, normal or loud." };
  }
  const gone = remove.filter((id) => !cut.sounds.some((c) => c.id === id));
  if (gone.length) return { error: "The film changed since this page was loaded. Reload and try again." };
  if (cut.sounds.length - remove.length + add.length > MAX_CUES) return { error: `A film can carry up to ${MAX_CUES} sounds.` };
  const said = (name: string | undefined, at: number) => `${name} at ${timecode(at)}`;
  const request = [
    add.length ? `Add ${add.map((a) => said(nameOf(a.sound), a.at)).join(", ")}` : "",
    remove.length ? `take off ${remove.map((id) => { const c = cut.sounds.find((x) => x.id === id)!; return said(c.name, c.at); }).join(", ")}` : "",
  ].filter(Boolean).join("; ").replace(/^t/, "T");
  const at = add.length ? Math.min(...add.map((a) => a.at)) : null;
  return enqueueEdit(projectId, user.id, base, { request, at, sounds: { add, remove } });
}

/** A sound of the studio's own: stored at its content address, recorded in
 *  the media index the studio machine reads, and listed for everyone.
 *  `seconds` is measured by the browser that decoded it. */
export async function uploadSound(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const file = form.get("file");
  const name = String(form.get("name") ?? "").replace(/\s+/g, " ").trim();
  const seconds = Number(form.get("seconds"));
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a sound file." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: `That file is ${(file.size / 1e6).toFixed(1)} MB. Sounds can be up to 2 MB.` };
  if (!name) return { error: "Give the sound a name, so it can be found." };
  if (name.length > 60) return { error: "Keep the name under 60 characters." };
  if (!Number.isFinite(seconds) || seconds <= 0) return { error: "That file could not be played as audio." };
  if (seconds > MAX_UPLOAD_SECONDS) return { error: `That sound is ${Math.round(seconds)} seconds. Trim it to ${MAX_UPLOAD_SECONDS} or less.` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffAudio(bytes.subarray(0, 16));
  if (!kind) return { error: "That is not an audio file the studio can read. Use MP3, WAV, OGG, M4A, FLAC or WebM." };
  const key = `sounds/${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${kind.ext}`;
  try {
    await put(key, Buffer.from(bytes), {
      access: "private", contentType: kind.type, addRandomSuffix: false, allowOverwrite: true,
      cacheControlMaxAge: 365 * 24 * 3600,
    });
  } catch {
    return { error: "The sound could not be stored. Try again in a moment." };
  }
  // Upload first, record second (pipeline/media.py): a row never names a
  // file the store does not have.
  await transaction(async (db) => {
    await db.query("INSERT INTO media (store, key, size, kind) VALUES ($1, $2, $3, 'sound') ON CONFLICT DO NOTHING",
      [storeName(), key, bytes.length]);
    await db.query(
      "INSERT INTO sounds (name, key, bytes, seconds, created_by) VALUES ($1, $2, $3, $4, $5) " +
      "ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name",
      [name, key, bytes.length, Math.round(seconds * 100) / 100, user.id]);
  });
  revalidatePath("/films", "layout");
  return { ok: "uploaded" };
}

/** Take one of the studio's sounds out of the library. Films that use it
 *  keep it: their cues carry its key. */
export async function deleteSound(id: number): Promise<void> {
  await requireUser();
  await one("DELETE FROM sounds WHERE id = $1 RETURNING id", [id]);
  revalidatePath("/films", "layout");
}

/** An edit of cut `base`, unless the film is already being changed. */
async function enqueueEdit(projectId: string, userId: number, base: number,
  ask: { request: string; at: number | null; repaint?: string[]; sounds?: { add: Placed[]; remove: string[] } }): Promise<ActionState> {
  const busy = await one<{ kind: string }>(
    `SELECT kind FROM jobs WHERE project_id = $1 AND kind IN ('production', 'edit') AND ${LIVE} LIMIT 1`, [projectId]);
  if (busy) return { error: busy.kind === "edit" ? "A change is already being made. Wait for it, or stop it." : "The film is being rendered again. Changes can be asked for once it is done." };
  try {
    await transaction(async (db) => {
      await db.query("INSERT INTO jobs (project_id, kind, payload, max_attempts) VALUES ($1, 'edit', $2, 2)", [projectId,
        JSON.stringify({ base_version: base, ...ask, requested_by: userId })]);
      await db.query(
        "INSERT INTO project_events (project_id, kind, user_id, data) VALUES ($1, 'edit_requested', $2, $3)",
        [projectId, userId, JSON.stringify({ ...ask, base_version: base })]);
    });
  } catch (err) {
    if (String(err).includes("jobs_one_live_per_project")) return { error: "A change is already being made." };
    throw err;
  }
  await Promise.all([ring(), warm()]);
  revalidatePath(`/films/${projectId}`);
  return { ok: "asked" };
}

/** Make a cut the film. Undo is this, with the cut before. Free: every cut's
 *  chunks are already in the store. */
export async function chooseCut(projectId: string, version: number): Promise<void> {
  const user = await requireUser();
  const cut = await getCut(projectId, version);
  if (!cut) throw new Error("no such cut");
  await transaction(async (db) => {
    const live = await db.query(`SELECT 1 FROM jobs WHERE project_id = $1 AND kind = 'edit' AND ${LIVE}`, [projectId]);
    if (live.rowCount) throw new Error("A change is being made; choose a cut when it is done.");
    const { rows } = await db.query<{ from: number | null }>(
      "SELECT timeline_version AS from FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
    await db.query("UPDATE projects SET timeline_version = $2, updated_at = now() WHERE id = $1", [projectId, version]);
    await db.query(
      "INSERT INTO project_events (project_id, kind, user_id, data) VALUES ($1, 'cut_chosen', $2, $3)",
      [projectId, user.id, JSON.stringify({ from: rows[0]?.from ?? null, to: version })]);
  });
  revalidatePath(`/films/${projectId}`);
}

/** Stop a change being made. The worker sees its claim gone at the next
 *  heartbeat and abandons the edit; the film is untouched. */
export async function stopEdit(projectId: string): Promise<void> {
  const user = await requireUser();
  const { rowCount } = await transaction((db) => db.query(
    `UPDATE jobs SET state = 'cancelled', lease_token = NULL, finished_at = now()
     WHERE project_id = $1 AND kind = 'edit' AND ${LIVE}`, [projectId]));
  if (rowCount) {
    await one("INSERT INTO project_events (project_id, kind, user_id) VALUES ($1, 'edit_stopped', $2) RETURNING id",
      [projectId, user.id]);
  }
  revalidatePath(`/films/${projectId}`);
}

/** An mp4 of one cut, made on the studio machine and kept for download. */
export async function prepareDownload(projectId: string, version: number): Promise<void> {
  await requireUser();
  if (!(await getCut(projectId, version))) throw new Error("no such cut");
  await one(
    `INSERT INTO jobs (project_id, kind, payload)
     SELECT $1, 'export', $2 WHERE NOT EXISTS (
       SELECT 1 FROM jobs WHERE project_id = $1 AND kind = 'export' AND ${LIVE}) RETURNING id`,
    [projectId, JSON.stringify({ version })]);
  await Promise.all([ring(), warm()]);
  revalidatePath(`/films/${projectId}`);
}

/** The editing page is open: keep the studio machine listening closely. */
export async function keepWarm(): Promise<void> {
  await requireUser();
  await warm();
}
