const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "2 minutes ago", "yesterday", "3 weeks ago". */
export function ago(date: Date | string | null, now = Date.now()): string {
  if (!date) return "";
  const s = Math.round((new Date(date).getTime() - now) / 1000);
  const a = Math.abs(s);
  if (a < 45) return "just now";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), "day");
  if (a < 86400 * 30) return rtf.format(Math.round(s / (86400 * 7)), "week");
  return new Date(date).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

export function minutes(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.round(seconds / 60);
  return `${m} min`;
}
