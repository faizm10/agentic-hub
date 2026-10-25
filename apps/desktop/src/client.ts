import { createRuntimeClient, type AgentHubClient } from "@agentic-hub/ui/client";
import { createDemoClient } from "@agentic-hub/ui/fixtures";
import { isTauri } from "./platform/native";
import { TAURI_RUNTIME_BASE, tauriFetch } from "./platform/tauri-fetch";
import type { DataMode } from "./state/app-state";

/**
 * Chooses the data source.
 * - Native app: the runtime the app supervises, through the IPC bridge.
 * - Browser preview (`pnpm dev:desktop`): the same-origin `/runtime` bridge
 *   served by Vite (runtime-bridge.ts), against `pnpm runtime:start`.
 * In both cases the runtime's bearer token stays outside page script.
 */
export function createClient(mode: DataMode): AgentHubClient {
  if (mode === "demo") return createDemoClient();
  if (isTauri()) return createRuntimeClient({ baseUrl: TAURI_RUNTIME_BASE, fetch: tauriFetch, label: "Local runtime", retryMs: 2_000 });
  return createRuntimeClient({ baseUrl: "/runtime", label: "Local runtime" });
}
