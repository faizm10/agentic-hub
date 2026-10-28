import { safeStorage, type AgentId } from "@agentic-hub/ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type View = "welcome" | "repositories" | "workspace" | "code" | "board" | "usage" | "history" | "review" | "providers" | "settings";
export type DataMode = "demo" | "live";

export interface Preferences {
  onboarded: boolean;
  dataMode: DataMode;
  activeProjectId?: string;
  activeSessionId?: string;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  /** GitHub & Vercel panel on the right. */
  integrationsOpen: boolean;
  defaultAgent: AgentId;
  /** Last model picked per agent; unset means the provider default. */
  models: Partial<Record<AgentId, string>>;
  /** Terminal panel under the editor. */
  bottomPanelOpen: boolean;
  /** New coding-agent chats run in their own Git worktree. */
  isolateSessions: boolean;
  /** New chats start several agents at once. */
  multiAgent: boolean;
  multiAgents: AgentId[];
  /** Sessions shown side by side on the multi-agent board. */
  boardSessionIds: string[];
}

const KEY = "agentic-hub.desktop.prefs.v2";
const DEFAULTS: Preferences = {
  onboarded: false,
  dataMode: "live",
  sidebarOpen: true,
  inspectorOpen: true,
  integrationsOpen: false,
  defaultAgent: "claude-code",
  models: {},
  bottomPanelOpen: true,
  isolateSessions: false,
  multiAgent: false,
  multiAgents: ["claude-code", "codex"],
  boardSessionIds: [],
};

interface AppState {
  prefs: Preferences;
  setPrefs: (patch: Partial<Preferences>) => void;
  view: View;
  navigate: (view: View) => void;
  /** Path to preselect in the review screen. */
  reviewPath?: string;
  openReview: (path?: string) => void;
  selectSession: (sessionId: string | undefined, projectId?: string) => void;
  /** Opens a new chat in a project with the composer pre-filled (e.g. "work on issue #12"). */
  composeInNewChat: (projectId: string, prompt: string) => void;
  /** Pending composer text from `composeInNewChat`; consumed by the workspace. */
  draftPrompt?: string;
  consumeDraftPrompt: () => string | undefined;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<Preferences>(() => ({ ...DEFAULTS, ...safeStorage.get<Partial<Preferences>>(KEY, {}) }));
  const [view, setView] = useState<View>(() => (prefs.onboarded ? "workspace" : "welcome"));
  const [reviewPath, setReviewPath] = useState<string | undefined>();
  const [draftPrompt, setDraftPrompt] = useState<string | undefined>();

  useEffect(() => safeStorage.set(KEY, prefs), [prefs]);

  const setPrefs = useCallback((patch: Partial<Preferences>) => setPrefsState((p) => ({ ...p, ...patch })), []);
  const selectSession = useCallback(
    (sessionId: string | undefined, projectId?: string) => {
      setPrefsState((p) => ({ ...p, activeSessionId: sessionId, activeProjectId: projectId ?? p.activeProjectId }));
      setView("workspace");
    },
    [],
  );
  const openReview = useCallback((path?: string) => {
    setReviewPath(path);
    setView("review");
  }, []);

  const composeInNewChat = useCallback((projectId: string, prompt: string) => {
    setPrefsState((p) => ({ ...p, activeSessionId: undefined, activeProjectId: projectId }));
    setDraftPrompt(prompt);
    setView("workspace");
  }, []);
  const consumeDraftPrompt = useCallback(() => {
    const text = draftPrompt;
    if (text !== undefined) setDraftPrompt(undefined);
    return text;
  }, [draftPrompt]);

  const value = useMemo(
    () => ({ prefs, setPrefs, view, navigate: setView, reviewPath, openReview, selectSession, composeInNewChat, draftPrompt, consumeDraftPrompt }),
    [prefs, setPrefs, view, reviewPath, openReview, selectSession, composeInNewChat, draftPrompt, consumeDraftPrompt],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppState outside provider");
  return v;
}
