"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { applySessionEvent, applyStreamDelta } from "../model/events";
import type { AgentId, ApprovalDecision, PairingInfo, ProviderConfig, SessionSnapshot, SessionSummary } from "../model/types";
import type { AgentHubClient } from "./types";

const ClientContext = createContext<AgentHubClient | null>(null);

export function ClientProvider({ client, children }: { client: AgentHubClient; children: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient() {
  const client = useContext(ClientContext);
  if (!client) throw new Error("useClient must be used inside <ClientProvider>");
  return client;
}

export const queryKeys = {
  agents: ["agents"] as const,
  models: (agentId: string) => ["models", agentId] as const,
  pairing: ["pairing"] as const,
  providers: ["providers"] as const,
  projects: ["projects"] as const,
  sessions: (projectId?: string) => ["sessions", projectId ?? "all"] as const,
  session: (sessionId: string) => ["session", sessionId] as const,
  diff: (sessionId: string, path: string) => ["diff", sessionId, path] as const,
  devices: ["devices"] as const,
  activity: ["activity"] as const,
};

export function useConnection() {
  const client = useClient();
  return useSyncExternalStore(
    (onChange) => client.onConnectionChange(onChange),
    () => client.getConnection(),
    () => client.getConnection(),
  );
}

/**
 * Refetches everything once the client reconnects after being offline, so
 * screens that failed while the runtime was down recover on their own.
 * Render inside both ClientProvider and QueryClientProvider.
 */
export function RefetchOnReconnect() {
  const { status } = useConnection();
  const queryClient = useQueryClient();
  const wasOffline = useRef(false);
  useEffect(() => {
    if (status === "disconnected" || status === "reconnecting") wasOffline.current = true;
    else if (status === "connected" && wasOffline.current) {
      wasOffline.current = false;
      void queryClient.invalidateQueries();
    }
  }, [status, queryClient]);
  return null;
}

export function useAgents() {
  const client = useClient();
  return useQuery({ queryKey: queryKeys.agents, queryFn: () => client.listAgents(), staleTime: 60_000 });
}

export function useProviders() {
  const client = useClient();
  return useQuery({ queryKey: queryKeys.providers, queryFn: () => client.listProviders() });
}

/** Re-runs provider detection (CLI install/sign-in) and refreshes the cache. */
export function useRefreshProviders() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.listProviders({ refresh: true }),
    onSuccess: (providers) => {
      queryClient.setQueryData(queryKeys.providers, providers);
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
      void queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });
}

export function useModels(agentId: AgentId | undefined, enabled = true) {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.models(agentId ?? ""),
    queryFn: () => client.listModels(agentId!),
    enabled: Boolean(agentId) && enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useSetApiKey() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, apiKey }: { agentId: AgentId; apiKey: string | null }) =>
      apiKey ? client.setApiKey(agentId, apiKey) : client.clearApiKey(agentId),
    onSuccess: (provider) => {
      queryClient.setQueryData<ProviderConfig[]>(queryKeys.providers, (list) => list?.map((p) => (p.agentId === provider.agentId ? provider : p)));
      void queryClient.invalidateQueries({ queryKey: queryKeys.models(provider.agentId) });
    },
  });
}

export function usePairing(enabled = true) {
  const client = useClient();
  return useQuery({ queryKey: queryKeys.pairing, queryFn: () => client.getPairing(), enabled, refetchInterval: 10_000 });
}

export function usePairingActions() {
  const client = useClient();
  const queryClient = useQueryClient();
  const onSuccess = (info: PairingInfo) => queryClient.setQueryData(queryKeys.pairing, info);
  return {
    pair: useMutation({ mutationFn: (input: { controlPlaneUrl: string; code: string; deviceName?: string }) => client.pair(input), onSuccess }),
    update: useMutation({ mutationFn: (input: { allowRemoteControl: boolean }) => client.updatePairing(input), onSuccess }),
    unpair: useMutation({ mutationFn: () => client.unpair(), onSuccess }),
  };
}

export function useProjects() {
  const client = useClient();
  return useQuery({ queryKey: queryKeys.projects, queryFn: () => client.listProjects() });
}

export function useSessions(projectId?: string) {
  const client = useClient();
  return useQuery({ queryKey: queryKeys.sessions(projectId), queryFn: () => client.listSessions({ projectId }) });
}

export function useDevices() {
  const client = useClient();
  return useQuery({ queryKey: queryKeys.devices, queryFn: () => client.listDevices(), refetchInterval: 30_000 });
}

export function useActivity() {
  const client = useClient();
  return useQuery({ queryKey: queryKeys.activity, queryFn: () => client.listActivity(), refetchInterval: 30_000 });
}

export function useDiff(sessionId: string | undefined, path: string | undefined) {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.diff(sessionId ?? "", path ?? ""),
    queryFn: () => client.getDiff(sessionId!, path!),
    enabled: Boolean(sessionId && path),
  });
}

/**
 * Loads a session snapshot, then folds live events into the query cache.
 * The subscription resumes from the snapshot's `lastSeq`; the reducer drops
 * any replayed events, so reconnects are idempotent.
 */
export function useSessionStream(sessionId: string | undefined) {
  const client = useClient();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.session(sessionId ?? ""),
    queryFn: () => client.getSession(sessionId!),
    enabled: Boolean(sessionId),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const ready = query.data !== undefined;

  useEffect(() => {
    if (!sessionId || !ready) return;
    const afterSeq = queryClient.getQueryData<SessionSnapshot>(queryKeys.session(sessionId))?.lastSeq ?? 0;
    const onDelta = (delta: Parameters<typeof applyStreamDelta>[1]) =>
      queryClient.setQueryData<SessionSnapshot>(queryKeys.session(sessionId), (prev) => (prev ? applyStreamDelta(prev, delta) : prev));
    return client.subscribe(sessionId, afterSeq, (event) => {
      let updated: SessionSummary | undefined;
      queryClient.setQueryData<SessionSnapshot>(queryKeys.session(sessionId), (prev) => {
        if (!prev) return prev;
        const next = applySessionEvent(prev, event);
        // Status and message count changes (including inside a batch) update the summary.
        if (next.session !== prev.session) updated = next.session;
        return next;
      });
      if (updated) {
        const summary = updated;
        queryClient.setQueriesData<SessionSummary[]>({ queryKey: ["sessions"] }, (list) =>
          list?.map((s) => (s.id === summary.id ? summary : s)),
        );
      }
    }, onDelta);
  }, [client, queryClient, sessionId, ready]);

  return query;
}

export function useSendMessage(sessionId: string | undefined) {
  const client = useClient();
  return useMutation({ mutationFn: (text: string) => client.sendMessage(sessionId!, text) });
}

export function useCancelRun(sessionId: string | undefined) {
  const client = useClient();
  return useMutation({ mutationFn: () => client.cancelRun(sessionId!) });
}

export function useResolveApproval(sessionId: string | undefined) {
  const client = useClient();
  return useMutation({
    mutationFn: ({ approvalId, decision }: { approvalId: string; decision: ApprovalDecision }) =>
      client.resolveApproval(sessionId!, approvalId, decision),
  });
}

export function useCreateSession() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; agentId: AgentId; model?: string; prompt: string }) => client.createSession(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

export function useAddProject() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => client.addProject(path),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
  });
}