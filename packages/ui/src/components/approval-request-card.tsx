"use client";

import { Check, ShieldAlert, ShieldCheck, ShieldX, X } from "lucide-react";
import { useState } from "react";
import type { ApprovalDecision, ApprovalItem } from "../model/types";
import { cn } from "../lib/cn";
import { errorMessage } from "../client/errors";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { TOOL_ICON } from "./tool-execution-card";

const RISK_TONE = { low: "neutral", medium: "warning", high: "danger" } as const;

export function ApprovalRequestCard({
  item,
  onResolve,
  unavailableReason,
}: {
  item: ApprovalItem;
  /** Should resolve once the backend acknowledges the decision. */
  onResolve?: (decision: ApprovalDecision) => Promise<unknown>;
  /** When set, actions are disabled and this explains why (e.g. web without control plane). */
  unavailableReason?: string;
}) {
  const [submitting, setSubmitting] = useState<ApprovalDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const Icon = TOOL_ICON[item.tool];
  const pending = item.status === "pending";
  const disabled = !pending || Boolean(unavailableReason) || !onResolve || submitting != null;

  const resolve = async (decision: ApprovalDecision) => {
    if (disabled || !onResolve) return;
    setSubmitting(decision);
    setError(null);
    try {
      await onResolve(decision);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <section
      aria-label={`Approval request: ${item.title}`}
      data-status={item.status}
      className={cn(
        "max-w-3xl overflow-hidden rounded-lg border bg-surface shadow-sm transition-colors",
        pending ? "border-warning/40" : "border-border",
      )}
    >
      <header className={cn("flex items-center gap-2 px-3 py-2", pending && "bg-warning-soft/60")}>
        {pending ? (
          <ShieldAlert className="size-4 shrink-0 text-warning" />
        ) : item.status === "approved" ? (
          <ShieldCheck className="size-4 shrink-0 text-success" />
        ) : (
          <ShieldX className="size-4 shrink-0 text-fg-subtle" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{pending ? "Approval required" : item.title}</p>
        </div>
        {item.risk ? <Badge tone={RISK_TONE[item.risk]}>{item.risk} risk</Badge> : null}
        {!pending ? (
          <Badge tone={item.status === "approved" ? "success" : "neutral"} className="capitalize">
            {item.autoApproved && item.status === "approved" ? "Auto-approved" : item.status}
          </Badge>
        ) : null}
      </header>
      {pending ? (
        <div className="space-y-2.5 px-3 pb-3 pt-2.5">
          <p className="flex items-center gap-1.5 text-sm text-fg">
            <Icon className="size-3.5 text-fg-subtle" />
            {item.title}
          </p>
          {item.command ? (
            <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 px-2.5 py-2 font-mono text-xs text-fg">
              <span className="select-none text-fg-subtle">$ </span>
              {item.command}
            </pre>
          ) : null}
          {item.paths?.length ? (
            <ul className="space-y-0.5 font-mono text-xs text-fg-muted">
              {item.paths.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {item.reason ? <p className="text-xs text-fg-muted">{item.reason}</p> : null}
          {item.risk === "high" && item.riskReasons?.length ? (
            <p className="text-xs text-danger">Always asks: {item.riskReasons.join(" · ")}</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Button variant="primary" size="sm" disabled={disabled} onClick={() => resolve("approve")} aria-busy={submitting === "approve"}>
              <Check /> {submitting === "approve" ? "Approving…" : "Approve"}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => resolve("reject")} aria-busy={submitting === "reject"}>
              <X /> {submitting === "reject" ? "Rejecting…" : "Reject"}
            </Button>
            {unavailableReason ? <span className="text-xs text-fg-subtle">{unavailableReason}</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}