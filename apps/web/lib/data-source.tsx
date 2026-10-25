"use client";

import { ClientProvider, createUnavailableClient, type AgentHubClient } from "@agentic-hub/ui/client";
import { createDemoClient } from "@agentic-hub/ui/fixtures";
import { safeStorage } from "@agentic-hub/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type WebDataSource = "control-plane" | "demo";

const KEY = "agentic-hub.web.source";
const listeners = new Set<() => void>();

function read(): WebDataSource {
  return safeStorage.get<WebDataSource>(KEY, "control-plane");
}

/**
 * The browser never talks to a local runtime directly: the runtime API
 * (docs/API_CONTRACT.md) is loopback-only, has no CORS, and requires an
 * explicitly paired bridge for web clients. Until that bridge/control plane
 * exists the live client reports "disconnected" and every remote action
 * stays disabled. Demo mode is opt-in and labeled everywhere.
 */
function createWebClient(source: WebDataSource): AgentHubClient {
  if (source === "demo") return createDemoClient();
  return createUnavailableClient({
    label: "Control plane",
    detail:
      "No paired control plane is configured for this dashboard yet, so devices and sessions can't be shown. Use the desktop app to work with the local runtime.",
  });
}

const Ctx = createContext<{ source: WebDataSource; setSource: (s: WebDataSource) => void } | null>(null);

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const source = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "control-plane" as const,
  );
  const setSource = useCallback((next: WebDataSource) => {
    safeStorage.set(KEY, next);
    listeners.forEach((l) => l());
  }, []);

  const { client, queryClient } = useMemo(
    () => ({
      client: createWebClient(source),
      queryClient: new QueryClient({
        defaultOptions: {
          queries: { retry: (n, e) => (e as { code?: string })?.code !== "RUNTIME_UNAVAILABLE" && n < 2, refetchOnWindowFocus: false },
        },
      }),
    }),
    [source],
  );
  const value = useMemo(() => ({ source, setSource }), [source, setSource]);

  return (
    <Ctx.Provider value={value}>
      {/* Keyed remount: query observers bind to the client they were created with. */}
      <ClientProvider client={client} key={source}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ClientProvider>
    </Ctx.Provider>
  );
}

export function useDataSource() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDataSource outside provider");
  return v;
}

export const REMOTE_UNAVAILABLE = "Remote actions need an authenticated control plane, which isn't connected.";
