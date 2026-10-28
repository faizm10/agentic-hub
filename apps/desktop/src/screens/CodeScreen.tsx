import { Button, EmptyState, ErrorState, Input, Skeleton, Tooltip, cn } from "@agentic-hub/ui";
import { errorMessage, useCancelJob, useClient, useFileContent, useFiles, useJobs, useRunCommand, useWriteFile, workspaceKeys } from "@agentic-hub/ui/client";
import { MODEL_CHAT_PROJECT_ID, type FileEntry, type Job, type Project, type SessionSnapshot, type SessionSummary } from "@agentic-hub/ui/model";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Circle, File, FolderGit2, FolderOpen, GitBranch, PanelBottom, RefreshCw, Save, Sparkles, SquareTerminal, X } from "lucide-react";
import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { AgentActivityStrip } from "../components/AgentActivityStrip";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { JobOutput, JobStatusBadge } from "../components/JobOutput";
import { useAppState } from "../state/app-state";

const CodeEditor = lazy(() => import("../editor/CodeEditor"));

function Handle({ vertical }: { vertical?: boolean }) {
  return (
    <Separator
      className={cn(
        "relative shrink-0 bg-border outline-none transition-colors data-[separator=hover]:bg-accent/60 data-[separator=active]:bg-accent",
        vertical ? "h-px" : "w-px",
      )}
    >
      <span className={vertical ? "absolute inset-x-0 -top-1 -bottom-1" : "absolute inset-y-0 -left-1 -right-1"} />
    </Separator>
  );
}

// ── Explorer ───────────────────────────────────────────────────────────

