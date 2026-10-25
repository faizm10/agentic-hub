"use client";

import type { ReactNode } from "react";
import { AGENT_DISPLAY } from "../model/agents";
import type { Project, SessionSnapshot } from "../model/types";
import { formatRelative } from "../lib/format";
import { AgentMark } from "./agent-mark";
import { RunStatusIndicator } from "./run-status-indicator";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-baseline gap-2 py-1.5">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-sm text-fg">{children}</dd>
    </div>
  );
}

export function SessionDetailsPanel({ snapshot, project, mode }: { snapshot: SessionSnapshot; project?: Project; mode?: string }) {
  const { session, timeline } = snapshot;
  const tools = timeline.filter((t) => t.kind === "tool");
  const failed = tools.filter((t) => t.kind === "tool" && t.status === "failed").length;
  const approvals = timeline.filter((t) => t.kind === "approval");
  return (
    <dl className="divide-y divide-border px-3">
      <Row label="Agent">
        <span className="inline-flex items-center gap-1.5">
          <AgentMark agentId={session.agentId} size="sm" />
          {AGENT_DISPLAY[session.agentId].name}
        </span>
      </Row>
      {session.model ? <Row label="Model"><span className="font-mono text-xs">{session.model}</span></Row> : null}
      <Row label="Status">
        <RunStatusIndicator status={session.status} />
      </Row>
      {project ? <Row label="Project">{project.name}</Row> : null}
      {project ? <Row label="Path"><span className="font-mono text-xs" title={project.path}>{project.path}</span></Row> : null}
      <Row label="Branch"><span className="font-mono text-xs">{session.branch}</span></Row>
      <Row label="Started">{formatRelative(session.createdAt)}</Row>
      <Row label="Updated">{formatRelative(session.updatedAt)}</Row>
      <Row label="Messages">{timeline.filter((t) => t.kind === "message").length}</Row>
      <Row label="Tool calls">
        {tools.length}
        {failed ? <span className="ml-1.5 text-danger">({failed} failed)</span> : null}
      </Row>
      <Row label="Approvals">{approvals.length}</Row>
      {mode ? <Row label="Data source">{mode}</Row> : null}
      <Row label="Session ID"><span className="font-mono text-2xs text-fg-muted">{session.id}</span></Row>
    </dl>
  );
}