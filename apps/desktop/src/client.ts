import { createUnavailableClient, type AgentHubClient } from "@agentic-hub/ui/client";
import { createDemoClient } from "@agentic-hub/ui/fixtures";
import type { DataMode } from "./state/app-state";

/**
 * Chooses the data source. "live" will construct the runtime client once
 * the backend contract is integrated (see README → Backend integration);
 * until then it reports an honest disconnected state.
 */
export function createClient(mode: DataMode): AgentHubClient {
  if (mode === "demo") return createDemoClient();
  return createUnavailableClient({
    label: "Local runtime",
    detail: "This build can't reach a local runtime yet. Runtime integration lands with the backend contract.",
  });
}