function TreeNode({
  entry,
  depth,
  ctx,
}: {
  entry: FileEntry;
  depth: number;
  ctx: { projectId: string; sessionId?: string; open: (path: string) => void; activePath?: string; agentPaths: Set<string>; expanded: Set<string>; toggle: (path: string) => void };
}) {
  const isDir = entry.type === "directory";
  const expanded = ctx.expanded.has(entry.path);
  const byAgent = ctx.agentPaths.has(entry.path) || (isDir && [...ctx.agentPaths].some((p) => p.startsWith(`${entry.path}/`)));
  return (
    <li>
      <button
        type="button"
        onClick={() => (isDir ? ctx.toggle(entry.path) : ctx.open(entry.path))}
        className={cn(
          "flex w-full items-center gap-1 rounded-md py-[3px] pr-2 text-left text-[13px] text-fg-muted hover:bg-surface-3 hover:text-fg focus-ring",
          ctx.activePath === entry.path && "bg-surface-3 text-fg",
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        aria-expanded={isDir ? expanded : undefined}
        title={entry.path}
      >
        {isDir ? expanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" /> : <span className="w-3.5 shrink-0" />}
        {isDir ? <FolderOpen className="size-3.5 shrink-0 text-fg-subtle" /> : <File className="size-3.5 shrink-0 text-fg-subtle" />}
        <span className={cn("min-w-0 flex-1 truncate", entry.changed && "text-warning")}>{entry.name}</span>
        {byAgent ? (
          <Tooltip content="Changed by the agent">
            <Sparkles className="size-3 shrink-0 text-accent" aria-label="Changed by the agent" />
          </Tooltip>
        ) : entry.changed ? (
          <Circle className="size-2 shrink-0 fill-current text-warning" aria-label="Modified" />
        ) : null}
      </button>
      {isDir && expanded ? <TreeLevel path={entry.path} depth={depth + 1} ctx={ctx} /> : null}
    </li>
  );
}

function TreeLevel({ path, depth, ctx }: { path: string; depth: number; ctx: Parameters<typeof TreeNode>[0]["ctx"] }) {
  const files = useFiles(ctx.projectId, path, ctx.sessionId);
  if (files.isPending) return <Skeleton className="mx-3 my-1 h-3 w-24" />;
  if (files.isError) return <p className="px-3 py-1 text-xs text-danger">{errorMessage(files.error)}</p>;
  return (
    <ul>
      {files.data.map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={depth} ctx={ctx} />
      ))}
    </ul>
  );
}

// ── Editor tabs ────────────────────────────────────────────────────────

type Tab = { path: string; draft?: string };

function EditorPane({ projectId, sessionId, tab, onDraft, onSaved }: { projectId: string; sessionId?: string; tab: Tab; onDraft: (draft: string | undefined) => void; onSaved: () => void }) {
  const file = useFileContent(projectId, tab.path, sessionId);
  const write = useWriteFile(projectId, sessionId);
  if (file.isPending) return <div className="p-4"><Skeleton className="h-4 w-1/2" /></div>;
  if (file.isError) return <ErrorState message={errorMessage(file.error)} onRetry={() => void file.refetch()} />;
  if (file.data.binary) return <EmptyState icon={<File />} title="Binary file" description="This file can't be shown as text." />;
  const save = () => {
    if (tab.draft === undefined || file.data.truncated) return;
    write.mutate({ path: tab.path, content: tab.draft }, { onSuccess: () => { onDraft(undefined); onSaved(); } });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {file.data.truncated ? <p className="border-b border-border bg-warning-soft px-3 py-1 text-xs text-warning">Large file: showing the first 2 MB, read-only.</p> : null}
      {write.isError ? <p className="border-b border-border bg-danger-soft px-3 py-1 text-xs text-danger">Couldn't save: {errorMessage(write.error)}</p> : null}
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="p-4 text-sm text-fg-muted">Loading editor…</div>}>
          <CodeEditor
            path={`${sessionId ?? "main"}/${tab.path}`}
            value={tab.draft ?? file.data.content}
            language={file.data.language}
            readOnly={file.data.truncated}
            onChange={(next) => onDraft(next === file.data.content ? undefined : next)}
            onSave={save}
          />
        </Suspense>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-1 text-2xs text-fg-subtle">
        <span className="font-mono">{tab.path}</span>
        <span>{file.data.language}</span>
        <span className="flex-1" />
        {write.isPending ? <span>Saving…</span> : tab.draft !== undefined ? <span className="text-warning">Unsaved · ⌘S to save</span> : <span>Saved</span>}
        <Button size="xs" variant="ghost" onClick={save} disabled={tab.draft === undefined || write.isPending}>
          <Save /> Save
        </Button>
      </div>
    </div>
  );
}

// ── Terminal ───────────────────────────────────────────────────────────

function TerminalPanel({ projectId, sessionId, cwdLabel, cwdName }: { projectId: string; sessionId?: string; cwdLabel: string; cwdName: string }) {
  const jobs = useJobs(projectId);
  const run = useRunCommand(projectId, sessionId);
  const cancel = useCancelJob(projectId);
  const [command, setCommand] = useState("");
  const [selected, setSelected] = useState<string | undefined>();
  const history = useRef<string[]>([]);
  const cursor = useRef(-1);
  const all = jobs.data ?? [];
  const terminalJobs = all.filter((j) => j.kind === "terminal");
  const current = all.find((j) => j.id === selected) ?? terminalJobs[0];

  const submit = () => {
    const text = command.trim();
    if (!text) return;
    history.current = [text, ...history.current.filter((h) => h !== text)].slice(0, 50);
    cursor.current = -1;
    run.mutate(text, { onSuccess: (job) => setSelected(job.id) });
    setCommand("");
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-56 shrink-0 flex-col border-r border-border">
        <p className="px-3 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-fg-subtle">Activity</p>
        <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {all.length === 0 ? <li className="px-2 py-1 text-xs text-fg-subtle">Commands and integration actions appear here.</li> : null}
          {all.map((job: Job) => (
            <li key={job.id}>
              <button
                type="button"
                onClick={() => setSelected(job.id)}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-3 focus-ring", current?.id === job.id && "bg-surface-3")}
              >
                {job.kind === "terminal" ? <SquareTerminal className="size-3.5 shrink-0 text-fg-subtle" /> : <Sparkles className="size-3.5 shrink-0 text-accent" />}
                <span className="min-w-0 flex-1 truncate text-fg">{job.title}</span>
                <JobStatusBadge status={job.status} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {current ? <JobOutput key={current.id} job={current} onCancel={() => cancel.mutate(current.id)} className="min-h-0 flex-1" /> : <div className="flex-1" />}
        <form
          className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <span className="shrink-0 font-mono text-xs text-fg-subtle" title={cwdLabel}>
            {cwdName} $
          </span>
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" && history.current.length) {
                e.preventDefault();
                cursor.current = Math.min(cursor.current + 1, history.current.length - 1);
                setCommand(history.current[cursor.current] ?? "");
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                cursor.current = Math.max(cursor.current - 1, -1);
                setCommand(cursor.current < 0 ? "" : (history.current[cursor.current] ?? ""));
              }
            }}
            placeholder="Run a command, e.g. pnpm test"
            aria-label="Terminal command"
            className="h-7 flex-1 border-0 bg-transparent px-0 font-mono text-xs shadow-none focus-visible:ring-0"
            spellCheck={false}
            autoComplete="off"
          />
          {run.isError ? <span className="text-xs text-danger">{errorMessage(run.error)}</span> : null}
        </form>
      </div>
    </div>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────

export function CodeScreen({
  toolbar,
  project,
  sessions,
  snapshot,
}: {
  toolbar: ReactNode;
  project?: Project;
  sessions: SessionSummary[];
  snapshot?: SessionSnapshot;
}) {
  const { prefs, setPrefs, navigate, selectSession } = useAppState();
  const client = useClient();
  const queryClient = useQueryClient();
  const live = client.mode === "live";
  const projectId = live && project && project.id !== MODEL_CHAT_PROJECT_ID ? project.id : undefined;
  const activeSession = snapshot?.session.projectId === projectId ? snapshot?.session : undefined;
  // Scope: the active session's worktree when it has one, otherwise the main checkout.
  const worktreeSessions = sessions.filter((s) => s.projectId === projectId && s.worktree);
  const [scopeId, setScopeId] = useState<string | undefined>(activeSession?.worktree ? activeSession.id : undefined);
  const scope = worktreeSessions.find((s) => s.id === scopeId);
  const sessionId = scope?.id;
  const cwdLabel = scope?.worktree?.path ?? project?.path ?? "";

  const [tabsState, setTabsState] = useState<{ key: string; tabs: Tab[]; active?: string }>({ key: "", tabs: [] });
  const tabsKey = `${projectId ?? ""}|${sessionId ?? ""}`;
  const { tabs, active } = tabsState.key === tabsKey ? tabsState : { tabs: [] as Tab[], active: undefined };
  const setTabs = (fn: (s: { tabs: Tab[]; active?: string }) => { tabs: Tab[]; active?: string }) => setTabsState((s) => ({ key: tabsKey, ...fn(s.key === tabsKey ? s : { tabs: [] }) }));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [discard, setDiscard] = useState<string | null>(null);
  const bottomOpen = prefs.bottomPanelOpen;

  // Files the agent touched in the scoped checkout, from live session events.
  const showsAgent = snapshot && (snapshot.session.worktree ? snapshot.session.id === sessionId : !sessionId);
  const agentPaths = new Set(showsAgent ? snapshot.changes.map((c) => c.path) : []);

  // When the agent changes files, refresh the tree and any open file without local edits.
  const changeSignature = snapshot ? `${snapshot.lastSeq}:${snapshot.changes.map((c) => `${c.path}${c.additions}${c.deletions}`).join(",")}` : "";
  const lastSignature = useRef(changeSignature);
  useEffect(() => {
    if (!projectId || lastSignature.current === changeSignature) return;
    lastSignature.current = changeSignature;
    void queryClient.invalidateQueries({ queryKey: ["files", projectId] });
    for (const tab of tabs) if (tab.draft === undefined) void queryClient.invalidateQueries({ queryKey: workspaceKeys.file(projectId, sessionId, tab.path) });
  }, [changeSignature, projectId, sessionId, tabs, queryClient]);

  if (!live) return <EmptyState icon={<FolderGit2 />} title="Editor needs the local runtime" description="Switch the data source to the local runtime to browse and edit files." action={<Button onClick={() => navigate("settings")}>Open settings</Button>} />;
  if (!projectId || !project)
    return (
      <>
        <header data-tauri-drag-region className="flex h-12 shrink-0 items-center px-2">{toolbar}</header>
        <EmptyState icon={<FolderGit2 />} title="Open a repository" description="Browse files, edit code and run commands in a repository on this computer." action={<Button variant="primary" onClick={() => navigate("repositories")}>Open repository…</Button>} />
      </>
    );

  const open = (path: string) => setTabs((s) => ({ tabs: s.tabs.some((t) => t.path === path) ? s.tabs : [...s.tabs, { path }], active: path }));
  const close = (path: string, force = false) => {
    const tab = tabs.find((t) => t.path === path);
    if (tab?.draft !== undefined && !force) return setDiscard(path);
    setTabs((s) => {
      const rest = s.tabs.filter((t) => t.path !== path);
      return { tabs: rest, active: s.active === path ? rest.at(-1)?.path : s.active };
    });
  };
  const activeTab = tabs.find((t) => t.path === active);
  const ctx = { projectId, sessionId, open, activePath: active, agentPaths, expanded, toggle: (p: string) => setExpanded((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; }) };

  return (
    <>
      <header data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        {toolbar}
        <FolderGit2 className="ml-1 size-4 text-fg-subtle" />
        <span className="truncate text-sm font-medium">{project.name}</span>
        <label className="ml-2 flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
          <GitBranch className="size-3.5" />
          <select
            className="h-7 max-w-[16rem] truncate rounded-md border border-border bg-surface px-1.5 text-xs text-fg focus-ring"
            value={sessionId ?? ""}
            onChange={(e) => setScopeId(e.target.value || undefined)}
            aria-label="Checkout"
          >
            <option value="">{project.branch ?? "Main checkout"} (main checkout)</option>
            {worktreeSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.worktree!.branch} · {s.title.slice(0, 40)}
              </option>
            ))}
          </select>
        </label>
        <span className="flex-1" />
        <Tooltip content="Refresh files">
          <Button size="icon" variant="ghost" aria-label="Refresh files" onClick={() => void queryClient.invalidateQueries({ queryKey: ["files", projectId] })}>
            <RefreshCw />
          </Button>
        </Tooltip>
        <Tooltip content={bottomOpen ? "Hide terminal" : "Show terminal"} shortcut="mod+`">
          <Button size="icon" variant="ghost" aria-label="Toggle terminal" aria-pressed={bottomOpen} onClick={() => setPrefs({ bottomPanelOpen: !bottomOpen })}>
            <PanelBottom />
          </Button>
        </Tooltip>
      </header>
      {snapshot && activeSession ? <AgentActivityStrip snapshot={snapshot} onOpenChat={() => selectSession(snapshot.session.id, snapshot.session.projectId)} /> : null}
      <Group orientation="horizontal" id="agentic-hub.layout.code" className="min-h-0 flex-1">
        <Panel id="explorer" defaultSize="22%" minSize={160} maxSize="45%" className="flex min-w-0 flex-col">
          <p className="px-3 pb-1 pt-2.5 text-2xs font-medium uppercase tracking-wide text-fg-subtle">Explorer</p>
          <nav aria-label="Files" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
            <TreeLevel path="" depth={0} ctx={ctx} />
          </nav>
        </Panel>
        <Handle />
        <Panel id="editor" minSize={320} className="flex min-w-0 flex-col">
          <Group orientation="vertical" id="agentic-hub.layout.code-v" className="min-h-0 flex-1">
            <Panel id="tabs" minSize={120} className="flex min-h-0 flex-col">
              {tabs.length ? (
                <div role="tablist" aria-label="Open files" className="flex shrink-0 overflow-x-auto border-b border-border bg-surface-2/40">
                  {tabs.map((tab) => (
                    <div key={tab.path} className={cn("group flex shrink-0 items-center border-r border-border text-xs", tab.path === active ? "bg-bg text-fg" : "text-fg-muted hover:text-fg")}>
                      <button type="button" role="tab" aria-selected={tab.path === active} onClick={() => setTabs((s) => ({ ...s, active: tab.path }))} className="flex items-center gap-1.5 py-1.5 pl-3 pr-1 focus-ring">
                        {agentPaths.has(tab.path) ? <Sparkles className="size-3 text-accent" /> : null}
                        {tab.path.split("/").pop()}
                        {tab.draft !== undefined ? <Circle className="size-2 fill-current" aria-label="Unsaved" /> : null}
                      </button>
                      <button type="button" aria-label={`Close ${tab.path}`} onClick={() => close(tab.path)} className="mr-1 rounded p-0.5 opacity-60 hover:bg-surface-3 hover:opacity-100 focus-ring">
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {activeTab ? (
                <EditorPane
                  key={`${sessionId ?? "main"}:${activeTab.path}`}
                  projectId={projectId}
                  sessionId={sessionId}
                  tab={activeTab}
                  onDraft={(draft) => setTabs((s) => ({ ...s, tabs: s.tabs.map((t) => (t.path === activeTab.path ? { ...t, draft } : t)) }))}
                  onSaved={() => void queryClient.invalidateQueries({ queryKey: ["session"] })}
                />
              ) : (
                <EmptyState icon={<File />} title="No file open" description="Pick a file in the explorer. Files the agent changes are marked with a sparkle." />
              )}
            </Panel>
            {bottomOpen ? (
              <>
                <Handle vertical />
                <Panel id="terminal" defaultSize="32%" minSize={110} className="min-h-0">
                  <TerminalPanel projectId={projectId} sessionId={sessionId} cwdLabel={cwdLabel} cwdName={scope?.worktree?.branch ?? project.name} />
                </Panel>
              </>
            ) : null}
          </Group>
        </Panel>
      </Group>
      <ConfirmDialog
        open={discard !== null}
        onOpenChange={(o) => !o && setDiscard(null)}
        title="Discard unsaved changes?"
        description={<>Your edits to <code className="font-mono">{discard}</code> haven&rsquo;t been saved.</>}
        risk="medium"
        confirmLabel="Discard"
        onConfirm={() => {
          if (discard) close(discard, true);
          setDiscard(null);
        }}
      />
    </>
  );
}
