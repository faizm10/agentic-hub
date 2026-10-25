"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 font-medium [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-surface-3 text-fg-muted",
        accent: "bg-accent-soft text-accent",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
        info: "bg-info-soft text-info",
        outline: "border border-border text-fg-muted",
      },
      size: { sm: "h-[18px] text-2xs", md: "h-5 text-xs" },
    },
    defaultVariants: { tone: "neutral", size: "sm" },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}