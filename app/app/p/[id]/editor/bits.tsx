"use client";
import { useId, type ReactNode } from "react";

/** A library dropdown: only ids from the catalogue, each with its description as a hint. */
export function LibrarySelect<T extends string>({
  label,
  value,
  options,
  onChange,
  none,
  changed,
}: {
  label: string;
  value: T | undefined;
  options: Record<T, { description: string }>;
  onChange: (v: T | undefined) => void;
  /** offer "none" (optional fields: weather, framing, an end position) */
  none?: string;
  changed?: boolean;
}) {
  const id = useId();
  const desc = value ? options[value]?.description : undefined;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-xs font-semibold text-muted">
        {label}
        {changed && <span className="font-normal text-accent">changed</span>}
      </label>
      <select
        id={id}
        value={value ?? ""}
        title={desc}
        onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
        className={`mt-1 h-8 w-full cursor-pointer truncate rounded-md bg-room pl-2 pr-7 text-sm text-text ring-inset transition-shadow duration-150 hover:ring-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${changed ? "ring-1 ring-accent/70" : "ring-1 ring-edge"}`}
      >
        {none !== undefined && <option value="">{none}</option>}
        {(Object.keys(options) as T[]).map((k) => (
          <option key={k} value={k}>
            {k.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Section({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`border-t border-hairline pt-4 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 id={id} className="eyebrow text-faint">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Energy 1–5 as five pips (the script editor's control), operable with the arrow keys as a radio group. */
export function Pips({ value, onChange, label = "Energy" }: { value: number; onChange: (n: number) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${label} ${n}`}
          tabIndex={value === n ? 0 : -1}
          onClick={() => onChange(n)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowUp") (e.preventDefault(), onChange(Math.min(5, value + 1)));
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") (e.preventDefault(), onChange(Math.max(1, value - 1)));
          }}
          className="grid h-7 w-6 place-items-center rounded-sm hover:bg-lifted"
        >
          <span aria-hidden className={`block w-1.5 rounded-full transition-colors duration-150 ${n <= value ? "bg-accent" : "bg-hairline"}`} style={{ height: 6 + n * 3 }} />
        </button>
      ))}
      <span className="tabular ml-1 text-xs text-muted">{value}</span>
    </div>
  );
}

/** A small, quiet text button for secondary actions inside the inspector. */
export const small = {
  primary: "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 text-sm font-semibold text-accent-ink transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50",
  secondary: "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm font-semibold text-text ring-1 ring-inset ring-edge transition-colors duration-150 hover:bg-lifted disabled:cursor-not-allowed disabled:opacity-50",
  quiet: "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm font-semibold text-muted transition-colors duration-150 hover:bg-lifted hover:text-text disabled:cursor-not-allowed disabled:opacity-50",
  danger: "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm font-semibold text-danger ring-1 ring-inset ring-danger/50 transition-colors duration-150 hover:bg-danger-wash disabled:cursor-not-allowed disabled:opacity-50",
};

export const textField =
  "w-full rounded-md bg-room px-2.5 py-2 text-sm text-text placeholder:text-faint ring-1 ring-inset ring-edge transition-shadow duration-150 hover:ring-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
