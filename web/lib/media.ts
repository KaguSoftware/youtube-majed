import "server-only";

import { issueSignedToken, presignUrl } from "@vercel/blob";

/*
 * Browser access to the private Blob store.
 *
 * The page gets short-lived presigned URLs, and the browser fetches media
 * straight from the store: HTTP range requests work (a video seeks), the CDN
 * caches repeat reads, and nothing streams through a function. Measured in the
 * Phase 3 spike: 206 on a range, cache HIT on repeats.
 *
 * Issuing the signing token is a control-plane call, so one store-wide read
 * token is kept per function instance and reused for every key until shortly
 * before it expires. Signing an individual URL with it is local.
 */

const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const RENEW_BEFORE_MS = 10 * 60 * 1000;

type Signer = Awaited<ReturnType<typeof issueSignedToken>> & { until: number };
let signer: Promise<Signer> | null = null;

async function getSigner(): Promise<Signer> {
  const current = signer && (await signer.catch(() => null));
  if (current && current.until - Date.now() > RENEW_BEFORE_MS) return current;
  const until = Date.now() + TOKEN_LIFETIME_MS;
  signer = issueSignedToken({ pathname: "*", operations: ["get"], validUntil: until })
    .then((t) => ({ ...t, until }));
  return signer;
}

/** A URL the browser can GET for one media key, valid for most of an hour. */
export async function mediaUrl(key: string): Promise<string> {
  const s = await getSigner();
  const { presignedUrl } = await presignUrl(s, { operation: "get", pathname: key, access: "private" });
  return presignedUrl;
}

export async function mediaUrls(keys: string[]): Promise<Record<string, string>> {
  const entries = await Promise.all(keys.map(async (k) => [k, await mediaUrl(k)] as const));
  return Object.fromEntries(entries);
}

/** The media key of a shot's still, from the path its timeline records
 *  (`cache/images/<hash>.webp`, or `.png` for stills made before WebP). */
export const stillKey = (path: string) => path.replace(/^cache\//, "");
