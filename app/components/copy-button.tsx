"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { button } from "./ui";

/** Copies text, and says so. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={button.quiet}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        });
      }}
    >
      {done ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </button>
  );
}
