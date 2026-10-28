import type { AgentHubClient } from "./types";

type WorkspaceMethods = Pick<
  AgentHubClient,
  | "getEnvironment"
  | "getApprovalPolicy"
  | "setApprovalPolicy"
  | "listIntegrations"
  | "listGitHubRepositories"
  | "cloneRepository"
  | "listFiles"
  | "readFile"
  | "writeFile"
  | "runCommand"
  | "listJobs"
  | "getJob"
  | "cancelJob"
  | "streamJob"
  | "getGitHubOverview"
  | "getVercelOverview"
  | "runIntegrationAction"
>;

/** Workspace methods for clients that can't reach a local runtime: every call rejects with `error()`. */
export function unsupportedWorkspace(error: () => Error): WorkspaceMethods {
  const reject = () => Promise.reject(error());
  return {
    getEnvironment: reject,
    getApprovalPolicy: reject,
    setApprovalPolicy: reject,
    listIntegrations: reject,
    listGitHubRepositories: reject,
    cloneRepository: reject,
    listFiles: reject,
    readFile: reject,
    writeFile: reject,
    runCommand: reject,
    listJobs: () => Promise.resolve([]),
    getJob: reject,
    cancelJob: reject,
    streamJob: (_id, handlers) => {
      handlers.onError?.(error());
      return () => {};
    },
    getGitHubOverview: reject,
    getVercelOverview: reject,
    runIntegrationAction: reject,
  };
}
