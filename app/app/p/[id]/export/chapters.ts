import type { ChapterMark } from "@studio/schema";

/** M:SS (or H:MM:SS) and the title: the form YouTube reads from a description. */
export function chapterText(marks: readonly ChapterMark[]): string {
  return marks
    .map((m) => {
      const t = Math.floor(m.atS);
      const h = Math.floor(t / 3600);
      const mm = String(Math.floor(t / 60) % 60).padStart(h ? 2 : 1, "0");
      return `${h ? `${h}:` : ""}${mm}:${String(t % 60).padStart(2, "0")} ${m.title}`;
    })
    .join("\n");
}
