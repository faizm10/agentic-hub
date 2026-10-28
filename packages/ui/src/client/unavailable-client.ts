import type { ConnectionInfo } from "../model/types";
import { RuntimeUnavailableError } from "./errors";
import type { AgentHubClient } from "./types";

/**
 * Live-mode client used until the backend contract is integrated or when the
 * runtime/control plane cannot be reached. Every data call rejects with
 * RuntimeUnavailableError so the UI renders honest disconnected states
 * instead of fabricated data.
 */
export function createUnavailableClient(options: { label: string; detail: string }): AgentHubClient {
  const info: ConnectionInfo = { status: "disconnected", detail: options.detail };
  const reject = () => Promise.reject(new RuntimeUnavailableError(options.detail));
  return {
    mode: "live",
    label: options.label,
    getConnection: () => info,
    onConnectionChange: () => () => {},
    reconnect: () => {},
    listAgents: reject,
    listProviders: reject,
    listModels: reject,
    setApiKey: reject,
    clearApiKey: reject,
    getPairing: reject,
    pair: reject,
    updatePairing: reject,
    unpair: reject,
    listProjects: reject,
    addProject: reject,
    listSessions: reject,
    getSession: reject,
    createSession: reject,
    sendMessage: reject,
    listQueuedMessages: reject,
    removeQueuedMessage: reject,
    getAutoApprove: reject,
    setAutoApprove: reject,
    getDeveloperActivity: reject,
    updateRepository: reject,
    getIdeUpdate: reject,
    openIdeUpdate: reject,
    cancelRun: reject,
    resolveApproval: reject,
    getDiff: reject,
    subscribe: () => () => {},
    listDevices: reject,
    listActivity: reject,
    remoteActionsAvailable: () => false,
  };
}
