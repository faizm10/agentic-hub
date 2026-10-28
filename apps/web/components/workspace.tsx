"use client";

import {
  AgentEventTimeline,
  AgentSelector,
  AppShell,
  Button,
  ChatComposer,
  CommandPalette,
  DisconnectedState,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  ModelSelector,
  MultiAgentBoard,
  MultiAgentComposer,
  initialAssignments,
  type AgentAssignment,
  NewChatHero,
  ProjectSidebar,
  ProviderSettings,
  SessionHeader,
  Skeleton,
  ThemeToggle,
  Tooltip,
  UsageDashboard,
  cn,
  safeStorage,
  useMediaQuery,
  useShortcuts,
  type ChatComposerHandle,
  type PaletteCommand,
} from "@agentic-hub/ui";
import {
  ClientProvider,
  RefetchOnReconnect,
  errorMessage,
  isUnavailable,
  useAgents,
  useCancelRun,
  useConnection,
  useCreateSession,
  useModels,
  useProjects,
  useProviders,
  useQueuedMessages,
  useRemoveQueuedMessage,
  useStartMultiAgent,
  useUsage,
  useResolveApproval,
  useSendMessage,
  useSessionStream,
  useSessions,
  useSetApiKey,
} from "@agentic-hub/ui/client";
import { AGENT_DISPLAY, MODEL_CHAT_PROJECT_ID, isRunActive, type AgentId } from "@agentic-hub/ui/model";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BarChart3, Columns3, GitFork, KeyRound, LogOut, MessageSquare, Monitor, PanelLeft, Plus, Settings, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CLOUD_PROJECT_ID, parseDeviceRef } from "@/lib/ids";
import { createWebClient, type WebClient } from "@/lib/web-client";
import { DevicesScreen } from "./devices-screen";

type View = "chat" | "board" | "usage" | "providers" | "devices" | "settings";
interface Prefs {
  projectId: string;
  sessionId?: string;
  agent: AgentId;
  models: Partial<Record<AgentId, string>>;
  sidebarOpen: boolean;
  /** Same options as the desktop composer. */
  multiAgent?: boolean;
  multiAgents?: AgentId[];
  isolate?: boolean;
  boardSessionIds?: string[];
}
const PREFS_KEY = "agentic-hub.web.prefs.v1";
const DEFAULT_PREFS: Prefs = { projectId: CLOUD_PROJECT_ID, agent: "anthropic", models: {}, sidebarOpen: true };

function ScreenFrame({ title, toolbar, children, wide }: { title: string; toolbar: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        {toolbar}
        <h1 className="px-1 text-sm font-medium text-fg">{title}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto w-full px-4 py-8 sm:px-6", wide ? "max-w-5xl" : "max-w-3xl")}>{children}</div>
      </div>
    </>
  );
}

