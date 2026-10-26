import type { Sheet } from "@/lib/projects";

/**
 * Frames read out of a film's contact sheet (production.contact_sheet): one
 * small WebP per film, each frame shown by background position. `count`
 * frames are sampled evenly across the film.
 */
export function Filmstrip({ sheet, url, count = 6, title }: {
  sheet: Sheet; url: string; count?: number; title: string;
}) {
  const n = sheet.shots.length;
  const picks = Array.from({ length: Math.min(count, n) }, (_, i) =>
    n <= count ? i : Math.round((i * (n - 1)) / (count - 1)));
  const [w, h] = sheet.thumb;
  return (
    <div className="flex gap-1 overflow-hidden rounded-sm" role="img"
      aria-label={`${picks.length} frames from ${title}`}>
      {picks.map((i) => {
        const col = i % sheet.cols;
        const row = Math.floor(i / sheet.cols);
        return (
          <span
            key={i}
            className="block min-w-0 flex-1 bg-raised"
            style={{
              aspectRatio: `${w} / ${h}`,
              backgroundImage: `url(${url})`,
              backgroundSize: `${sheet.cols * 100}% ${sheet.rows * 100}%`,
              backgroundPosition: `${sheet.cols > 1 ? (col / (sheet.cols - 1)) * 100 : 0}% ${
                sheet.rows > 1 ? (row / (sheet.rows - 1)) * 100 : 0}%`,
            }}
          />
        );
      })}
    </div>
  );
}
