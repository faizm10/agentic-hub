"use client";

import { Brain, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ReasoningItem } from "../model/types";
import { cn } from "../lib/cn";
import { formatDuration } from "../lib/format";

/** Provider-supplied reasoning *summary* (never raw chain-of-thought). */
export function ReasoningSummary({ item }: { item: ReasoningItem }) {
  const [open, setOpen] = useState(false);
  const expanded = open || Boolean(item.streaming);
  return (
    <div className="max-w-3xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className="group inline-flex items-center gap-1.5 rounded-md py-0.5 pr-1.5 text-xs text-fg-subtle transition-colors hover:text-fg-muted focus-ring"
      >
        <Brain className="size-3.5" />
        {item.streaming ? (
          <span className="bg-gradient-to-r from-fg-subtle via-fg to-fg-subtle bg-[length:200%_100%] bg-clip-text text-transparent animate-shimmer">
            Thinking…
          </span>
        ) : (
          <span>Reasoned{item.durationMs ? ` for ${formatDuration(item.durationMs)}` : ""}</span>
        )}
        <ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded ? (
        <p className="mt-1.5 border-l-2 border-border pl-3 text-sm leading-relaxed text-fg-muted animate-in fade-in-0">{item.summary}</p>
      ) : null}
    </div>
  );
}