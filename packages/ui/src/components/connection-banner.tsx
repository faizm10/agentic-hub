"use client";

import { FlaskConical, RefreshCw, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import type { ConnectionInfo } from "../model/types";
import { cn } from "../lib/cn";
import { Button } from "../primitives/button";

/**
 * Persistent strip that states where data comes from. Demo mode is always
 * labeled; disconnected/reconnecting states are surfaced with a retry.
 */
export function ConnectionBanner({
  connection,
  onRetry,
  action,
  className,
}: {
  connection: ConnectionInfo;
  onRetry?: () => void;
  action?: ReactNode;
  className?: string;
}) {
  if (connection.status === "connected" || connection.status === "connecting") return null;
  const demo = connection.status === "demo";
  const reconnecting = connection.status === "reconnecting";
  return (
    <div
      role="status"
      className={cn(
        "flex min-h-8 items-center gap-2 border-b px-3 text-xs",
        demo && "border-info/20 bg-info-soft text-info",
        reconnecting && "border-warning/25 bg-warning-soft text-warning",
        connection.status === "disconnected" && "border-danger/20 bg-danger-soft text-danger",
        className,
      )}
    >
      {demo ? <FlaskConical className="size-3.5 shrink-0" /> : reconnecting ? <RefreshCw className="size-3.5 shrink-0 animate-spin" /> : <WifiOff className="size-3.5 shrink-0" />}
      <span className="shrink-0 whitespace-nowrap font-semibold">{demo ? "Demo mode" : reconnecting ? "Reconnecting" : "Disconnected"}</span>
      <span className="min-w-0 truncate text-fg-muted">
        {demo ? "Sample fixture data — no agents are running and nothing on disk is changed." : connection.detail}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {action}
        {!demo && onRetry ? (
          <Button size="xs" variant="ghost" onClick={onRetry} className="text-current hover:text-current">
            Retry now
          </Button>
        ) : null}
      </div>
    </div>
  );
}