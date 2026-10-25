"use client";

import { Check, Copy } from "lucide-react";
import type { AgentId, MessageItem } from "../model/types";
import { cn } from "../lib/cn";
import { formatClock } from "../lib/format";
import { useCopy } from "../lib/use-copy";
import { Tooltip } from "../primitives/tooltip";
import { AgentMark } from "./agent-mark";
import { Markdown } from "./markdown";

function Caret() {
  return <span aria-hidden className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] rounded-full bg-fg animate-caret" />;
}

function CopyAction({ text }: { text: string }) {
  const { copied, copy } = useCopy();
  return (
    <Tooltip content={copied ? "Copied" : "Copy"}>
      <button
        type="button"
        onClick={() => void copy(text)}
        aria-label={copied ? "Copied" : "Copy message"}
        className="inline-flex size-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg focus-ring"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </Tooltip>
  );
}

export function ChatMessage({ message, agentId }: { message: MessageItem; agentId?: AgentId }) {
  if (message.role === "user") {
    return (
      <div className="group flex flex-col items-end gap-1" data-role="user">
        <div
          className="max-w-[min(38rem,85%)] rounded-3xl bg-surface-3 px-4 py-2.5"
          title={`Sent ${formatClock(message.createdAt)}`}
        >
          <p className="whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.65] text-fg">{message.text}</p>
        </div>
        <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <CopyAction text={message.text} />
        </div>
      </div>
    );
  }
  return (
    <div className="group flex gap-3.5" data-role="assistant" aria-busy={message.streaming || undefined}>
      {agentId ? <AgentMark agentId={agentId} size="md" className="mt-1 hidden sm:inline-flex" /> : null}
      <div className="min-w-0 flex-1">
        <Markdown source={message.text} trailing={message.streaming ? <Caret /> : null} />
        <div className={cn("mt-1 flex items-center gap-0.5 transition-opacity", message.streaming ? "invisible" : "opacity-60 group-hover:opacity-100")}>
          <CopyAction text={message.text} />
        </div>
      </div>
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