function WorkspaceInner({ client, email }: { client: WebClient; email: string }) {
  const router = useRouter();
  const [prefs, setPrefsState] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...safeStorage.get<Partial<Prefs>>(PREFS_KEY, {}) }));
  const setPrefs = (patch: Partial<Prefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      safeStorage.set(PREFS_KEY, next);
      return next;
    });
  const [view, setView] = useState<View>("chat");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const compact = useMediaQuery("(max-width: 899px)");
  const [drawer, setDrawer] = useState(false);
  const sidebarOpen = compact ? drawer : prefs.sidebarOpen;
  const setSidebarOpen = (open: boolean) => (compact ? setDrawer(open) : setPrefs({ sidebarOpen: open }));

  const connection = useConnection();
  const projects = useProjects();
  const sessions = useSessions();
  const providers = useProviders();
  const agents = useAgents();
  const project = projects.data?.find((p) => p.id === prefs.projectId) ?? projects.data?.[0];
  const cloud = project?.id === CLOUD_PROJECT_ID;
  const deviceModelChat = project && !cloud && parseDeviceRef(project.id)?.id === MODEL_CHAT_PROJECT_ID;
  const snapshot = useSessionStream(view === "chat" ? prefs.sessionId : undefined);
  const session = snapshot.data?.session;

  const send = useSendMessage(prefs.sessionId);
  const cancel = useCancelRun(prefs.sessionId);
  const resolve = useResolveApproval(prefs.sessionId);
  const create = useCreateSession();
  const startMany = useStartMultiAgent();
  const [multiDraft, setMultiDraft] = useState<{ goal: string; assignments: AgentAssignment[] | null }>({ goal: "", assignments: null });
  const queue = useQueuedMessages(view === "chat" ? prefs.sessionId : undefined);
  const removeQueued = useRemoveQueuedMessage(prefs.sessionId);
  const [usageDays, setUsageDays] = useState(30);
  const usage = useUsage(usageDays, view === "usage");
  const setKey = useSetApiKey();
  const composerRef = useRef<ChatComposerHandle>(null);
  const [errorState, setErrorState] = useState<{ key?: string; message: string } | null>(null);
  const actionError = errorState && errorState.key === prefs.sessionId ? errorState.message : null;
  const setActionError = (message: string | null) => setErrorState(message ? { key: prefs.sessionId, message } : null);

  // Web chats offer model APIs with this account's keys; a computer's projects offer what that computer reports.
  const deviceId = project && !cloud ? parseDeviceRef(project.id)?.deviceId : undefined;
  const projectProviders = deviceId ? client.deviceProviders(deviceId) : providers.data;
  const allowedAgents = (agents.data ?? []).filter((a) => ((cloud || deviceModelChat) ? a.kind === "model" : projectProviders?.some((p) => p.agentId === a.id)));
  const firstReady = allowedAgents.find((a) => projectProviders?.find((p) => p.agentId === a.id)?.status === "ready");
  const composerAgent = allowedAgents.some((a) => a.id === prefs.agent) && projectProviders?.find((p) => p.agentId === prefs.agent)?.status === "ready"
    ? prefs.agent
    : (firstReady?.id ?? allowedAgents[0]?.id ?? prefs.agent);
  const agentProvider = projectProviders?.find((p) => p.agentId === composerAgent);
  const modelsEnabled = agentProvider?.status === "ready";
  const models = useModels(composerAgent, modelsEnabled);

  useEffect(() => {
    composerRef.current?.focus();
  }, [prefs.sessionId, view]);

  const newChat = () => {
    setView("chat");
    setPrefs({ sessionId: undefined });
    setDrawer(false);
  };
  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  };

  useShortcuts([
    { keys: "mod+k", handler: () => setPaletteOpen((o) => !o) },
    { keys: "mod+shift+o", handler: newChat },
    { keys: "mod+b", handler: () => setSidebarOpen(!sidebarOpen) },
    { keys: "mod+.", handler: () => cancel.mutate(), enabled: Boolean(session && isRunActive(session.status)) },
    { keys: "mod+,", handler: () => setView("settings") },
  ]);

  const commands: PaletteCommand[] = [
    { id: "new", group: "Actions", label: "New chat", icon: <Plus />, shortcut: "mod+shift+o", run: newChat },
    { id: "providers", group: "Navigate", label: "Providers", icon: <KeyRound />, run: () => setView("providers") },
    { id: "usage", group: "Navigate", label: "Usage and tokens", icon: <BarChart3 />, run: () => setView("usage") },
    { id: "board", group: "Navigate", label: "Multi-agent board", icon: <Columns3 />, run: () => setView("board"), disabled: !prefs.boardSessionIds?.length },
    { id: "devices", group: "Navigate", label: "Devices", icon: <Monitor />, run: () => setView("devices") },
    { id: "settings", group: "Navigate", label: "Settings", icon: <Settings />, shortcut: "mod+,", run: () => setView("settings") },
    ...(sessions.data ?? []).map((s) => ({
      id: `s-${s.id}`,
      group: "Chats",
      label: s.title,
      hint: AGENT_DISPLAY[s.agentId].name,
      run: () => {
        setView("chat");
        setPrefs({ sessionId: s.id, projectId: s.projectId });
      },
    })),
  ];

  const toolbar = (
    <Tooltip content={sidebarOpen ? "Hide sidebar" : "Show sidebar"} shortcut="mod+b">
      <Button variant="ghost" size="icon" aria-label="Toggle sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}>
        <PanelLeft />
      </Button>
    </Tooltip>
  );

  const accountMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger className="mt-1 flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg focus-ring">
        <span className="flex size-6 items-center justify-center rounded-full bg-fg text-2xs font-semibold uppercase text-bg">{email[0]}</span>
        <span className="min-w-0 flex-1 truncate">{email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel>{email}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setView("devices")}>
          <Monitor /> Devices
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setView("settings")}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const control = prefs.sessionId ? client.sessionControl(prefs.sessionId) : { allowed: true };

  const chatMain = () => {
    if (projects.isError) {
      return isUnavailable(projects.error) ? (
        <DisconnectedState title="Agentic Hub is unavailable" detail={errorMessage(projects.error)} onRetry={() => void projects.refetch()} />
      ) : (
        <ErrorState message={errorMessage(projects.error)} onRetry={() => void projects.refetch()} />
      );
    }
    if (!prefs.sessionId) {
      const multi = Boolean(prefs.multiAgent);
      const readyIds = allowedAgents.filter((a) => projectProviders?.find((p) => p.agentId === a.id)?.status === "ready").map((a) => a.id);
      const preferred = prefs.multiAgents ?? ["claude-code", "codex"];
      const assignments = multiDraft.assignments ?? initialAssignments([...preferred.filter((id) => readyIds.includes(id)), ...readyIds.filter((id) => !preferred.includes(id))].slice(0, 2));
      const agentWork = !cloud && !deviceModelChat;
      const blocked = multi ? (deviceId ? client.deviceControl(deviceId).reason : undefined) : !allowedAgents.length
        ? "This computer hasn't reported any agents yet."
        : agentProvider && agentProvider.status !== "ready"
          ? agentProvider.detail ?? `${AGENT_DISPLAY[composerAgent].name} isn't ready.`
          : deviceId
            ? client.deviceControl(deviceId).reason
            : undefined;
      const kind = AGENT_DISPLAY[composerAgent].kind;
      const multiToggle = (
        <Tooltip content={multi ? "Back to one agent" : "Split work across several agents, each with its own task"}>
          <button type="button" aria-pressed={multi} onClick={() => setPrefs({ multiAgent: !multi })} className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs transition-colors focus-ring", multi ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-3 hover:text-fg")}>
            <Users className="size-3.5" /> Multi
          </button>
        </Tooltip>
      );
      const worktreeToggle = agentWork ? (
        <Tooltip content={prefs.isolate ? "Each coding agent works on its own branch in its own Git worktree on your computer" : "Runs in the computer's current checkout"}>
          <button type="button" aria-pressed={Boolean(prefs.isolate)} onClick={() => setPrefs({ isolate: !prefs.isolate })} className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs transition-colors focus-ring", prefs.isolate ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-3 hover:text-fg")}>
            <GitFork className="size-3.5" /> {prefs.isolate ? "Worktree" : "Local"}
          </button>
        </Tooltip>
      ) : null;
      return (
        <>
          <header className="flex h-12 shrink-0 items-center gap-2 px-2">{toolbar}</header>
          <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto pb-[6vh]">
            {projects.isPending ? (
              <Skeleton className="mx-auto h-24 w-full max-w-xl rounded-3xl" />
            ) : (
              <>
                <NewChatHero
                  kind={kind}
                  title={multi ? "Split the work across agents" : cloud || deviceModelChat ? "What’s on your mind?" : "What should we build today?"}
                  subtitle={project && !cloud && !deviceModelChat ? <span className="font-mono text-xs">{project.path}</span> : undefined}
                  onSuggestion={multi || blocked ? undefined : (prompt) => composerRef.current?.setText(prompt)}
                  className="mb-8"
                />
                {multi ? (
                  <MultiAgentComposer
                    agents={allowedAgents}
                    providers={projectProviders}
                    assignments={assignments}
                    onAssignmentsChange={(next) => setMultiDraft((d) => ({ ...d, assignments: next }))}
                    goal={multiDraft.goal}
                    onGoalChange={(goal) => setMultiDraft((d) => ({ ...d, goal }))}
                    disabledReason={blocked}
                    toolbar={<>{multiToggle}{worktreeToggle}</>}
                    footer={actionError ? <span className="text-danger">{actionError}</span> : <span>Each agent gets its own task and knows what the others are doing.</span>}
                    onSubmit={async () => {
                      if (!project) return;
                      setActionError(null);
                      const result = await startMany.mutateAsync({
                        projectId: project.id, goal: multiDraft.goal, isolate: Boolean(prefs.isolate),
                        assignments: assignments.map((a) => ({ ...a, kind: AGENT_DISPLAY[a.agentId].kind, model: prefs.models[a.agentId] })),
                      });
                      const failed = result.failures.map((f) => `${AGENT_DISPLAY[f.agentId].name} (“${f.task.slice(0, 40)}”): ${f.message}`).join(" · ");
                      if (!result.sessions.length) {
                        setActionError(failed);
                        throw new Error(failed);
                      }
                      if (failed) setActionError(`Didn't start: ${failed}`);
                      setPrefs({ boardSessionIds: result.sessions.map((s) => s.id), sessionId: undefined, multiAgents: [...new Set(assignments.map((a) => a.agentId))] });
                      setMultiDraft({ goal: "", assignments: null });
                      setView("board");
                    }}
                  />
                ) : (
                <ChatComposer
                  ref={composerRef}
                  placeholder={`Message ${AGENT_DISPLAY[composerAgent].name}…`}
                  disabledReason={blocked}
                  toolbar={
                    <>
                      {multiToggle}
                      <AgentSelector
                        agents={allowedAgents}
                        providers={projectProviders}
                        value={composerAgent}
                        onChange={(agent) => setPrefs({ agent })}
                        onManageProviders={() => setView("providers")}
                        disabled={!allowedAgents.length}
                      />
                      {worktreeToggle}
                      <ModelSelector
                        models={models.data}
                        value={prefs.models[composerAgent]}
                        loading={models.isLoading}
                        error={models.isError ? `Couldn't list models: ${errorMessage(models.error)}` : undefined}
                        disabled={!modelsEnabled}
                        onChange={(id) => setPrefs({ models: { ...prefs.models, [composerAgent]: id } })}
                      />
                    </>
                  }
                  footer={
                    actionError ? (
                      <span className="text-danger">{actionError}</span>
                    ) : blocked && agentProvider?.status !== "ready" && cloud ? (
                      <button type="button" className="text-warning hover:underline" onClick={() => setView("providers")}>
                        Add your {AGENT_DISPLAY[composerAgent].name} API key →
                      </button>
                    ) : cloud || deviceModelChat ? (
                      <span>{cloud ? "Runs on Agentic Hub" : "Runs on your computer"} with your {AGENT_DISPLAY[composerAgent].name} key. Can&rsquo;t see your files.</span>
                    ) : (
                      <span>Runs on your computer. It may ask for approvals here or in the desktop app.</span>
                    )
                  }
                  onSubmit={async (prompt) => {
                    if (!project) return;
                    setActionError(null);
                    try {
                      const created = await create.mutateAsync({ projectId: project.id, agentId: composerAgent, model: prefs.models[composerAgent], prompt, isolation: agentWork && prefs.isolate ? "worktree" : "none" });
                      setPrefs({ sessionId: created.id, projectId: project.id });
                    } catch (e) {
                      setActionError(errorMessage(e));
                      throw e;
                    }
                  }}
                />
                )}
              </>
            )}
          </div>
        </>
      );
    }
    if (snapshot.isError) {
      return (
        <>
          <SessionHeader project={project} leading={toolbar} />
          <ErrorState title="Couldn't load this chat" message={errorMessage(snapshot.error)} onRetry={() => void snapshot.refetch()} />
        </>
      );
    }
    const running = session ? isRunActive(session.status) : false;
    return (
      <>
        <SessionHeader session={session} project={project} onCancel={() => cancel.mutate()} cancelUnavailableReason={control.allowed ? undefined : control.reason} leading={toolbar} />
        {(() => {
          const group = session?.groupId ? (sessions.data ?? []).filter((s) => s.groupId === session.groupId) : [];
          return group.length > 1 ? (
            <div className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-fg-muted">
              <Users className="size-3.5" /> Part of a {group.length}-agent run
              <Button size="xs" variant="ghost" onClick={() => { setPrefs({ boardSessionIds: group.map((s) => s.id) }); setView("board"); }}>
                <Columns3 /> View side by side
              </Button>
            </div>
          ) : null;
        })()}
        <AgentEventTimeline
          items={snapshot.data?.timeline ?? []}
          agentId={session?.agentId}
          status={session?.status}
          loading={snapshot.isPending}
          approvalUnavailableReason={control.allowed ? undefined : control.reason}
          onResolveApproval={control.allowed ? (approvalId, decision) => resolve.mutateAsync({ approvalId, decision }) : undefined}
          empty={<EmptyState icon={<MessageSquare />} title="No messages yet" />}
        />
        {queue.data?.length ? (
          <div className="mx-auto w-full max-w-[48rem] px-3 pb-2 sm:px-6" aria-label="Queued messages">
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-border bg-surface-2 p-2">
              <p className="px-2 text-xs font-medium text-fg-muted">Queued messages · {queue.data.length}</p>
              {queue.data.map((message) => (
                <div key={message.id} className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{message.text}</span>
                  {control.allowed ? (
                    <Button size="icon" variant="ghost" aria-label="Remove queued message" onClick={() => removeQueued.mutate(message.id)}><X className="size-3.5" /></Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <ChatComposer
          ref={composerRef}
          running={running}
          queueWhileRunning
          onCancel={control.allowed ? () => cancel.mutate() : undefined}
          disabledReason={control.allowed ? undefined : control.reason}
          placeholder="Send a follow-up…"
          footer={actionError ? <span className="text-danger">{actionError}</span> : cancel.isError ? <span className="text-danger">{errorMessage(cancel.error)}</span> : null}
          onSubmit={async (text) => {
            setActionError(null);
            try {
              await send.mutateAsync(text);
            } catch (e) {
              setActionError(errorMessage(e));
              throw e;
            }
          }}
        />
      </>
    );
  };

  const main = (() => {
    switch (view) {
      case "providers":
        return (
          <ScreenFrame title="Providers" toolbar={toolbar}>
            {agents.data && providers.data ? (
              <ProviderSettings
                agents={agents.data}
                providers={providers.data}
                apiKey={(agentId) =>
                  AGENT_DISPLAY[agentId].kind === "model"
                    ? { onSave: (apiKey) => setKey.mutateAsync({ agentId, apiKey }), onClear: () => setKey.mutateAsync({ agentId, apiKey: null }) }
                    : { onSave: () => Promise.reject(new Error("Coding agents sign in on your computer.")), onClear: () => Promise.resolve() }
                }
                onRecheck={() => void providers.refetch()}
                rechecking={providers.isFetching}
              />
            ) : providers.isError ? (
              <ErrorState message={errorMessage(providers.error)} onRetry={() => void providers.refetch()} />
            ) : (
              <div className="space-y-4">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-44 rounded-2xl" />
                ))}
              </div>
            )}
          </ScreenFrame>
        );
      case "devices":
        return (
          <ScreenFrame title="Devices" toolbar={toolbar}>
            <DevicesScreen client={client} />
          </ScreenFrame>
        );
      case "settings":
        return (
          <ScreenFrame title="Settings" toolbar={toolbar}>
            <div className="space-y-8">
              <section>
                <h2 className="mb-2 text-sm font-semibold text-fg">Appearance</h2>
                <ThemeToggle />
              </section>
              <section>
                <h2 className="mb-1 text-sm font-semibold text-fg">Account</h2>
                <p className="mb-3 text-sm text-fg-muted">Signed in as {email}.</p>
                <Button size="sm" onClick={() => void signOut()}>
                  <LogOut /> Sign out
                </Button>
              </section>
              <section>
                <h2 className="mb-1 text-sm font-semibold text-fg">Privacy</h2>
                <p className="text-sm text-fg-muted">
                  API keys, chat content and data synced from your computers are encrypted at rest (AES-256-GCM). Keys are only decrypted on the server to call the provider and are never sent to your browser.
                </p>
              </section>
            </div>
          </ScreenFrame>
        );
      case "usage":
        return (
          <ScreenFrame title="Usage" toolbar={toolbar} wide>
            {usage.isPending ? <Skeleton className="h-60 rounded-xl" /> : usage.isError ? <ErrorState message={errorMessage(usage.error)} onRetry={() => void usage.refetch()} /> : (
              <UsageDashboard reports={usage.data} days={usageDays} onDaysChange={setUsageDays} note="Web chats, plus what each paired computer last reported." />
            )}
          </ScreenFrame>
        );
      case "board":
        return prefs.boardSessionIds?.length ? (
          <MultiAgentBoard
            sessionIds={prefs.boardSessionIds}
            controlReason={(id) => client.sessionControl(id).reason}
            onOpenSession={(id) => {
              setView("chat");
              setPrefs({ sessionId: id, projectId: sessions.data?.find((s) => s.id === id)?.projectId ?? prefs.projectId });
            }}
            header={
              <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2">
                {toolbar}
                <h1 className="px-1 text-sm font-medium text-fg">Multi-agent run</h1>
                <span className="text-xs text-fg-subtle">{prefs.boardSessionIds.length} agents in parallel</span>
              </header>
            }
          />
        ) : (
          <ScreenFrame title="Multi-agent run" toolbar={toolbar}>
            <EmptyState icon={<Columns3 />} title="No multi-agent run open" description="Turn on Multi in a new chat to run several agents on one prompt." />
          </ScreenFrame>
        );
      default:
        return chatMain();
    }
  })();

  return (
    <div className="h-dvh">
      <AppShell
        layoutId="web"
        sidebarOpen={sidebarOpen}
        inspectorOpen={false}
        onSidebarOpenChange={setSidebarOpen}
        onInspectorOpenChange={() => {}}
        sidebar={
          <ProjectSidebar
            header={<div className="h-3" />}
            projects={projects.data ?? []}
            sessions={sessions.data ?? []}
            providers={providers.data}
            connection={connection}
            connectedLabel="Synced"
            loading={sessions.isPending && !sessions.isError}
            sessionsUnavailable={sessions.isError ? errorMessage(sessions.error) : undefined}
            activeProjectId={project?.id}
            activeSessionId={view === "chat" ? prefs.sessionId : undefined}
            onSelectProject={(projectId) => {
              setView("chat");
              setPrefs({ projectId, sessionId: undefined });
            }}
            onSelectSession={(id) => {
              setView("chat");
              setPrefs({ sessionId: id, projectId: sessions.data?.find((s) => s.id === id)?.projectId ?? prefs.projectId });
              setDrawer(false);
            }}
            onNewSession={newChat}
            onOpenRepository={() => setView("devices")}
            onOpenSettings={() => setView("settings")}
            onOpenProviders={() => setView("providers")}
            onOpenUsage={() => setView("usage")}
            footer={accountMenu}
          />
        }
        main={main}
        inspector={null}
      />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
    </div>
  );
}

export function Workspace({ email }: { email: string }) {
  const router = useRouter();
  const [{ client, queryClient }] = useState(() => ({
    client: createWebClient({ onUnauthorized: () => router.replace("/login") }),
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: (n, e) => (e as { status?: number })?.status !== 401 && (e as { code?: string })?.code !== "RUNTIME_UNAVAILABLE" && n < 2, refetchOnWindowFocus: true } },
    }),
  }));
  // Devices sync every few seconds while someone is watching; keep lists fresh.
  useEffect(() => {
    const timer = setInterval(() => void queryClient.invalidateQueries({ queryKey: ["sessions"] }), 15_000);
    return () => clearInterval(timer);
  }, [queryClient]);
  return (
    <ClientProvider client={client}>
      <QueryClientProvider client={queryClient}>
        <RefetchOnReconnect />
        <WorkspaceInner client={client} email={email} />
      </QueryClientProvider>
    </ClientProvider>
  );
}
