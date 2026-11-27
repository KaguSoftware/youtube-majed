/** Shared control vocabulary, from legacy/web/components/ui.ts. One shape per role, used on every screen. */

const base =
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-semibold " +
  "transition-[background-color,color,box-shadow] duration-150 ease-out-quart " +
  "disabled:cursor-not-allowed disabled:opacity-50 select-none";

export const button = {
  primary: `${base} h-10 px-5 bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent`,
  secondary: `${base} h-10 px-4 text-text ring-1 ring-inset ring-edge hover:bg-lifted`,
  quiet: `${base} h-9 px-3 text-muted hover:text-text hover:bg-raised`,
};

/** The same roles, set on paper (the script). */
export const paperButton = {
  primary: `${base} h-8 px-3.5 bg-ink text-paper hover:bg-ink/85`,
  secondary: `${base} h-8 px-3 text-ink ring-1 ring-inset ring-ink-muted hover:bg-paper-shade`,
  quiet: `${base} h-8 px-2.5 text-ink-muted hover:text-ink hover:bg-paper-shade`,
};

export const field =
  "w-full rounded-md bg-raised text-text placeholder:text-faint ring-1 ring-inset ring-edge " +
  "px-3.5 py-2.5 transition-shadow duration-150 ease-out-quart " +
  "hover:ring-muted focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent " +
  "aria-[invalid=true]:ring-danger";

export const label = "text-sm font-semibold text-text";
export const hint = "text-sm text-muted";
