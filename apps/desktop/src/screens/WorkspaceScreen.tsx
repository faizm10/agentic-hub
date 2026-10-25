import {
  AgentEventTimeline,
  AgentLabel,
  AgentSelector,
  Button,
  ChatComposer,
  DisconnectedState,
  EmptyState,
  ErrorState,
  Kbd,
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
  useProviders,
  useResolveApproval,
  useSendMessage,
} from "@agentic-hub/ui/client";
import { AGENT_DISPLAY, isRunActive, type AgentId, type Project, type SessionSnapshot } from "@agentic-hub/ui/model";
import type { UseQueryResult } from "@tanstack/react-query";
import { FolderGit2, GitBranch, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppState } from "../state/app-state";

function ComposerFooter({ demo, project }: { demo: boolean; project?: Project }) {
  if (demo) return <span className="text-info">Demo mode — replies are scripted fixtures, not a real agent.</span>;
  return project ? <span className="font-mono">{project.path}</span> : null;
}

function UnavailableMain({ toolbar, detail, onRetry }: { toolbar: ReactNode; detail: string; onRetry: () => void }) {
  const { setPrefs } = useAppState();
  return (
    <>
      <header data-tauri-drag-region className="flex h-11 shrink-0 items-center border-b border-border px-2">
        {toolbar}
      </header>
      <div className="flex flex-1 items-center justify-center">
        <DisconnectedState
          title="Local runtime offline"
          detail={
            <>
              {detail}
              <br />
              Start the runtime on this machine, then retry. You can explore the interface with sample data meanwhile.
            </>
          }
          onRetry={onRetry}
          action={
            <Button size="sm" variant="ghost" onClick={() => setPrefs({ dataMode: "demo" })}>
              Use demo data
            </Button>
          }
        />
      </div>
    </>
  );
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
  const { prefs, setPrefs, selectSession } = useAppState();
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
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    composerRef.current?.focus();
  }, [sessionId]);

  if (projectsQuery.isError) {
    if (isUnavailable(projectsQuery.error)) {
      return <UnavailableMain toolbar={toolbar} detail={errorMessage(projectsQuery.error)} onRetry={() => void projectsQuery.refetch()} />;
    }
    return <ErrorState message={errorMessage(projectsQuery.error)} onRetry={() => void projectsQuery.refetch()} />;
  }

  // ── No session selected: start a new one ──────────────────────────────
  if (!sessionId) {
    const provider = providers.data?.find((p) => p.agentId === composerAgent);
    const agentBlocked = provider && provider.status !== "ready";
    return (
      <>
        <header data-tauri-drag-region className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2">
          {toolbar}
          <span className="px-1 text-sm font-medium text-fg">New session</span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col justify-center pb-[8vh]">
          {project ? (
            <div className="mx-auto mb-6 w-full max-w-[52rem] px-5 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
              <h2 className="text-xl font-semibold tracking-[-0.015em] text-fg">What should we work on?</h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-fg-muted">
                <FolderGit2 className="size-3.5" /> {project.name}
                <GitBranch className="ml-1 size-3.5" /> <span className="font-mono text-xs">{project.branch}</span>
              </p>
            </div>
          ) : (
            <EmptyState icon={<FolderGit2 />} title="No project selected" description="Open a repository to start a session." />
          )}
          {project ? (
            <ChatComposer
              ref={composerRef}
              placeholder={`Describe a task for ${AGENT_DISPLAY[composerAgent].name}…`}
              disabledReason={agentBlocked ? `${AGENT_DISPLAY[composerAgent].name} isn't ready — check Providers.` : undefined}
              toolbar={
                <AgentSelector
                  agents={agents.data ?? []}
                  providers={providers.data}
                  value={composerAgent}
                  onChange={(id) => {
                    onComposerAgentChange(id);
                    setPrefs({ defaultAgent: id });
                  }}
                  disabled={!agents.data}
                />
              }
              footer={
                actionError ? <span className="text-danger">{actionError}</span> : <ComposerFooter demo={demo} project={project} />
              }
              onSubmit={async (prompt) => {
                setActionError(null);
                try {
                  const session = await create.mutateAsync({ projectId: project.id, agentId: composerAgent, prompt });
                  selectSession(session.id, project.id);
                } catch (e) {
                  setActionError(errorMessage(e));
                  throw e;
                }
              }}
            />
          ) : null}
          <div className="mx-auto mt-6 flex items-center gap-4 text-xs text-fg-subtle">
            <span className="flex items-center gap-1.5">
              <Kbd keys="mod+1" />–<Kbd keys="mod+3" /> switch agent
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd keys="mod+k" /> commands
            </span>
          </div>
        </div>
      </>
    );
  }

  // ── Session view ───────────────────────────────────────────────────────
  const snapshot = snapshotQuery.data;
  const session = snapshot?.session;
  const running = session ? isRunActive(session.status) : false;

  if (snapshotQuery.isError) {
    return (
      <>
        <SessionHeader project={project} leading={toolbar} />
        <ErrorState title="Couldn't load this session" message={errorMessage(snapshotQuery.error)} onRetry={() => void snapshotQuery.refetch()} />
      </>
    );
  }

  return (
    <>
      <SessionHeader
        session={session}
        project={project}
        onCancel={() => cancel.mutate()}
        leading={toolbar}
      />
      <AgentEventTimeline
        items={snapshot?.timeline ?? []}
        status={session?.status}
        loading={snapshotQuery.isPending}
        onResolveApproval={(approvalId, decision) => resolve.mutateAsync({ approvalId, decision })}
        empty={<EmptyState icon={<MessageSquare />} title="No messages yet" description="Send a prompt to start the run." />}
      />
      <ChatComposer
        ref={composerRef}
        running={running}
        cancelling={session?.status === "cancelling"}
        onCancel={() => cancel.mutate()}
        placeholder={session?.status === "awaiting_approval" ? "Respond to the approval above, or send a follow-up…" : "Send a follow-up…"}
        toolbar={session ? <AgentLabel agentId={session.agentId} className="px-1.5 text-xs text-fg-muted" /> : null}
        footer={actionError ? <span className="text-danger">{actionError}</span> : <ComposerFooter demo={demo} project={project} />}
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
