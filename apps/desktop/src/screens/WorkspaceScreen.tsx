import {
  AgentEventTimeline,
  AgentSelector,
  Button,
  ChatComposer,
  DisconnectedState,
  EmptyState,
  ErrorState,
  ModelSelector,
  NewChatHero,
  SessionHeader,
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
  useResolveApproval,
  useSendMessage,
} from "@agentic-hub/ui/client";
import { AGENT_DISPLAY, isRunActive, type AgentId, type Project, type SessionSnapshot } from "@agentic-hub/ui/model";
import type { UseQueryResult } from "@tanstack/react-query";
import { FolderGit2, GitBranch, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { restartNativeRuntime, useNativeRuntimeStatus } from "../platform/runtime-status";
import { useAppState } from "../state/app-state";

function ComposerFooter({ demo, project, agentId }: { demo: boolean; project?: Project; agentId: AgentId }) {
  if (demo) return <span className="text-info">Sample data. Replies are scripted, not a real agent.</span>;
  if (AGENT_DISPLAY[agentId].kind === "model") return <span>{AGENT_DISPLAY[agentId].name} answers in chat and can&rsquo;t see or change your files.</span>;
  return project ? <span>{AGENT_DISPLAY[agentId].name} works in <span className="font-mono">{project.path}</span> and asks before risky actions.</span> : null;
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
  const { prefs, setPrefs, selectSession, navigate } = useAppState();
  const client = useClient();
  const demo = client.mode === "demo";
  const agents = useAgents();
  const providers = useProviders();
  const sessionId = prefs.activeSessionId;
  const send = useSendMessage(sessionId);
  const cancel = useCancelRun(sessionId);
  const resolve = useResolveApproval(sessionId);
  const create = useCreateSession();
  const composerRef = useRef<ChatComposerHandle>(null);
  // Errors belong to the chat they happened in, so switching chats clears them.
  const [errorState, setErrorState] = useState<{ sessionId?: string; message: string } | null>(null);
  const actionError = errorState && errorState.sessionId === sessionId ? errorState.message : null;
  const setActionError = (message: string | null) => setErrorState(message ? { sessionId, message } : null);
  const choice = useModelChoice(composerAgent);

  useEffect(() => {
    composerRef.current?.focus();
  }, [sessionId]);

  if (projectsQuery.isError) {
    if (isUnavailable(projectsQuery.error)) {
      return <UnavailableMain toolbar={toolbar} detail={errorMessage(projectsQuery.error)} onRetry={() => void projectsQuery.refetch()} />;
    }
    return <ErrorState message={errorMessage(projectsQuery.error)} onRetry={() => void projectsQuery.refetch()} />;
  }

  // ── New chat ──────────────────────────────────────────────────────────
  if (!sessionId) {
    const provider = providers.data?.find((p) => p.agentId === composerAgent);
    const blocked = provider && provider.status !== "ready" ? (provider.detail ?? `${AGENT_DISPLAY[composerAgent].name} isn't ready yet.`) : undefined;
    const kind = AGENT_DISPLAY[composerAgent].kind;
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
                title={kind === "model" ? "What’s on your mind?" : "What should we build today?"}
                subtitle={
                  <span className="flex flex-wrap items-center justify-center gap-x-1.5">
                    <FolderGit2 className="size-3.5" /> {project.name}
                    <GitBranch className="ml-1 size-3.5" /> <span className="font-mono text-xs">{project.branch}</span>
                  </span>
                }
                onSuggestion={blocked ? undefined : (prompt) => composerRef.current?.setText(prompt)}
                className="mb-8 animate-in fade-in-0 slide-in-from-bottom-1 duration-300"
              />
              <ChatComposer
                ref={composerRef}
                placeholder={kind === "model" ? `Message ${AGENT_DISPLAY[composerAgent].name}…` : `Describe a task for ${AGENT_DISPLAY[composerAgent].name}…`}
                disabledReason={blocked}
                toolbar={
                  <>
                    <AgentSelector
                      agents={agents.data ?? []}
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
                    const session = await create.mutateAsync({ projectId: project.id, agentId: composerAgent, model: choice.model, prompt });
                    selectSession(session.id, project.id);
                  } catch (e) {
                    setActionError(errorMessage(e));
                    throw e;
                  }
                }}
              />
            </>
          ) : (
            <EmptyState
              icon={<FolderGit2 />}
              title="Open a project to start"
              description="Chats and agent runs belong to a Git repository on this computer."
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

  return (
    <>
      <SessionHeader session={session} project={project} onCancel={() => cancel.mutate()} leading={toolbar} />
      <AgentEventTimeline
        items={snapshot?.timeline ?? []}
        agentId={session?.agentId}
        status={session?.status}
        loading={snapshotQuery.isPending}
        onResolveApproval={(approvalId, decision) => resolve.mutateAsync({ approvalId, decision })}
        empty={<EmptyState icon={<MessageSquare />} title="No messages yet" description="Send a message to start." />}
      />
      <ChatComposer
        ref={composerRef}
        running={running}
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
