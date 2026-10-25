"use client";

import { ThemeProvider, TooltipProvider } from "@agentic-hub/ui";
import type { ReactNode } from "react";
import { DataSourceProvider } from "@/lib/data-source";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={350}>
        <DataSourceProvider>{children}</DataSourceProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
