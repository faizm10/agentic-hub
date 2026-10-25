"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,color,border-color,box-shadow,transform] duration-150 focus-ring disabled:pointer-events-none disabled:opacity-45 active:translate-y-px [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg shadow-sm hover:bg-accent-hover",
        secondary: "border border-border bg-surface-2 text-fg hover:border-border-strong hover:bg-surface-3",
        ghost: "text-fg-muted hover:bg-surface-3 hover:text-fg",
        outline: "border border-border text-fg hover:bg-surface-2",
        danger: "bg-danger text-white shadow-sm hover:opacity-90",
        "danger-soft": "bg-danger-soft text-danger hover:bg-danger/20",
      },
      size: {
        xs: "h-6 px-2 text-xs",
        sm: "h-7 px-2.5 text-sm",
        md: "h-8 px-3 text-sm",
        lg: "h-9 px-4 text-base",
        icon: "size-7",
        "icon-sm": "size-6 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, type, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";