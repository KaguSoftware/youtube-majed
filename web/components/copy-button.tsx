"use client";

import { useState } from "react";

import { button } from "./ui";

export function CopyButton({ text, label, done = "Copied" }: { text: string; label: string; done?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={button.secondary}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <span aria-live="polite">{copied ? done : label}</span>
    </button>
  );
}
