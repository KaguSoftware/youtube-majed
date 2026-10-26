"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { one } from "@/lib/db";
import { issueSession, SESSION_COOKIE, verifyPassword } from "@/lib/session";

export type SignInState = { error?: string; username?: string };

// A real scrypt check runs even for unknown usernames, so response time does
// not reveal which usernames exist.
const DUMMY_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!username || !password) {
    return { error: "Enter your username and password.", username };
  }
  const row = await one<{ id: string; password_hash: string; session_epoch: number }>(
    "SELECT id, password_hash, session_epoch FROM users WHERE username = $1 AND disabled_at IS NULL",
    [username],
  );
  const ok = await verifyPassword(row?.password_hash ?? DUMMY_HASH, password);
  if (!row || !ok) {
    return { error: "That username and password don't match. Check both and try again.", username };
  }
  const { value, maxAge } = issueSession(Number(row.id), row.session_epoch);
  (await cookies()).set(SESSION_COOKIE, value, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge,
  });
  const next = String(form.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
