"use client";

import { formatShortcut } from "../lib/shortcuts";
import { cn } from "../lib/cn";

export function Kbd({ keys, className }: { keys: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden>
      {formatShortcut(keys).map((part, i) => (
        <kbd
          key={i}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-border bg-surface-2 px-1 font-sans text-2xs font-medium text-fg-subtle"
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}