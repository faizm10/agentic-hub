"use client";

import type { MessageItem } from "../model/types";
import { cn } from "../lib/cn";
import { formatClock } from "../lib/format";
import { Markdown } from "./markdown";

function Caret() {
  return <span aria-hidden className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] rounded-full bg-accent animate-caret" />;
}

export function ChatMessage({ message }: { message: MessageItem }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end" data-role="user">
        <div
          className="max-w-[min(42rem,88%)] rounded-xl rounded-br-[5px] border border-border bg-surface-2 px-3.5 py-2.5"
          title={`Sent ${formatClock(message.createdAt)}`}
        >
          <p className="whitespace-pre-wrap text-base leading-relaxed text-fg">{message.text}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-3xl" data-role="assistant" aria-busy={message.streaming || undefined}>
      <Markdown source={message.text} trailing={message.streaming ? <Caret /> : null} />
    </div>
  );
}

export function MessageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-label="Loading message">
      <div className="skeleton h-3 w-3/4" />
      <div className="skeleton h-3 w-2/3" />
      <div className="skeleton h-3 w-1/2" />
    </div>
  );
}