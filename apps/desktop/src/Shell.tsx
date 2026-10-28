import {
  AGENT_ORDER,
  MODEL_CHAT_PROJECT_ID,
  AppShell,
  Button,
  CommandPalette,
  ConnectionBanner,
  EmptyState,
  MultiAgentBoard,
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
import { Activity, BarChart3, Code2, Columns3, FileDiff, FolderOpen, GitFork, History, KeyRound, MessageSquareText, Moon, PanelLeft, PanelRight, Plus, Settings, SquareTerminal, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { IntegrationsPanel } from "./components/IntegrationsPanel";
import { UpdatePill } from "./components/UpdateControls";
import { platform, isTauri } from "./platform/native";
import { startAutomaticUpdateChecks } from "./platform/updater";
import { HistoryScreen } from "./screens/HistoryScreen";
import { CodeScreen } from "./screens/CodeScreen";
import { UsageScreen } from "./screens/UsageScreen";
import { ScreenHeader } from "./screens/ScreenHeader";
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
  const [drawerState, setDrawerState] = useState<{ key: string; open: "sidebar" | "inspector" | "integrations" | null }>({ key: "", open: null });
  const drawer = drawerState.key === drawerKey ? drawerState.open : null;
  const setDrawer = (open: "sidebar" | "inspector" | "integrations" | null) => setDrawerState({ key: drawerKey, open });
  const sidebarOpen = compact ? drawer === "sidebar" : prefs.sidebarOpen;
  const inspectorOpen = compact ? drawer === "inspector" : prefs.inspectorOpen;
  const integrationsOpen = compact ? drawer === "integrations" : prefs.integrationsOpen;
  const setSidebarOpen = (open: boolean) => (compact ? setDrawer(open ? "sidebar" : null) : setPrefs({ sidebarOpen: open }));
  // The review panel and the GitHub & Vercel panel share the right side; opening one closes the other.
  const setInspectorOpen = (open: boolean) => (compact ? setDrawer(open ? "inspector" : null) : setPrefs(open ? { inspectorOpen: true, integrationsOpen: false } : { inspectorOpen: false }));
  const setIntegrationsOpen = (open: boolean) => (compact ? setDrawer(open ? "integrations" : null) : setPrefs({ integrationsOpen: open }));

  const activeProject = projects.data?.find((p) => p.id === prefs.activeProjectId) ?? projects.data?.find((p) => p.id !== MODEL_CHAT_PROJECT_ID) ?? projects.data?.[0];
  const modelChats = projects.data?.find((p) => p.id === MODEL_CHAT_PROJECT_ID);
  const activeComposerAgent = activeProject?.id === MODEL_CHAT_PROJECT_ID && AGENT_DISPLAY[composerAgent].kind === "agent" ? "openai" : composerAgent;
  const snapshot = useSessionStream(prefs.activeSessionId);
  const session = snapshot.data?.session;
  const cancel = useCancelRun(prefs.activeSessionId);

  useEffect(() => startAutomaticUpdateChecks(), []);

  // Keep the stored project pointer valid once data arrives.
  useEffect(() => {
    if (activeProject && activeProject.id !== prefs.activeProjectId) setPrefs({ activeProjectId: activeProject.id });
  }, [activeProject, prefs.activeProjectId, setPrefs]);

  const newSession = () => {
    selectSession(undefined, activeProject?.id);
  };
  const newModelSession = () => {
    if (modelChats) selectSession(undefined, modelChats.id);
  };
  const canCancel = session ? isRunActive(session.status) && session.status !== "cancelling" : false;

  useShortcuts([
    { keys: "mod+k", handler: () => setPaletteOpen((o) => !o) },
    { keys: "mod+n", handler: newSession, enabled: Boolean(activeProject) },
    { keys: "mod+o", handler: () => navigate("repositories") },
    { keys: "mod+e", handler: () => navigate(view === "code" ? "workspace" : "code") },
    {
      keys: "mod+`",
      handler: () => {
        if (view !== "code") navigate("code");
        setPrefs({ bottomPanelOpen: view !== "code" || !prefs.bottomPanelOpen });
      },
    },
    { keys: "mod+b", handler: () => setSidebarOpen(!sidebarOpen) },
    { keys: "mod+j", handler: () => setInspectorOpen(!inspectorOpen || integrationsOpen) },
    { keys: "mod+shift+g", handler: () => setIntegrationsOpen(!integrationsOpen) },
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
      { id: "new-model", group: "Actions", label: "New model chat", icon: <MessageSquareText />, run: newModelSession, disabled: !modelChats },
      { id: "open", group: "Actions", label: "Open repository…", icon: <FolderOpen />, shortcut: "mod+o", run: () => navigate("repositories") },
      { id: "code", group: "Navigate", label: "Code: files and editor", icon: <Code2 />, shortcut: "mod+e", run: () => navigate("code") },
      { id: "terminal", group: "Navigate", label: "Terminal", icon: <SquareTerminal />, shortcut: "mod+`", run: () => { navigate("code"); setPrefs({ bottomPanelOpen: true }); } },
      {
        id: "worktree",
        group: "Actions",
        label: prefs.isolateSessions ? "Run new agent chats in the current checkout" : "Run new agent chats in isolated worktrees",
        icon: <GitFork />,
        run: () => setPrefs({ isolateSessions: !prefs.isolateSessions }),
      },
      { id: "review", group: "Actions", label: "Review changes", icon: <FileDiff />, shortcut: "mod+shift+d", run: () => openReview(), disabled: !snapshot.data?.changes.length },
      { id: "history", group: "Navigate", label: "All chats", icon: <History />, shortcut: "mod+y", run: () => navigate("history") },
      { id: "providers", group: "Navigate", label: "Providers", icon: <KeyRound />, run: () => navigate("providers") },
      { id: "usage", group: "Navigate", label: "Usage and tokens", icon: <BarChart3 />, run: () => navigate("usage") },
      { id: "board", group: "Navigate", label: "Multi-agent board", icon: <Columns3 />, run: () => navigate("board"), disabled: !prefs.boardSessionIds.length },
      {
        id: "multi",
        group: "Actions",
        label: prefs.multiAgent ? "Start new chats with one agent" : "Start new chats with several agents",
        icon: <Columns3 />,
        run: () => { setPrefs({ multiAgent: !prefs.multiAgent }); newSession(); },
      },
      { id: "activity", group: "Navigate", label: integrationsOpen ? "Hide GitHub & Vercel panel" : "Show GitHub & Vercel panel", hint: "pull requests, issues, deployments", icon: <Activity />, shortcut: "mod+shift+g", run: () => setIntegrationsOpen(!integrationsOpen) },
      { id: "settings", group: "Navigate", label: "Settings", icon: <Settings />, shortcut: "mod+,", run: () => navigate("settings") },
      { id: "sidebar", group: "View", label: "Toggle sidebar", icon: <PanelLeft />, shortcut: "mod+b", run: () => setSidebarOpen(!sidebarOpen) },
      { id: "inspector", group: "View", label: "Toggle review panel", icon: <PanelRight />, shortcut: "mod+j", run: () => setInspectorOpen(!inspectorOpen || integrationsOpen) },
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
  }, [sessions.data, projects.data, activeProject, sidebarOpen, inspectorOpen, integrationsOpen, compact, resolved, snapshot.data?.changes.length, prefs.isolateSessions, prefs.multiAgent, prefs.boardSessionIds.length]);

  const panelToggles = (
    <div className="flex items-center gap-0.5">
      <Tooltip content={sidebarOpen ? "Hide sidebar" : "Show sidebar"} shortcut="mod+b">
        <Button variant="ghost" size="icon" aria-label="Toggle sidebar" aria-pressed={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>
          <PanelLeft />
        </Button>
      </Tooltip>
      {view === "workspace" && snapshot.data ? (
        <Tooltip content={inspectorOpen && !integrationsOpen ? "Hide review panel" : "Show review panel"} shortcut="mod+j">
          <Button variant="ghost" size="icon" aria-label="Toggle review panel" aria-pressed={inspectorOpen && !integrationsOpen} onClick={() => setInspectorOpen(!inspectorOpen || integrationsOpen)}>
            <PanelRight />
          </Button>
        </Tooltip>
      ) : null}
      <Tooltip content={integrationsOpen ? "Hide GitHub & Vercel" : "Show GitHub & Vercel"} shortcut="mod+shift+g">
        <Button variant="ghost" size="icon" aria-label="Toggle GitHub & Vercel panel" aria-pressed={integrationsOpen} onClick={() => setIntegrationsOpen(!integrationsOpen)}>
          <Activity />
        </Button>
      </Tooltip>
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
      case "usage":
        return <UsageScreen toolbar={panelToggles} />;
      case "board":
        return prefs.boardSessionIds.length ? (
          <MultiAgentBoard
            sessionIds={prefs.boardSessionIds}
            onOpenSession={(id) => selectSession(id, sessions.data?.find((s) => s.id === id)?.projectId)}
            header={<ScreenHeader title="Multi-agent run" subtitle={`${prefs.boardSessionIds.length} agents in parallel`} toolbar={panelToggles} />}
          />
        ) : (
          <>
            <ScreenHeader title="Multi-agent run" toolbar={panelToggles} />
            <EmptyState icon={<Columns3 />} title="No multi-agent run open" description="Turn on Multi in a new chat to run several agents on one prompt." />
          </>
        );
      case "code":
        return <CodeScreen toolbar={panelToggles} project={activeProject} sessions={sessions.data ?? []} snapshot={snapshot.data} />;
      case "settings":
        return <SettingsScreen toolbar={panelToggles} />;
      default:
        return (
          <WorkspaceScreen
            toolbar={panelToggles}
            project={activeProject}
            projectsQuery={projects}
            snapshotQuery={snapshot}
            composerAgent={activeComposerAgent}
            onComposerAgentChange={setComposerAgent}
          />
        );
    }
  })();

  const showInspector = view === "workspace" && Boolean(snapshot.data) && (!session || AGENT_DISPLAY[session.agentId].kind === "agent");

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
        inspectorOpen={integrationsOpen || (showInspector && inspectorOpen)}
        onSidebarOpenChange={setSidebarOpen}
        onInspectorOpenChange={(open) => {
          if (open) return;
          // Collapsed by dragging or by tapping outside the drawer.
          if (integrationsOpen) setIntegrationsOpen(false);
          else if (showInspector) setInspectorOpen(false);
        }}
        sidebar={
          <ProjectSidebar
            header={<TitlebarSpacer />}
            footer={<UpdatePill onOpenDetails={() => navigate("settings")} />}
            projects={projects.data ?? []}
            sessions={sessions.data ?? []}
            providers={providers.data}
            connection={connection}
            loading={sessions.isPending && !sessions.isError}
            sessionsUnavailable={sessions.isError ? "Chats are unavailable while the runtime is offline." : undefined}
            activeProjectId={activeProject?.id}
            activeSessionId={view === "workspace" ? prefs.activeSessionId : undefined}
            onSelectProject={(id) => selectSession(undefined, id)}
            onSelectSession={(id) => selectSession(id, sessions.data?.find((s) => s.id === id)?.projectId)}
            onNewSession={activeProject ? newSession : undefined}
            onNewModelSession={modelChats ? newModelSession : undefined}
            onOpenRepository={() => navigate("repositories")}
            onOpenSettings={() => navigate("settings")}
            onOpenHistory={() => navigate("history")}
            onOpenProviders={() => navigate("providers")}
            onOpenActivity={() => setIntegrationsOpen(!integrationsOpen)}
            onOpenCode={() => navigate("code")}
            onOpenUsage={() => navigate("usage")}
          />
        }
        main={main}
        inspector={
          integrationsOpen ? (
            <IntegrationsPanel project={activeProject} session={session} onClose={() => setIntegrationsOpen(false)} />
          ) : showInspector && snapshot.data ? (
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
