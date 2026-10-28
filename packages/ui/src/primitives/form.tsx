"use client";

import { Switch as RadixSwitch, Tabs as RadixTabs } from "radix-ui";
import { forwardRef, type ComponentProps, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Switch({ className, ...props }: ComponentProps<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root
      className={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-surface-3 transition-colors focus-ring data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[15px]" />
    </RadixSwitch.Root>
  );
}

export const Tabs = RadixTabs.Root;
export const TabsContent = RadixTabs.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={cn("flex items-center gap-0.5", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-fg-subtle transition-colors hover:text-fg focus-ring data-[state=active]:bg-surface-3 data-[state=active]:text-fg [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-md border border-border bg-surface-2 p-0.5", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium text-fg-muted transition-colors focus-ring [&_svg]:size-3.5",
            value === option.value ? "bg-surface text-fg shadow-sm" : "hover:text-fg",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}