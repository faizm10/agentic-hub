"use client";

import { ThemeProvider, TooltipProvider } from "@agentic-hub/ui";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={350}>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
