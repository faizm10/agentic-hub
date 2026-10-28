"use client";

import { Bug, FileSearch, ListChecks, MessageSquareText, Sparkles, TestTube2 } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentKind } from "../model/types";
import { cn } from "../lib/cn";

const SUGGESTIONS: Record<AgentKind, { icon: ReactNode; label: string; prompt: string }[]> = {
  agent: [
    { icon: <FileSearch />, label: "Explain this codebase", prompt: "Give me a tour of this repository: its structure, main entry points and how the pieces fit together." },
    { icon: <Bug />, label: "Find and fix a bug", prompt: "Look for a likely bug in this project, explain it, and propose a minimal fix." },
    { icon: <TestTube2 />, label: "Add missing tests", prompt: "Find an important module without good test coverage and add focused tests for it." },
    { icon: <ListChecks />, label: "Review my changes", prompt: "Review the uncommitted changes in this repository for correctness and style issues." },
  ],
  model: [
    { icon: <MessageSquareText />, label: "Explain a topic", prompt: "Explain a topic I ask about in clear, simple terms with an example." },
    { icon: <Sparkles />, label: "Brainstorm ideas", prompt: "Help me brainstorm ideas for a project. Ask a few questions to understand what I need." },
    { icon: <ListChecks />, label: "Make a plan", prompt: "Help me turn a goal into a practical step-by-step plan." },
    { icon: <FileSearch />, label: "Improve my writing", prompt: "I'll paste a draft. Help me make it clearer while keeping my voice." },
  ],
};

/** Empty-conversation greeting with prompt starters that fill the composer. */
export function NewChatHero({
  title = "What should we build today?",
  subtitle,
  kind,
  onSuggestion,
  className,
}: {
  title?: string;
  subtitle?: ReactNode;
  kind: AgentKind;
  onSuggestion?: (prompt: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[48rem] px-4 sm:px-6", className)}>
      <h1 className="text-center text-[1.75rem] font-semibold tracking-[-0.025em] text-fg sm:text-[2rem]">{title}</h1>
      {subtitle ? <div className="mt-2 flex justify-center text-sm text-fg-muted">{subtitle}</div> : null}
      {onSuggestion ? (
        <div className="mt-8 grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS[kind].map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => onSuggestion(s.prompt)}
              className="group flex items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left transition-all hover:-translate-y-px hover:border-border-strong hover:shadow-sm focus-ring"
            >
              <span className="mt-0.5 text-fg-subtle transition-colors group-hover:text-fg [&_svg]:size-4">{s.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">{s.label}</span>
                <span className="line-clamp-1 text-xs text-fg-subtle">{s.prompt}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
