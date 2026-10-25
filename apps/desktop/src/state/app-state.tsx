import { safeStorage, type AgentId } from "@agentic-hub/ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type View = "welcome" | "repositories" | "workspace" | "history" | "review" | "providers" | "settings";
export type DataMode = "demo" | "live";

export interface Preferences {
  onboarded: boolean;
  dataMode: DataMode;
  activeProjectId?: string;
  activeSessionId?: string;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  defaultAgent: AgentId;
  /** Last model picked per agent; unset means the provider default. */
  models: Partial<Record<AgentId, string>>;
}

const KEY = "agentic-hub.desktop.prefs.v2";
const DEFAULTS: Preferences = {
  onboarded: false,
  dataMode: "live",
  sidebarOpen: true,
  inspectorOpen: true,
  defaultAgent: "claude-code",
  models: {},
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
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<Preferences>(() => ({ ...DEFAULTS, ...safeStorage.get<Partial<Preferences>>(KEY, {}) }));
  const [view, setView] = useState<View>(() => (prefs.onboarded ? "workspace" : "welcome"));
  const [reviewPath, setReviewPath] = useState<string | undefined>();

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

  const value = useMemo(
    () => ({ prefs, setPrefs, view, navigate: setView, reviewPath, openReview, selectSession }),
    [prefs, setPrefs, view, reviewPath, openReview, selectSession],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppState outside provider");
  return v;
}
