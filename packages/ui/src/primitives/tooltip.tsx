"use client";

import { Tooltip as RadixTooltip } from "radix-ui";
import type { ReactNode } from "react";
import { Kbd } from "./kbd";

export const TooltipProvider = RadixTooltip.Provider;

export function Tooltip({
  content,
  shortcut,
  side = "bottom",
  children,
}: {
  content: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  return (
    <RadixTooltip.Root delayDuration={350}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-fg shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        >
          {content}
          {shortcut ? <Kbd keys={shortcut} /> : null}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}