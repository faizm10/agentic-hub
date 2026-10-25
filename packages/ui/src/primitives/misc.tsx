"use client";

import { Collapsible as RadixCollapsible } from "radix-ui";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export const Collapsible = RadixCollapsible.Root;
export const CollapsibleTrigger = RadixCollapsible.Trigger;
export const CollapsibleContent = RadixCollapsible.Content;

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("skeleton h-3", className)} {...props} />;
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div role="separator" aria-orientation={vertical ? "vertical" : "horizontal"} className={cn(vertical ? "w-px self-stretch bg-border" : "h-px w-full bg-border", className)} />;
}

export function SectionLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-2xs font-medium uppercase tracking-[0.06em] text-fg-subtle", className)} {...props} />;
}