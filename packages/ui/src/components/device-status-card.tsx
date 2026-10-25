"use client";

import { Laptop, LockKeyhole, Monitor, Play, Server } from "lucide-react";
import type { Device } from "../model/types";
import { cn } from "../lib/cn";
import { formatRelative } from "../lib/format";
import { Button } from "../primitives/button";
import { Tooltip } from "../primitives/tooltip";

const PLATFORM_ICON = { macos: Laptop, windows: Monitor, linux: Server } as const;
const PLATFORM_LABEL = { macos: "macOS", windows: "Windows", linux: "Linux" } as const;

export function DeviceStatusCard({
  device,
  remoteActionsUnavailableReason,
  onStartSession,
  className,
}: {
  device: Device;
  /** Remote actions stay disabled unless an authorized control plane is connected. */
  remoteActionsUnavailableReason?: string;
  onStartSession?: (deviceId: string) => void;
  className?: string;
}) {
  const Icon = PLATFORM_ICON[device.platform];
  const online = device.status === "online";
  const disabledReason = !online ? "Device is offline" : remoteActionsUnavailableReason;
  return (
    <article
      aria-label={`${device.name}, ${online ? "online" : "offline"}`}
      className={cn("flex flex-col rounded-xl border border-border bg-surface p-4", !online && "bg-surface/60", className)}
    >
      <div className="flex items-start gap-3">
        <div className={cn("flex size-9 items-center justify-center rounded-lg border border-border bg-surface-2", online ? "text-fg" : "text-fg-subtle")}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-fg">{device.name}</h3>
          <p className="text-xs text-fg-subtle">
            {PLATFORM_LABEL[device.platform]}
            {device.runtimeVersion ? ` · runtime ${device.runtimeVersion}` : ""}
          </p>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", online ? "text-success" : "text-fg-subtle")}>
          <span className={cn("size-1.5 rounded-full", online ? "bg-success" : "bg-fg-subtle")} />
          {online ? "Online" : "Offline"}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-fg-subtle">Projects</dt>
          <dd className="mt-0.5 text-base font-medium tabular-nums text-fg">{device.projectCount}</dd>
        </div>
        <div>
          <dt className="text-fg-subtle">Active</dt>
          <dd className="mt-0.5 text-base font-medium tabular-nums text-fg">{device.activeSessionCount}</dd>
        </div>
        <div>
          <dt className="text-fg-subtle">Last seen</dt>
          <dd className="mt-0.5 text-sm text-fg">{online ? "now" : formatRelative(device.lastSeenAt)}</dd>
        </div>
      </dl>
      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
        <Tooltip content={disabledReason ?? "Start a session on this device"}>
          <span>
            <Button size="sm" variant="secondary" disabled={Boolean(disabledReason) || !onStartSession} onClick={() => onStartSession?.(device.id)}>
              <Play /> Start session
            </Button>
          </span>
        </Tooltip>
        {disabledReason && online ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-2xs text-fg-subtle">
            <LockKeyhole className="size-3 shrink-0" />
            <span className="truncate">Remote control unavailable</span>
          </span>
        ) : null}
      </div>
    </article>
  );
}