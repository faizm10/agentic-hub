"use client";

import { ConnectionBanner, ErrorState, Input, Skeleton, groupSessions } from "@agentic-hub/ui";
import { errorMessage, isUnavailable, useConnection, useProjects, useSessions } from "@agentic-hub/ui/client";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { SessionTable } from "./dashboard";
import { OfflinePanel } from "./offline-panel";

export function SessionsIndex() {
  const connection = useConnection();
  const sessions = useSessions();
  const projects = useProjects();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupSessions((sessions.data ?? []).filter((s) => !q || s.title.toLowerCase().includes(q)), "date");
  }, [sessions.data, query]);

  return (
    <>
      {/* Offline is explained in-page by OfflinePanel; the strip only labels demo data. */}
      {connection.status === "demo" ? <ConnectionBanner connection={connection} /> : null}
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-fg">Sessions</h1>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sessions" aria-label="Search sessions" className="pl-8" />
          </div>
        </div>
        {sessions.isPending ? (
          <Skeleton className="h-80 rounded-xl" />
        ) : sessions.isError ? (
          isUnavailable(sessions.error) ? (
            <OfflinePanel detail={errorMessage(sessions.error)} />
          ) : (
            <ErrorState message={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
          )
        ) : groups.length === 0 ? (
          <p className="py-16 text-center text-sm text-fg-subtle">No sessions match.</p>
        ) : (
          <div className="space-y-8">
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <h2 className="mb-2 text-xs font-medium text-fg-subtle">{g.label}</h2>
                <SessionTable sessions={g.sessions} projectName={(id) => projects.data?.find((p) => p.id === id)?.name} />
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
