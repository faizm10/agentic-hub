"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ApprovalPolicy, IntegrationAction, Job } from "@agentic-hub/types";
import { queryKeys, useClient } from "./react";

export const workspaceKeys = {
  environment: ["environment"] as const,
  approvalPolicy: ["approvalPolicy"] as const,
  integrations: ["integrations"] as const,
  githubRepos: ["githubRepos"] as const,
  files: (projectId: string, sessionId: string | undefined, path: string) => ["files", projectId, sessionId ?? "main", path] as const,
  file: (projectId: string, sessionId: string | undefined, path: string) => ["file", projectId, sessionId ?? "main", path] as const,
  jobs: (projectId?: string) => ["jobs", projectId ?? "all"] as const,
  github: (projectId: string, sessionId?: string) => ["github", projectId, sessionId ?? "main"] as const,
  vercel: (projectId: string, sessionId?: string) => ["vercel", projectId, sessionId ?? "main"] as const,
};

export function useEnvironment(enabled = true) {
  const client = useClient();
  return useQuery({ queryKey: workspaceKeys.environment, queryFn: () => client.getEnvironment(), enabled, staleTime: 30_000 });
}

export function useRefreshEnvironment() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.getEnvironment({ refresh: true }),
    onSuccess: (report) => {
      queryClient.setQueryData(workspaceKeys.environment, report);
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers });
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.integrations });
    },
  });
}

export function useApprovalPolicy(enabled = true) {
  const client = useClient();
  return useQuery({ queryKey: workspaceKeys.approvalPolicy, queryFn: () => client.getApprovalPolicy(), enabled });
}

export function useSetApprovalPolicy() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (policy: ApprovalPolicy) => client.setApprovalPolicy(policy),
    onSuccess: (policy) => {
      queryClient.setQueryData(workspaceKeys.approvalPolicy, policy);
      queryClient.setQueryData(queryKeys.autoApprove, policy.mode === "trusted");
    },
  });
}

export function useIntegrations(enabled = true) {
  const client = useClient();
  return useQuery({ queryKey: workspaceKeys.integrations, queryFn: () => client.listIntegrations(), enabled, staleTime: 60_000 });
}

export function useGitHubRepositories(enabled = true) {
  const client = useClient();
  return useQuery({ queryKey: workspaceKeys.githubRepos, queryFn: () => client.listGitHubRepositories(), enabled, staleTime: 60_000, retry: false });
}

export function useCloneRepository() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repository, directory }: { repository: string; directory?: string }) => client.cloneRepository(repository, directory),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
  });
}

export function useFiles(projectId: string | undefined, path: string, sessionId?: string, enabled = true) {
  const client = useClient();
  return useQuery({
    queryKey: workspaceKeys.files(projectId ?? "", sessionId, path),
    queryFn: () => client.listFiles(projectId!, path, sessionId),
    enabled: Boolean(projectId) && enabled,
    staleTime: 5_000,
  });
}

export function useFileContent(projectId: string | undefined, path: string | undefined, sessionId?: string) {
  const client = useClient();
  return useQuery({
    queryKey: workspaceKeys.file(projectId ?? "", sessionId, path ?? ""),
    queryFn: () => client.readFile(projectId!, path!, sessionId),
    enabled: Boolean(projectId && path),
    staleTime: Infinity,
  });
}

export function useWriteFile(projectId: string | undefined, sessionId?: string) {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) => client.writeFile(projectId!, path, content, sessionId),
    onSuccess: (file) => {
      queryClient.setQueryData(workspaceKeys.file(projectId ?? "", sessionId, file.path), file);
      void queryClient.invalidateQueries({ queryKey: ["files", projectId ?? ""] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });
}

/** Jobs for a project. Polls while any job is running, so the feed stays live. */
export function useJobs(projectId: string | undefined, enabled = true) {
  const client = useClient();
  return useQuery({
    queryKey: workspaceKeys.jobs(projectId),
    queryFn: () => client.listJobs(projectId),
    enabled: Boolean(projectId) && enabled,
    refetchInterval: (query) => (query.state.data?.some((job) => job.status === "running") ? 1_500 : 10_000),
  });
}

