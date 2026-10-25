import {
  AGENT_ORDER,
  AppShell,
  Button,
  CommandPalette,
  ConnectionBanner,
  ProjectSidebar,
  SessionInspector,
  Tooltip,
  useMediaQuery,
  useShortcuts,
  useTheme,
  type PaletteCommand,
} from "@agentic-hub/ui";
import {
  useCancelRun,
  useClient,
  useConnection,
  useProjects,
  useProviders,
  useSessionStream,
  useSessions,
} from "@agentic-hub/ui/client";
import { isRunActive } from "@agentic-hub/ui/model";
import { AGENT_DISPLAY } from "@agentic-hub/ui/model";
import { FileDiff, FolderOpen, History, KeyRound, Moon, PanelLeft, PanelRight, Plus, Settings, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { platform, isTauri } from "./platform/native";
import { HistoryScreen } from "./screens/HistoryScreen";
import { ProvidersScreen } from "./screens/ProvidersScreen";
import { RepositoryScreen } from "./screens/RepositoryScreen";
import { ReviewScreen } from "./screens/ReviewScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { WorkspaceScreen } from "./screens/WorkspaceScreen";
import { useAppState } from "./state/app-state";

/** Space for macOS traffic lights when the native title bar is overlaid. */
function TitlebarSpacer() {
  const overlay = isTauri() && platform.isMac;
  return <div data-tauri-drag-region className={overlay ? "h-11 shrink-0" : "h-3 shrink-0"} />;
}

export function Shell() {
  const { prefs, setPrefs, view, navigate, selectSession, openReview } = useAppState();
  const client = useClient();
  const connection = useConnection();
  const projects = useProjects();
  const sessions = useSessions();
  const providers = useProviders();
  const { resolved, setPreference } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [composerAgent, setComposerAgent] = useState(prefs.defaultAgent);

  // Narrow windows use overlay drawers that start closed and don't touch the persisted desktop layout.
  const compact = useMediaQuery("(max-width: 899px)");
  // Drawers close whenever the window mode, screen or session changes (derived, not effect-driven).
  const drawerKey = `${compact}|${view}|${prefs.activeSessionId ?? ""}`;
  const [drawerState, setDrawerState] = useState<{ key: string; open: "sidebar" | "inspector" | null }>({ key: "", open: null });
  const drawer = drawerState.key === drawerKey ? drawerState.open : null;
  const setDrawer = (open: "sidebar" | "inspector" | null) => setDrawerState({ key: drawerKey, open });
  const sidebarOpen = compact ? drawer === "sidebar" : prefs.sidebarOpen;
  const inspectorOpen = compact ? drawer === "inspector" : prefs.inspectorOpen;
  const setSidebarOpen = (open: boolean) => (compact ? setDrawer(open ? "sidebar" : null) : setPrefs({ sidebarOpen: open }));
  const setInspectorOpen = (open: boolean) => (compact ? setDrawer(open ? "inspector" : null) : setPrefs({ inspectorOpen: open }));

  const activeProject = projects.data?.find((p) => p.id === prefs.activeProjectId) ?? projects.data?.[0];
  const snapshot = useSessionStream(prefs.activeSessionId);
  const session = snapshot.data?.session;
  const cancel = useCancelRun(prefs.activeSessionId);

  // Keep the stored project pointer valid once data arrives.
  useEffect(() => {
    if (activeProject && activeProject.id !== prefs.activeProjectId) setPrefs({ activeProjectId: activeProject.id });
  }, [activeProject, prefs.activeProjectId, setPrefs]);

  // First run with no repositories: send people to the picker.
  useEffect(() => {
    if (view === "workspace" && projects.data && projects.data.length === 0) navigate("repositories");
  }, [view, projects.data, navigate]);

  const newSession = () => {
    selectSession(undefined, activeProject?.id);
  };
  const canCancel = session ? isRunActive(session.status) && session.status !== "cancelling" : false;

  useShortcuts([
    { keys: "mod+k", handler: () => setPaletteOpen((o) => !o) },
    { keys: "mod+n", handler: newSession, enabled: Boolean(activeProject) },
    { keys: "mod+o", handler: () => navigate("repositories") },
    { keys: "mod+b", handler: () => setSidebarOpen(!sidebarOpen) },
    { keys: "mod+j", handler: () => setInspectorOpen(!inspectorOpen) },
    { keys: "mod+,", handler: () => navigate("settings") },
    { keys: "mod+y", handler: () => navigate("history") },
    { keys: "mod+shift+d", handler: () => openReview(), enabled: Boolean(snapshot.data?.changes.length) },
    { keys: "mod+.", handler: () => cancel.mutate(), enabled: canCancel },
    ...AGENT_ORDER.map((agentId, i) => ({
      keys: `mod+${i + 1}`,
      handler: () => setComposerAgent(agentId),
      enabled: view === "workspace" && !prefs.activeSessionId,
    })),
  ]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      { id: "new", group: "Actions", label: "New chat", icon: <Plus />, shortcut: "mod+n", run: newSession, disabled: !activeProject },
      { id: "open", group: "Actions", label: "Open repository…", icon: <FolderOpen />, shortcut: "mod+o", run: () => navigate("repositories") },
      { id: "review", group: "Actions", label: "Review changes", icon: <FileDiff />, shortcut: "mod+shift+d", run: () => openReview(), disabled: !snapshot.data?.changes.length },
      { id: "history", group: "Navigate", label: "All chats", icon: <History />, shortcut: "mod+y", run: () => navigate("history") },
      { id: "providers", group: "Navigate", label: "Providers", icon: <KeyRound />, run: () => navigate("providers") },
      { id: "settings", group: "Navigate", label: "Settings", icon: <Settings />, shortcut: "mod+,", run: () => navigate("settings") },
      { id: "sidebar", group: "View", label: "Toggle sidebar", icon: <PanelLeft />, shortcut: "mod+b", run: () => setSidebarOpen(!sidebarOpen) },
      { id: "inspector", group: "View", label: "Toggle review panel", icon: <PanelRight />, shortcut: "mod+j", run: () => setInspectorOpen(!inspectorOpen) },
      {
        id: "theme",
        group: "View",
        label: resolved === "dark" ? "Switch to light theme" : "Switch to dark theme",
        icon: resolved === "dark" ? <Sun /> : <Moon />,
        run: () => setPreference(resolved === "dark" ? "light" : "dark"),
      },
    ];
    for (const s of sessions.data ?? []) {
      list.push({
        id: `session-${s.id}`,
        group: "Sessions",
        label: s.title,
        hint: `${AGENT_DISPLAY[s.agentId].name} · ${projects.data?.find((p) => p.id === s.projectId)?.name ?? ""}`,
        run: () => selectSession(s.id, s.projectId),
      });
    }
    for (const p of projects.data ?? []) {
      list.push({ id: `project-${p.id}`, group: "Projects", label: p.name, hint: p.path, icon: <FolderOpen />, run: () => setPrefs({ activeProjectId: p.id }) });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.data, projects.data, activeProject, sidebarOpen, inspectorOpen, compact, resolved, snapshot.data?.changes.length]);

  const panelToggles = (
    <div className="flex items-center gap-0.5">
      <Tooltip content={sidebarOpen ? "Hide sidebar" : "Show sidebar"} shortcut="mod+b">
        <Button variant="ghost" size="icon" aria-label="Toggle sidebar" aria-pressed={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>
          <PanelLeft />
        </Button>
      </Tooltip>
      {view === "workspace" && snapshot.data ? (
        <Tooltip content={inspectorOpen ? "Hide review panel" : "Show review panel"} shortcut="mod+j">
          <Button variant="ghost" size="icon" aria-label="Toggle review panel" aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}>
            <PanelRight />
          </Button>
        </Tooltip>
      ) : null}
    </div>
  );

  const main = (() => {
    switch (view) {
      case "repositories":
        return <RepositoryScreen toolbar={panelToggles} />;
      case "history":
        return <HistoryScreen toolbar={panelToggles} />;
      case "review":
        return <ReviewScreen toolbar={panelToggles} snapshot={snapshot.data} />;
      case "providers":
        return <ProvidersScreen toolbar={panelToggles} />;
      case "settings":
        return <SettingsScreen toolbar={panelToggles} />;
      default:
        return (
          <WorkspaceScreen
            toolbar={panelToggles}
            project={activeProject}
            projectsQuery={projects}
            snapshotQuery={snapshot}
            composerAgent={composerAgent}
            onComposerAgentChange={setComposerAgent}
          />
        );
    }
  })();

  const showInspector = view === "workspace" && Boolean(snapshot.data);

  return (
    <>
      <AppShell
        layoutId="desktop"
        banner={
          <ConnectionBanner
            connection={connection}
            onRetry={() => {
              client.reconnect();
              void projects.refetch();
              void sessions.refetch();
            }}
            action={
              connection.status === "demo" ? (
                <Button size="xs" variant="ghost" className="text-current hover:text-current" onClick={() => navigate("settings")}>
                  Data source
                </Button>
              ) : null
            }
          />
        }
        sidebarOpen={sidebarOpen}
        inspectorOpen={showInspector && inspectorOpen}
        onSidebarOpenChange={setSidebarOpen}
        onInspectorOpenChange={(open) => showInspector && setInspectorOpen(open)}
        sidebar={
          <ProjectSidebar
            header={<TitlebarSpacer />}
            projects={projects.data ?? []}
            sessions={sessions.data ?? []}
            providers={providers.data}
            connection={connection}
            loading={sessions.isPending && !sessions.isError}
            sessionsUnavailable={sessions.isError ? "Chats are unavailable while the runtime is offline." : undefined}
            activeProjectId={activeProject?.id}
            activeSessionId={view === "workspace" ? prefs.activeSessionId : undefined}
            onSelectProject={(id) => setPrefs({ activeProjectId: id })}
            onSelectSession={(id) => selectSession(id, sessions.data?.find((s) => s.id === id)?.projectId)}
            onNewSession={activeProject ? newSession : undefined}
            onOpenRepository={() => navigate("repositories")}
            onOpenSettings={() => navigate("settings")}
            onOpenHistory={() => navigate("history")}
            onOpenProviders={() => navigate("providers")}
          />
        }
        main={main}
        inspector={
          showInspector && snapshot.data ? (
            <SessionInspector
              snapshot={snapshot.data}
              project={activeProject}
              modeLabel={client.mode === "demo" ? "Demo fixtures" : client.label}
              onOpenReview={openReview}
            />
          ) : null
        }
      />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
    </>
  );
}
