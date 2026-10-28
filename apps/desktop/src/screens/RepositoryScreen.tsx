import { Button, DisconnectedState, EmptyState, ErrorState, Input, Kbd, MODEL_CHAT_PROJECT_ID, SectionLabel, Skeleton, formatRelative } from "@agentic-hub/ui";
import { errorMessage, isUnavailable, useAddProject, useClient, useEnvironment, useProjects } from "@agentic-hub/ui/client";
import { FolderGit2, FolderOpen, GitBranch, LoaderCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { GitHubImport } from "../components/GitHubImport";
import { isTauri, pickRepositoryFolder } from "../platform/native";
import { useAppState } from "../state/app-state";
import { ScreenBody, ScreenHeader } from "./ScreenHeader";

export function RepositoryScreen({ toolbar }: { toolbar: ReactNode }) {
  const { setPrefs, navigate } = useAppState();
  const client = useClient();
  const projects = useProjects();
  const add = useAddProject();
  const [manualPath, setManualPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const native = isTauri();
  const repositories = projects.data?.filter((p) => p.id !== MODEL_CHAT_PROJECT_ID);
  const environment = useEnvironment(client.mode === "live");
  const gh = environment.data?.tools.find((t) => t.id === "gh");

  const register = async (path: string) => {
    setError(null);
    try {
      const project = await add.mutateAsync(path);
      setPrefs({ activeProjectId: project.id, activeSessionId: undefined });
      navigate("workspace");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const pick = async () => {
    setError(null);
    try {
      const result = await pickRepositoryFolder();
      if (result.kind === "picked") await register(result.path);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <ScreenHeader title="Repositories" toolbar={toolbar} />
      <ScreenBody width="max-w-2xl">
        <div className="rounded-xl border border-dashed border-border-strong bg-surface p-6 text-center">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl border border-border bg-surface-2 text-fg-muted">
            <FolderOpen className="size-5" />
          </div>
          <h2 className="text-base font-medium text-fg">Open a Git repository</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
            Agents work inside the folder you choose. The runtime validates that it&rsquo;s a Git repository before any session starts.
          </p>
          <div className="mt-4 flex justify-center">
            <Button variant="primary" onClick={pick} disabled={!native || add.isPending}>
              {add.isPending ? <LoaderCircle className="animate-spin" /> : <FolderOpen />}
              Choose folder…
              <Kbd keys="mod+o" className="ml-1 opacity-70 [&_kbd]:border-white/20 [&_kbd]:bg-white/10 [&_kbd]:text-current" />
            </Button>
          </div>
          {!native ? (
            <form
              className="mx-auto mt-4 flex max-w-md gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (manualPath.trim()) void register(manualPath.trim());
              }}
            >
              <Input value={manualPath} onChange={(e) => setManualPath(e.target.value)} placeholder="/path/to/repository" aria-label="Repository path" className="font-mono text-xs" />
              <Button type="submit" disabled={!manualPath.trim() || add.isPending}>
                Add
              </Button>
            </form>
          ) : null}
          {!native ? <p className="mt-2 text-2xs text-fg-subtle">The native folder picker is available in the desktop app. In a browser preview, enter a path instead.</p> : null}
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>

        {client.mode === "live" ? (
          <>
            <SectionLabel className="mb-2 mt-8">Import from GitHub</SectionLabel>
            <GitHubImport
              githubConnected={Boolean(gh?.authenticated)}
              cloneDirectory={environment.data?.cloneDirectory}
              onImported={(project) => {
                setPrefs({ activeProjectId: project.id, activeSessionId: undefined });
                navigate("workspace");
              }}
            />
          </>
        ) : null}

        <SectionLabel className="mb-2 mt-8">Recent</SectionLabel>
        {projects.isPending ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : projects.isError ? (
          isUnavailable(projects.error) ? (
            <DisconnectedState title="Runtime offline" detail="Recent repositories are stored by the runtime." onRetry={() => void projects.refetch()} />
          ) : (
            <ErrorState compact message={errorMessage(projects.error)} onRetry={() => void projects.refetch()} />
          )
        ) : repositories?.length === 0 ? (
          <EmptyState compact icon={<FolderGit2 />} title="No repositories yet" description="Repositories you open will be listed here." />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {repositories?.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPrefs({ activeProjectId: p.id, activeSessionId: undefined });
                    navigate("workspace");
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-ring"
                >
                  <FolderGit2 className="size-4 shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{p.name}</span>
                    <span className="block truncate font-mono text-2xs text-fg-subtle">{p.path}</span>
                  </span>
                  <span className="hidden items-center gap-1 font-mono text-2xs text-fg-subtle sm:flex">
                    <GitBranch className="size-3" />
                    {p.branch}
                  </span>
                  <span className="w-16 text-right text-2xs text-fg-subtle">{formatRelative(p.lastOpenedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {client.mode === "demo" ? <p className="mt-3 text-2xs text-info">Demo mode: recent repositories are sample fixtures.</p> : null}
      </ScreenBody>
    </>
  );
}
