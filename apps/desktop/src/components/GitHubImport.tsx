import { Badge, Button, Input, Skeleton, formatRelative } from "@agentic-hub/ui";
import { errorMessage, useCloneRepository, useGitHubRepositories } from "@agentic-hub/ui/client";
import type { Project } from "@agentic-hub/ui/model";
import { Download, Lock, LoaderCircle, Search } from "lucide-react";
import { useState } from "react";

/**
 * Import a GitHub repository: pick from the signed-in account's repositories
 * or paste owner/name or a URL. The runtime clones it with the user's `gh`
 * sign-in (or anonymously for public repositories) and registers it.
 */
export function GitHubImport({ githubConnected, cloneDirectory, onImported }: { githubConnected: boolean; cloneDirectory?: string; onImported: (project: Project) => void }) {
  const repos = useGitHubRepositories(githubConnected);
  const clone = useCloneRepository();
  const [filter, setFilter] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const list = (repos.data ?? []).filter((r) => r.nameWithOwner.toLowerCase().includes(filter.toLowerCase())).slice(0, 8);
  const looksLikeRepo = /^[\w.-]+\/[\w.-]+$|github\.com[/:]/.test(filter.trim());

  const run = (repository: string) => {
    setTarget(repository);
    clone.mutate({ repository }, { onSuccess: onImported });
  };

  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (looksLikeRepo) run(filter.trim());
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={githubConnected ? "Search your repositories or paste owner/name" : "owner/name or https://github.com/…"} aria-label="GitHub repository" className="pl-8" />
        </div>
        <Button type="submit" disabled={!looksLikeRepo || clone.isPending}>
          {clone.isPending && target === filter.trim() ? <LoaderCircle className="animate-spin" /> : <Download />} Clone
        </Button>
      </form>
      {cloneDirectory ? <p className="text-2xs text-fg-subtle">Clones into <span className="font-mono">{cloneDirectory}</span>. If the folder already has the repository, it&rsquo;s opened instead.</p> : null}
      {clone.isError ? <p role="alert" className="text-xs text-danger">{errorMessage(clone.error)}</p> : null}
      {githubConnected ? (
        repos.isPending ? (
          <div className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : repos.isError ? (
          <p className="text-xs text-danger">{errorMessage(repos.error)}</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {list.map((repo) => (
              <li key={repo.nameWithOwner} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-sm font-medium text-fg">
                    {repo.nameWithOwner} {repo.isPrivate ? <Lock className="size-3 text-fg-subtle" aria-label="Private" /> : null}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">{repo.description || `Updated ${formatRelative(repo.updatedAt)}`}</span>
                </span>
                <Button size="xs" onClick={() => run(repo.nameWithOwner)} disabled={clone.isPending}>
                  {clone.isPending && target === repo.nameWithOwner ? <LoaderCircle className="animate-spin" /> : null}
                  {clone.isPending && target === repo.nameWithOwner ? "Cloning…" : "Clone"}
                </Button>
              </li>
            ))}
            {!list.length ? <li className="px-3 py-2 text-xs text-fg-muted">{filter ? "No matching repositories." : "No repositories on this account."}</li> : null}
          </ul>
        )
      ) : (
        <p className="text-xs text-fg-muted">
          <Badge>Tip</Badge> Sign in with <code className="font-mono">gh auth login --web</code> to browse your private repositories here.
        </p>
      )}
    </div>
  );
}
