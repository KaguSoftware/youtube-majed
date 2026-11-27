import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { one } from "./db";
import { readSession, SESSION_COOKIE } from "./session";

export type User = { id: number; username: string; displayName: string };

/** The signed-in user, or null. Authoritative: the user must exist, not be
 *  disabled, and the session's epoch must match (passwd and signout-all bump
 *  it). Reads cookies, so callers sit behind a Suspense boundary. */
export async function getUser(): Promise<User | null> {
  // Request time, explicitly: the session check compares its expiry with the
  // clock, which must never be frozen into a prerendered shell.
  await connection();
  const session = readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const row = await one<{ id: string; username: string; display_name: string }>(
    "SELECT id, username, display_name FROM users " +
      "WHERE id = $1 AND session_epoch = $2 AND disabled_at IS NULL",
    [session.uid, session.epoch],
  );
  return row ? { id: Number(row.id), username: row.username, displayName: row.display_name } : null;
}

/** Every page, route and action that touches data calls this first. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
