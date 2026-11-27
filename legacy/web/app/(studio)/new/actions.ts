"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { isNarrative } from "@/lib/narratives";
import { DURATIONS } from "@/lib/stages";

export type NewFilmState = {
  errors?: { topic?: string; angle?: string; narrative?: string };
  values?: { topic: string; angle: string; duration: string; narrative: string };
};

const TOPIC_MIN = 3;
const TOPIC_MAX = 140;
const ANGLE_MAX = 600;

/** A readable, unique id: the topic's first words plus a short random tail. */
function slug(topic: string): string {
  const words = topic.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "")
    .split(/[\s_-]+/).filter(Boolean).slice(0, 6).join("-").slice(0, 48);
  return `${words || "film"}-${randomBytes(3).toString("hex")}`;
}

export async function createFilm(_prev: NewFilmState, form: FormData): Promise<NewFilmState> {
  const user = await requireUser();
  const topic = String(form.get("topic") ?? "").replace(/\s+/g, " ").trim();
  const angle = String(form.get("angle") ?? "").trim();
  const duration = String(form.get("duration") ?? "180");
  const narrative = String(form.get("narrative") ?? "");
  const values = { topic, angle, duration, narrative };

  const errors: NewFilmState["errors"] = {};
  if (topic.length < TOPIC_MIN) errors.topic = "Give the film a topic, a few words at least. Example: How did barbarians live?";
  else if (topic.length > TOPIC_MAX) errors.topic = `Keep the topic under ${TOPIC_MAX} characters; the angle is the place for detail.`;
  if (angle.length > ANGLE_MAX) errors.angle = `Keep the angle under ${ANGLE_MAX} characters.`;
  if (!isNarrative(narrative)) errors.narrative = "Choose how the film is told. It shapes the research and the whole script.";
  if (errors.topic || errors.angle || errors.narrative) return { errors, values };

  const seconds = DURATIONS.find((d) => String(d.seconds) === duration)?.seconds ?? 180;
  const id = slug(topic);
  await transaction(async (db) => {
    await db.query(
      "INSERT INTO projects (id, topic, angle, target_duration, narrative, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, topic, angle || null, seconds, narrative, user.id],
    );
    await db.query(
      "INSERT INTO project_events (project_id, kind, to_state, user_id, data) VALUES ($1, 'created', 'idea', $2, $3)",
      [id, user.id, JSON.stringify({ target_duration: seconds, narrative })],
    );
  });
  redirect(`/films/${id}`);
}
