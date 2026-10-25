import { ThemeProvider, TooltipProvider } from "@agentic-hub/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppStateProvider } from "./state/app-state";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={350}>
        <AppStateProvider>
          <App />
        </AppStateProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
