import { ClientProvider } from "@agentic-hub/ui/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";
import { createClient } from "./client";
import { Shell } from "./Shell";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { useAppState } from "./state/app-state";

export function App() {
  const { prefs, view } = useAppState();

  // A fresh client + cache per data source, so demo data never leaks into live mode.
  const { client, queryClient } = useMemo(
    () => ({
      client: createClient(prefs.dataMode),
      queryClient: new QueryClient({
        defaultOptions: {
          queries: { retry: (count, error) => (error as { code?: string })?.code !== "RUNTIME_UNAVAILABLE" && count < 2, refetchOnWindowFocus: false },
        },
      }),
    }),
    [prefs.dataMode],
  );

  return (
    // Keyed remount: query observers bind to the client they were created with.
    <ClientProvider client={client} key={prefs.dataMode}>
      <QueryClientProvider client={queryClient}>{view === "welcome" ? <WelcomeScreen /> : <Shell />}</QueryClientProvider>
    </ClientProvider>
  );
}
