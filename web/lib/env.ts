import "server-only";

/** A required server environment variable. Throws at first use, not import,
 *  so a build without production secrets still compiles. */
export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
