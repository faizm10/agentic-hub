import { createRuntimeClient, createUnavailableClient, type AgentHubClient } from "@agentic-hub/ui/client";
import { createDemoClient } from "@agentic-hub/ui/fixtures";
import { isTauri } from "./platform/native";
import type { DataMode } from "./state/app-state";

/**
 * Chooses the data source. Live mode talks to the local runtime through the
 * same-origin `/runtime` bridge served by the Vite dev/preview server (see
 * runtime-bridge.ts), which attaches the runtime's bearer token server-side.
 */
export function createClient(mode: DataMode): AgentHubClient {
  if (mode === "demo") return createDemoClient();
  // A packaged Tauri build serves assets from disk, so there is no bridge yet.
  if (isTauri() && !import.meta.env.DEV) {
    return createUnavailableClient({
      label: "Local runtime",
      detail:
        "Packaged builds can't launch or reach the runtime yet. Use `pnpm --filter @agentic-hub/desktop tauri:dev` with `pnpm runtime:start`.",
    });
  }
  return createRuntimeClient({ baseUrl: "/runtime", label: "Local runtime" });
}
