import { z } from "zod";
import { CATALOGUE, type CatalogueSection } from "./catalogue";

/** Levenshtein distance, for "did you mean" hints. */
function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

/** The closest known id, if it is close enough to be a plausible typo. */
export function closest(input: string, known: readonly string[]): string | undefined {
  const needle = input.toLowerCase().replace(/[\s-]+/g, "_");
  let best: string | undefined;
  let bestScore = Infinity;
  for (const k of known) {
    const score = k.includes(needle) || needle.includes(k) ? 1 : distance(needle, k);
    if (score < bestScore) {
      best = k;
      bestScore = score;
    }
  }
  return best !== undefined && bestScore <= Math.max(2, Math.floor(needle.length / 3)) ? best : undefined;
}

/**
 * A zod enum over one catalogue section, with an error that names the bad
 * value, suggests the closest id and points at the catalogue.
 */
export function libraryId<S extends CatalogueSection>(section: S, noun: string) {
  const ids = Object.keys(CATALOGUE[section]) as [keyof (typeof CATALOGUE)[S] & string, ...(keyof (typeof CATALOGUE)[S] & string)[]];
  return z.enum(ids, {
    error: (issue) => {
      if (typeof issue.input !== "string") return `expected a ${noun} id (string), got ${JSON.stringify(issue.input)}`;
      const hint = closest(issue.input, ids);
      return `unknown ${noun} "${issue.input}"${hint ? ` (did you mean "${hint}"?)` : ""}. Known: ${ids.join(", ")}`;
    },
  });
}
