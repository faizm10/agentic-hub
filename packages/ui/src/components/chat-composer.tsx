"use client";

import { ArrowUp, Square } from "lucide-react";
import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button } from "../primitives/button";
import { Kbd } from "../primitives/kbd";
import { Tooltip } from "../primitives/tooltip";

export interface ChatComposerHandle {
  focus: () => void;
  /** Replace the draft, e.g. from a suggestion. */
  setText: (text: string) => void;
}

export interface ChatComposerProps {
  onSubmit: (text: string) => Promise<unknown> | void;
  onCancel?: () => void;
  /** A run is in progress; the primary button becomes Stop. */
  running?: boolean;
  /** Keep the send button available while a run is active; the backend queues the message. */
  queueWhileRunning?: boolean;
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
  { onSubmit, onCancel, running, queueWhileRunning, cancelling, disabledReason, placeholder = "Ask the agent to change something…", toolbar, footer, className },
  ref,
) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => textareaRef.current?.focus(),
      setText: (text: string) => {
        setValue(text);
        requestAnimationFrame(() => textareaRef.current?.focus());
      },
    }),
    [],
  );

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  const disabled = Boolean(disabledReason);
  // With queueing, a message can be sent while the previous send is still in flight.
  const canSend = !disabled && (!running || queueWhileRunning) && (queueWhileRunning || !submitting) && value.trim().length > 0;
  /** Serializes sends so messages typed quickly arrive (and queue) in order. */
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const submit = async () => {
    if (!canSend) return;
    const text = value.trim();
    // Clear right away so the next message can be typed; restore on failure.
    setValue("");
    setSubmitting(true);
    const attempt = chain.current.then(() => onSubmit(text));
    chain.current = attempt.catch(() => {});
    try {
      await attempt;
    } catch {
      // Keep the draft so nothing is lost; the caller surfaces the error.
      setValue((current) => (current.trim() ? current : text));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={cn("mx-auto w-full max-w-[48rem] px-3 pb-3 sm:px-6 sm:pb-4", className)}>
      <div
        className={cn(
          "rounded-[1.6rem] border border-border bg-surface shadow-md transition-[border-color,box-shadow] focus-within:border-border-strong focus-within:shadow-lg",
          disabled && "opacity-70",
        )}
      >
        <label htmlFor={inputId} className="sr-only">
          Message the agent
        </label>
        <textarea
          id={inputId}
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
          className="block max-h-60 min-h-[56px] w-full resize-none bg-transparent px-5 pb-1 pt-4 text-[0.9375rem] leading-relaxed text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-1">{toolbar}</div>
          {running ? (
            <Tooltip content={cancelling ? "Cancelling…" : "Stop run"} shortcut="mod+.">
              <Button
                variant="secondary"
                size="icon"
                onClick={onCancel}
                disabled={!onCancel || cancelling}
                aria-label="Stop run"
                className="size-8 rounded-full"
              >
                <Square className="fill-current !size-3" />
              </Button>
            </Tooltip>
          ) : null}
          {!running || queueWhileRunning ? (
            <Tooltip content={running ? "Queue message" : "Send"} shortcut="enter">
              <Button
                variant="primary"
                size="icon"
                onClick={() => void submit()}
                disabled={!canSend}
                aria-label={running ? "Queue message" : "Send message"}
                className="size-8 rounded-full bg-fg text-bg hover:bg-fg/85"
              >
                <ArrowUp />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex min-h-4 items-center justify-between gap-3 px-3 text-2xs text-fg-subtle">
        <div className="min-w-0 truncate">{footer}</div>
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          <Kbd keys="shift+enter" /> newline
        </div>
      </div>
    </div>
  );
});
