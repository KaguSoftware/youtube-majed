import "server-only";

import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { env } from "./env";
import { sameSecret } from "./tokens";

/*
 * Passwords and sessions, with nothing but node:crypto.
 *
 * Password hashes are written by `python -m pipeline.jobs adduser` and checked
 * here, so the format is shared: scrypt$N$r$p$<salt b64>$<hash b64>, the
 * parameters stored with the hash so they can be raised later without
 * invalidating existing accounts.
 *
 * A session is a signed cookie, not a table: payload.signature, HMAC-SHA256
 * under SESSION_SECRET. It carries the user's `session_epoch`; bumping that
 * column signs the user out everywhere. Verifying the signature needs no
 * database, which is what lets the proxy turn away anonymous requests
 * cheaply; the authoritative check (user exists, not disabled, epoch
 * current) happens in requireUser on every page, route and action.
 */

const scrypt = promisify(scryptCb) as (
  password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const SESSION_COOKIE = "ytm_session";
export const SESSION_DAYS = 30;

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const N = Number(n), R = Number(r), P = Number(p);
  const got = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length,
    { N, r: R, p: P, maxmem: 256 * N * R + 1024 * 1024 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export type Session = { uid: number; epoch: number; exp: number };

function sign(payload: string): string {
  return createHmac("sha256", env("SESSION_SECRET")).update(payload).digest("base64url");
}

export function issueSession(uid: number, epoch: number): { value: string; maxAge: number } {
  const maxAge = SESSION_DAYS * 24 * 3600;
  const payload = Buffer.from(JSON.stringify({
    uid, epoch, exp: Math.floor(Date.now() / 1000) + maxAge, n: randomBytes(6).toString("base64url"),
  })).toString("base64url");
  return { value: `${payload}.${sign(payload)}`, maxAge };
}

export function readSession(value: string | undefined): Session | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  if (!sameSecret(value.slice(dot + 1), sign(payload))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (typeof s.uid !== "number" || typeof s.epoch !== "number") return null;
    return s.exp > Date.now() / 1000 ? s : null;
  } catch {
    return null;
  }
}
