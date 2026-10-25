"use client";

import { Dialog as RadixDialog } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;
export const DialogTitle = RadixDialog.Title;
export const DialogDescription = RadixDialog.Description;

export function DialogContent({
  className,
  children,
  overlayClassName,
  ...props
}: ComponentProps<typeof RadixDialog.Content> & { overlayClassName?: string; children: ReactNode }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          overlayClassName,
        )}
      />
      <RadixDialog.Content
        className={cn(
          "fixed left-1/2 top-[14vh] z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-xl border border-border bg-elevated text-fg shadow-lg outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[state=open]:slide-in-from-top-1",
          className,
        )}
        {...props}
      >
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}