export function useRunCommand(projectId: string | undefined, sessionId?: string) {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: string) => client.runCommand(projectId!, command, sessionId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: workspaceKeys.jobs(projectId) }),
  });
}

export function useCancelJob(projectId: string | undefined) {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => client.cancelJob(jobId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: workspaceKeys.jobs(projectId) }),
  });
}

/** Full, live output of one job, streamed from the runtime. */
export function useJobOutput(jobId: string | undefined) {
  const client = useClient();
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ jobId?: string; output: string; job?: Job; error?: string }>({ output: "" });
  useEffect(() => {
    if (!jobId) return;
    // State from a previous job is ignored below (keyed by jobId), so no reset is needed.
    let output = "";
    return client.streamJob(jobId, {
      onOutput: (chunk) => {
        output += chunk;
        setState((s) => ({ ...s, jobId, output }));
      },
      onDone: (job) => {
        setState((s) => ({ ...s, jobId, job, output: output || job.output }));
        void queryClient.invalidateQueries({ queryKey: ["jobs"] });
        void queryClient.invalidateQueries({ queryKey: ["files"] });
        void queryClient.invalidateQueries({ queryKey: ["github"] });
        void queryClient.invalidateQueries({ queryKey: ["vercel"] });
      },
      onError: (error) => setState((s) => ({ ...s, jobId, error: error instanceof Error ? error.message : String(error) })),
    });
  }, [client, jobId, queryClient]);
  return state.jobId === jobId ? state : { output: "" };
}

export function useGitHubOverview(projectId: string | undefined, sessionId?: string, enabled = true) {
  const client = useClient();
  return useQuery({ queryKey: workspaceKeys.github(projectId ?? "", sessionId), queryFn: () => client.getGitHubOverview(projectId!, sessionId), enabled: Boolean(projectId) && enabled, staleTime: 30_000 });
}

export function useVercelOverview(projectId: string | undefined, sessionId?: string, enabled = true) {
  const client = useClient();
  return useQuery({
    queryKey: workspaceKeys.vercel(projectId ?? "", sessionId),
    queryFn: () => client.getVercelOverview(projectId!, sessionId),
    enabled: Boolean(projectId) && enabled,
    staleTime: 15_000,
    // Deployments in progress change quickly.
    refetchInterval: (query) => (query.state.data?.deployments.some((d) => ["BUILDING", "QUEUED", "INITIALIZING"].includes(d.state)) ? 5_000 : false),
  });
}

export function useIntegrationAction(projectId: string | undefined, sessionId?: string) {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, confirm }: { input: IntegrationAction; confirm?: boolean }) => client.runIntegrationAction(projectId!, input, { confirm, sessionId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.jobs(projectId) });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });
}

export function useUsage(days: number, enabled = true) {
  const client = useClient();
  return useQuery({ queryKey: ["usage", days], queryFn: () => client.getUsage({ days }), enabled, staleTime: 30_000, refetchInterval: 60_000 });
}

/**
 * Starts the same prompt with several agents at once. Coding agents each get
 * their own worktree (when `isolate`) so they never edit the same checkout.
 * Sessions share a group id; failures are reported per agent.
 */
export function useStartMultiAgent() {
  const client = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { projectId: string; prompt: string; agents: { agentId: import("../model/types").AgentId; model?: string; kind: "agent" | "model" }[]; isolate: boolean }) => {
      const groupId = crypto.randomUUID();
      const results = await Promise.allSettled(
        input.agents.map((a) =>
          client.createSession({ projectId: input.projectId, agentId: a.agentId, model: a.model, prompt: input.prompt, groupId, isolation: a.kind === "agent" && input.isolate ? "worktree" : "none" }),
        ),
      );
      const sessions = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const failures = results.flatMap((r, i) => (r.status === "rejected" ? [{ agentId: input.agents[i]!.agentId, message: r.reason instanceof Error ? r.reason.message : String(r.reason) }] : []));
      return { groupId, sessions, failures };
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });
}
