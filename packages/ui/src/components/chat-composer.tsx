"use client";

import { ArrowUp, Square } from "lucide-react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button } from "../primitives/button";
import { Kbd } from "../primitives/kbd";
import { Tooltip } from "../primitives/tooltip";

export interface ChatComposerHandle {
  focus: () => void;
}

export interface ChatComposerProps {
  onSubmit: (text: string) => Promise<unknown> | void;
  onCancel?: () => void;
  /** A run is in progress; the primary button becomes Stop. */
  running?: boolean;
  cancelling?: boolean;
  /** Disable input entirely and show why. */
  disabledReason?: string;
  placeholder?: string;
  /** Left-side toolbar, e.g. the AgentSelector. */
  toolbar?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(
  { onSubmit, onCancel, running, cancelling, disabledReason, placeholder = "Ask the agent to change something…", toolbar, footer, className },
  ref,
) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  const disabled = Boolean(disabledReason);
  const canSend = !disabled && !running && !submitting && value.trim().length > 0;

  const submit = async () => {
    if (!canSend) return;
    const text = value.trim();
    setSubmitting(true);
    try {
      await onSubmit(text);
      setValue("");
    } catch {
      // Keep the draft so nothing is lost; the caller surfaces the error.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={cn("mx-auto w-full max-w-[52rem] px-5 pb-4", className)}>
      <div
        className={cn(
          "rounded-xl border border-border bg-surface shadow-md transition-[border-color,box-shadow] focus-within:border-border-strong focus-within:shadow-lg",
          disabled && "opacity-70",
        )}
      >
        <label htmlFor="agent-prompt" className="sr-only">
          Message the agent
        </label>
        <textarea
          id="agent-prompt"
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={disabledReason ?? placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          className="block max-h-60 min-h-[52px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3.5 text-base leading-relaxed text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">{toolbar}</div>
          {running ? (
            <Tooltip content={cancelling ? "Cancelling…" : "Stop run"} shortcut="mod+.">
              <Button
                variant="secondary"
                size="icon"
                onClick={onCancel}
                disabled={!onCancel || cancelling}
                aria-label="Stop run"
                className="rounded-lg"
              >
                <Square className="fill-current !size-3" />
              </Button>
            </Tooltip>
          ) : (
            <Tooltip content="Send" shortcut="enter">
              <Button variant="primary" size="icon" onClick={() => void submit()} disabled={!canSend} aria-label="Send message" className="rounded-lg">
                <ArrowUp />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex min-h-4 items-center justify-between gap-3 px-1 text-2xs text-fg-subtle">
        <div className="min-w-0 truncate">{footer}</div>
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          <Kbd keys="shift+enter" /> newline
        </div>
      </div>
    </div>
  );
});