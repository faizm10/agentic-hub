"use client";

import { AgentEventTimeline, Button, ConnectionBanner, ErrorState, SessionHeader, SessionInspector } from "@agentic-hub/ui";
import { errorMessage, isUnavailable, useConnection, useProjects, useSessionStream } from "@agentic-hub/ui/client";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { REMOTE_UNAVAILABLE } from "@/lib/data-source";
import { OfflinePanel } from "./offline-panel";

/**
 * Read-only session view for the web companion. Cancel and approval
 * controls are rendered but disabled with an explanation until an
 * authorized control plane exists — the web never fakes a remote action.
 */
export function SessionView({ sessionId }: { sessionId: string }) {
  const connection = useConnection();
  const snapshot = useSessionStream(sessionId);
  const projects = useProjects();
  const project = projects.data?.find((p) => p.id === snapshot.data?.session.projectId);

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      {/* Offline is explained in-page by OfflinePanel; the strip only labels demo data. */}
      {connection.status === "demo" ? <ConnectionBanner connection={connection} /> : null}
      {snapshot.isError ? (
        <main className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6">
          {isUnavailable(snapshot.error) ? (
            <OfflinePanel detail={errorMessage(snapshot.error)} />
          ) : (
            <ErrorState title="Couldn't load this session" message={errorMessage(snapshot.error)} onRetry={() => void snapshot.refetch()} />
          )}
        </main>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <SessionHeader
              session={snapshot.data?.session}
              project={project}
              cancelUnavailableReason={REMOTE_UNAVAILABLE}
              leading={
                <Button asChild variant="ghost" size="icon" aria-label="Back to overview">
                  <Link href="/">
                    <ArrowLeft />
                  </Link>
                </Button>
              }
            />
            <AgentEventTimeline
              items={snapshot.data?.timeline ?? []}
              status={snapshot.data?.session.status}
              loading={snapshot.isPending}
              approvalUnavailableReason="Approve from the desktop app — remote approvals need the control plane."
            />
            <div className="border-t border-border px-5 py-3">
              <p className="mx-auto flex max-w-[52rem] items-center gap-2 text-xs text-fg-subtle">
                <LockKeyhole className="size-3.5" />
                Read-only. Sending prompts from the web requires an authenticated control plane.
              </p>
            </div>
          </div>
          {snapshot.data ? (
            <aside className="hidden w-[400px] shrink-0 border-l border-border bg-surface lg:block" aria-label="Session review">
              <SessionInspector snapshot={snapshot.data} project={project} modeLabel={connection.status === "demo" ? "Demo fixtures" : "Control plane"} />
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}
