"use client";

import { CircleAlert, RefreshCw, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button } from "../primitives/button";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-16", className)}>
      {icon ? (
        <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface-2 text-fg-subtle [&_svg]:size-4">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description ? <p className="mx-auto max-w-sm text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
  compact,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <EmptyState
      className={className}
      compact={compact}
      icon={<CircleAlert className="text-danger" />}
      title={title}
      description={message}
      action={
        onRetry ? (
          <Button size="sm" onClick={onRetry}>
            <RefreshCw /> Try again
          </Button>
        ) : null
      }
    />
  );
}

export function DisconnectedState({
  title = "Runtime not connected",
  detail,
  onRetry,
  action,
  className,
}: {
  title?: string;
  detail?: ReactNode;
  onRetry?: () => void;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <EmptyState
      className={className}
      icon={<WifiOff />}
      title={title}
      description={detail}
      action={
        <>
          {onRetry ? (
            <Button size="sm" onClick={onRetry}>
              <RefreshCw /> Retry
            </Button>
          ) : null}
          {action}
        </>
      }
    />
  );
}