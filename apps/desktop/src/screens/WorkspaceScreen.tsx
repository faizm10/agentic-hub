import {
  AgentEventTimeline,
  AgentSelector,
  Button,
  ChatComposer,
  DisconnectedState,
  EmptyState,
  ErrorState,
  ModelSelector,
  MultiAgentComposer,
  initialAssignments,
  type AgentAssignment,
  NewChatHero,
  SessionHeader,
  Tooltip,
  cn,
  type ChatComposerHandle,
} from "@agentic-hub/ui";
import {
  errorMessage,
  isUnavailable,
  useAgents,
  useCancelRun,
  useClient,
  useCreateSession,
  useModels,
  useProviders,
  useQueuedMessages,
  useRemoveQueuedMessage,
  useSessions,
  useStartMultiAgent,
  useResolveApproval,
  useSendMessage,
} from "@agentic-hub/ui/client";
import { AGENT_DISPLAY, MODEL_CHAT_PROJECT_ID, isRunActive, type AgentId, type Project, type SessionSnapshot } from "@agentic-hub/ui/model";
import type { UseQueryResult } from "@tanstack/react-query";
import { Columns3, FolderGit2, GitBranch, GitFork, MessageSquare, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { restartNativeRuntime, useNativeRuntimeStatus } from "../platform/runtime-status";
import { useAppState } from "../state/app-state";

function ComposerFooter({ demo, project, agentId }: { demo: boolean; project?: Project; agentId: AgentId }) {
  if (demo) return <span className="text-info">Sample data. Replies are scripted, not a real agent.</span>;
  if (AGENT_DISPLAY[agentId].kind === "model") return <span>{AGENT_DISPLAY[agentId].name} answers in chat and can&rsquo;t see or change your files.</span>;
  return project ? <span>{AGENT_DISPLAY[agentId].name} works in <span className="font-mono">{project.path}</span> and always asks before risky actions.</span> : null;
}

function UnavailableMain({ toolbar, detail, onRetry }: { toolbar: ReactNode; detail: string; onRetry: () => void }) {
  const { setPrefs } = useAppState();
  const native = useNativeRuntimeStatus();
  return (
    <>
      <header data-tauri-drag-region className="flex h-12 shrink-0 items-center px-2">
        {toolbar}
      </header>
      <div className="flex flex-1 items-center justify-center">
        <DisconnectedState
          title={native?.state === "starting" ? "Starting the local runtime…" : "Local runtime offline"}
          detail={
            native ? (
              native.state === "failed" || native.state === "restarting" ? native.detail : detail
            ) : (
              <>
                {detail}
                <br />
                Start it with <code className="font-mono text-xs">pnpm runtime:start</code>, then retry.
              </>
            )
          }
          onRetry={() => {
            if (native?.state === "failed") void restartNativeRuntime();
            onRetry();
          }}
          action={
            <Button size="sm" variant="ghost" onClick={() => setPrefs({ dataMode: "demo" })}>
              Explore sample data
            </Button>
          }
        />
      </div>
    </>
  );
}

function useModelChoice(agentId: AgentId) {
  const { prefs, setPrefs } = useAppState();
  const providers = useProviders();
  const ready = providers.data?.find((p) => p.agentId === agentId)?.status === "ready";
  const models = useModels(agentId, ready);
  const model = prefs.models[agentId];
  return {
    model,
    selector: (
      <ModelSelector
        models={models.data}
        value={model}
        loading={models.isLoading}
        error={!ready ? undefined : models.isError ? `Couldn't list models: ${errorMessage(models.error)}` : undefined}
        disabled={!ready}
        onChange={(id) => setPrefs({ models: { ...prefs.models, [agentId]: id } })}
      />
    ),
  };
}

export function WorkspaceScreen({
  toolbar,
  project,
  projectsQuery,
  snapshotQuery,
  composerAgent,
  onComposerAgentChange,
}: {
  toolbar: ReactNode;
  project?: Project;
  projectsQuery: UseQueryResult<Project[]>;
  snapshotQuery: UseQueryResult<SessionSnapshot>;
  composerAgent: AgentId;
  onComposerAgentChange: (agentId: AgentId) => void;
}) {
  const { prefs, setPrefs, selectSession, navigate, draftPrompt, consumeDraftPrompt } = useAppState();
  const client = useClient();
  const demo = client.mode === "demo";
  const agents = useAgents();
  const providers = useProviders();
  const sessionId = prefs.activeSessionId;
  const send = useSendMessage(sessionId);
  const queue = useQueuedMessages(sessionId);
  const removeQueued = useRemoveQueuedMessage(sessionId);
  const cancel = useCancelRun(sessionId);
  const resolve = useResolveApproval(sessionId);
  const create = useCreateSession();
  const startMany = useStartMultiAgent();
  const composerRef = useRef<ChatComposerHandle>(null);
  // Errors belong to the chat they happened in, so switching chats clears them.
  const [errorState, setErrorState] = useState<{ sessionId?: string; message: string } | null>(null);
  const actionError = errorState && errorState.sessionId === sessionId ? errorState.message : null;
  const setActionError = (message: string | null) => setErrorState(message ? { sessionId, message } : null);
  const choice = useModelChoice(composerAgent);
  const allSessions = useSessions();
  const [multiDraft, setMultiDraft] = useState<{ goal: string; assignments: AgentAssignment[] | null }>({ goal: "", assignments: null });
  const modelChat = project?.id === MODEL_CHAT_PROJECT_ID;

  useEffect(() => {
    composerRef.current?.focus();
  }, [sessionId]);

  // Prompts handed over from other screens (issues, PR reviews, failed deploys).
  useEffect(() => {
    if (sessionId || draftPrompt === undefined) return;
    const text = consumeDraftPrompt();
    if (text) composerRef.current?.setText(text);
  }, [sessionId, draftPrompt, consumeDraftPrompt, project?.id]);

  if (projectsQuery.isError) {
    if (isUnavailable(projectsQuery.error)) {
      return <UnavailableMain toolbar={toolbar} detail={errorMessage(projectsQuery.error)} onRetry={() => void projectsQuery.refetch()} />;
    }
    return <ErrorState message={errorMessage(projectsQuery.error)} onRetry={() => void projectsQuery.refetch()} />;
  }

  // ── New chat ──────────────────────────────────────────────────────────
  if (!sessionId) {
    const multi = prefs.multiAgent && !demo;
    const pickable = (agents.data ?? []).filter((agent) => !modelChat || agent.kind === "model");
    const readyIds = pickable.filter((a) => providers.data?.find((p) => p.agentId === a.id)?.status === "ready").map((a) => a.id);
    const assignments = multiDraft.assignments ?? initialAssignments([...prefs.multiAgents.filter((id) => readyIds.includes(id)), ...readyIds.filter((id) => !prefs.multiAgents.includes(id))].slice(0, 2));
    const provider = providers.data?.find((p) => p.agentId === composerAgent);
    const blocked = provider && provider.status !== "ready" ? (provider.detail ?? `${AGENT_DISPLAY[composerAgent].name} isn't ready yet.`) : undefined;
    const kind = multi ? (assignments.some((a) => AGENT_DISPLAY[a.agentId].kind === "agent") ? "agent" : "model") : AGENT_DISPLAY[composerAgent].kind;
    const multiToggle = !demo ? (
      <Tooltip content={multi ? "Back to one agent" : "Split work across several agents, each with its own task"}>
        <button
          type="button"
          onClick={() => setPrefs({ multiAgent: !prefs.multiAgent })}
          aria-pressed={multi}
          className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs transition-colors focus-ring", multi ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-3 hover:text-fg")}
        >
          <Users className="size-3.5" /> Multi
        </button>
      </Tooltip>
    ) : null;
    const worktreeToggle = kind === "agent" && !demo ? (
      <Tooltip content={prefs.isolateSessions ? "Each coding agent works on its own branch in its own Git worktree" : "Runs in your current checkout"}>
        <button
          type="button"
          onClick={() => setPrefs({ isolateSessions: !prefs.isolateSessions })}
          aria-pressed={prefs.isolateSessions}
          className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs transition-colors focus-ring", prefs.isolateSessions ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-3 hover:text-fg")}
        >
          <GitFork className="size-3.5" /> {prefs.isolateSessions ? "Worktree" : "Local"}
        </button>
      </Tooltip>
    ) : null;
    const startMulti = async () => {
      if (!project) return;
      setActionError(null);
      const result = await startMany.mutateAsync({
        projectId: project.id,
        goal: multiDraft.goal,
        isolate: prefs.isolateSessions,
        assignments: assignments.map((a) => ({ ...a, kind: AGENT_DISPLAY[a.agentId].kind, model: prefs.models[a.agentId] })),
      });
      const failed = result.failures.map((f) => `${AGENT_DISPLAY[f.agentId].name} (“${f.task.slice(0, 40)}”): ${f.message}`).join(" · ");
      if (!result.sessions.length) {
        setActionError(failed);
        throw new Error(failed);
      }
      if (failed) setActionError(`Didn't start: ${failed}`);
      setPrefs({ boardSessionIds: result.sessions.map((s) => s.id), activeSessionId: undefined, multiAgents: [...new Set(assignments.map((a) => a.agentId))] });
      setMultiDraft({ goal: "", assignments: null });
      navigate("board");
    };
    return (
      <>
        <header data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-2 px-2">
          {toolbar}
        </header>
        <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto pb-[6vh]">
          {project ? (
            <>
              <NewChatHero
                kind={kind}
                title={multi ? "Split the work across agents" : kind === "model" ? "What’s on your mind?" : "What should we build today?"}
                subtitle={modelChat ? undefined :
                  <span className="flex flex-wrap items-center justify-center gap-x-1.5">
                    <FolderGit2 className="size-3.5" /> {project.name}
                    <GitBranch className="ml-1 size-3.5" /> <span className="font-mono text-xs">{project.branch}</span>
                  </span>
                }
                onSuggestion={multi || blocked ? undefined : (prompt) => composerRef.current?.setText(prompt)}
                className="mb-8 animate-in fade-in-0 slide-in-from-bottom-1 duration-300"
              />
              {multi ? (
                <MultiAgentComposer
                  agents={pickable}
                  providers={providers.data}
                  assignments={assignments}
                  onAssignmentsChange={(next) => setMultiDraft((d) => ({ ...d, assignments: next }))}
                  goal={multiDraft.goal}
                  onGoalChange={(goal) => setMultiDraft((d) => ({ ...d, goal }))}
                  onSubmit={startMulti}
                  toolbar={<>{multiToggle}{worktreeToggle}</>}
                  footer={
                    actionError ? (
                      <span className="text-danger">{actionError}</span>
                    ) : (
                      <span>Each agent gets its own task and knows what the others are doing{kind === "agent" && !prefs.isolateSessions ? ". Turn on Worktree so they don’t edit the same files." : "."}</span>
                    )
                  }
                />
              ) : (
              <ChatComposer
                ref={composerRef}
                placeholder={kind === "model" ? `Message ${AGENT_DISPLAY[composerAgent].name}…` : `Describe a task for ${AGENT_DISPLAY[composerAgent].name}…`}
                disabledReason={blocked}
                toolbar={
                  <>
                    {multiToggle}
                    <AgentSelector
                      agents={modelChat ? (agents.data ?? []).filter((agent) => agent.kind === "model") : agents.data ?? []}
                      providers={providers.data}
                      value={composerAgent}
                      onChange={(id) => {
                        onComposerAgentChange(id);
                        setPrefs({ defaultAgent: id });
                      }}
                      onManageProviders={() => navigate("providers")}
                      disabled={!agents.data}
                    />
                    {choice.selector}
                    {worktreeToggle}
                  </>
                }
                footer={
                  actionError ? (
                    <span className="text-danger">{actionError}</span>
                  ) : blocked ? (
                    <button type="button" className="text-warning underline-offset-2 hover:underline" onClick={() => navigate("providers")}>
                      Set up {AGENT_DISPLAY[composerAgent].name} in Providers →
                    </button>
                  ) : (
                    <ComposerFooter demo={demo} project={project} agentId={composerAgent} />
                  )
                }
                onSubmit={async (prompt) => {
                  setActionError(null);
                  try {
                    const session = await create.mutateAsync({
                      projectId: project.id,
                      agentId: composerAgent,
                      model: choice.model,
                      prompt,
                      isolation: kind === "agent" && prefs.isolateSessions ? "worktree" : "none",
                    });
                    selectSession(session.id, project.id);
                  } catch (e) {
                    setActionError(errorMessage(e));
                    throw e;
                  }
                }}
              />
              )}
            </>
          ) : (
            <EmptyState
              icon={<FolderGit2 />}
              title="Open a project to start"
              description="Connect to the local runtime to start a model chat, or open a Git repository for a coding agent."
              action={
                <Button variant="primary" size="sm" onClick={() => navigate("repositories")}>
                  Open repository…
                </Button>
              }
            />
          )}
        </div>
      </>
    );
  }

  // ── Conversation ───────────────────────────────────────────────────────
  const snapshot = snapshotQuery.data;
  const session = snapshot?.session;
  const running = session ? isRunActive(session.status) : false;
  const sessionProvider = session ? providers.data?.find((p) => p.agentId === session.agentId) : undefined;
  const providerBlocked = sessionProvider && sessionProvider.status !== "ready" ? sessionProvider.detail : undefined;

  if (snapshotQuery.isError) {
    return (
      <>
        <SessionHeader project={project} leading={toolbar} />
        <ErrorState title="Couldn't load this chat" message={errorMessage(snapshotQuery.error)} onRetry={() => void snapshotQuery.refetch()} />
      </>
    );
  }

  const group = session?.groupId ? (allSessions.data ?? []).filter((s) => s.groupId === session.groupId) : [];
  return (
    <>
      <SessionHeader session={session} project={project} onCancel={() => cancel.mutate()} leading={toolbar} />
      {group.length > 1 ? (
        <div className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-fg-muted">
          <Users className="size-3.5" /> Part of a {group.length}-agent run
          <Button size="xs" variant="ghost" onClick={() => { setPrefs({ boardSessionIds: group.map((s) => s.id) }); navigate("board"); }}>
            <Columns3 /> View side by side
          </Button>
        </div>
      ) : null}
      <AgentEventTimeline
        items={snapshot?.timeline ?? []}
        agentId={session?.agentId}
        status={session?.status}
        loading={snapshotQuery.isPending}
        onResolveApproval={(approvalId, decision) => resolve.mutateAsync({ approvalId, decision })}
        empty={<EmptyState icon={<MessageSquare />} title="No messages yet" description="Send a message to start." />}
      />
      {queue.data?.length ? (
        <div className="mx-auto w-full max-w-[48rem] px-3 pb-2 sm:px-6" aria-label="Queued messages">
          <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-border bg-surface-2 p-2">
            <p className="px-2 text-xs font-medium text-fg-muted">Queued messages · {queue.data.length}</p>
            {queue.data.map((message) => (
              <div key={message.id} className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{message.text}</span>
                <Button size="icon" variant="ghost" aria-label="Remove queued message" onClick={() => removeQueued.mutate(message.id)}><X className="size-3.5" /></Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <ChatComposer
        ref={composerRef}
        running={running}
        queueWhileRunning
        cancelling={session?.status === "cancelling"}
        onCancel={() => cancel.mutate()}
        disabledReason={providerBlocked}
        placeholder={session?.status === "awaiting_approval" ? "Answer the approval above, or send a follow-up…" : "Send a follow-up…"}
        footer={
          actionError ? (
            <span className="text-danger">{actionError}</span>
          ) : cancel.isError ? (
            <span className="text-danger">{errorMessage(cancel.error)}</span>
          ) : session ? (
            <ComposerFooter demo={demo} project={project} agentId={session.agentId} />
          ) : null
        }
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
}
