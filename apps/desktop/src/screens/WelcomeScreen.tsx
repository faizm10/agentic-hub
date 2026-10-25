import { AgentMark, AGENT_ORDER, Badge, Button, ThemeToggle, cn } from "@agentic-hub/ui";
import { useConnection, useProviders } from "@agentic-hub/ui/client";
import { AGENT_DISPLAY, type ProviderConfig } from "@agentic-hub/ui/model";
import { ArrowRight, Check, CircleAlert, FlaskConical, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { isTauri } from "../platform/native";
import { restartNativeRuntime, useNativeRuntimeStatus } from "../platform/runtime-status";
import { useAppState } from "../state/app-state";

function Step({ index, title, state, children }: { index: number; title: string; state: "done" | "pending" | "problem"; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
          state === "done" && "border-success/40 bg-success-soft text-success",
          state === "pending" && "border-border text-fg-muted",
          state === "problem" && "border-warning/40 bg-warning-soft text-warning",
        )}
      >
        {state === "done" ? <Check className="size-3.5" /> : state === "problem" ? <CircleAlert className="size-3.5" /> : index}
      </span>
      <div className="min-w-0 flex-1 pb-5">
        <div className="text-sm font-medium text-fg">{title}</div>
        <div className="mt-1 text-sm text-fg-muted">{children}</div>
      </div>
    </li>
  );
}

const STATUS_LABEL: Record<ProviderConfig["status"], string> = {
  ready: "Ready",
  needs_auth: "Needs setup",
  not_installed: "Not installed",
  error: "Error",
  unknown: "Checking",
};

export function WelcomeScreen() {
  const { setPrefs, navigate } = useAppState();
  const native = useNativeRuntimeStatus();
  const connection = useConnection();
  const providers = useProviders();
  const connected = connection.status === "connected";
  const ready = providers.data?.filter((p) => p.status === "ready") ?? [];

  const runtimeState: "done" | "pending" | "problem" = connected ? "done" : native?.state === "failed" || connection.status === "disconnected" ? "problem" : "pending";
  const runtimeDetail = connected
    ? "Running on this computer. It only listens on 127.0.0.1."
    : native?.state === "failed" || native?.state === "restarting"
      ? native.detail
      : native
        ? "Starting the local runtime…"
        : (connection.detail ?? "Connecting to the local runtime… In a browser preview, start it with `pnpm runtime:start`.");

  const finish = (dataMode: "live" | "demo") => {
    setPrefs({ onboarded: true, dataMode });
    navigate(dataMode === "live" ? "repositories" : "workspace");
  };

  return (
    <div className="flex h-full flex-col bg-bg">
      <div data-tauri-drag-region className={isTauri() ? "h-10 shrink-0" : "h-0"} />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <div className="w-full max-w-[480px] animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
          <div className="mb-6 flex items-center gap-1.5">
            {AGENT_ORDER.map((id) => (
              <AgentMark key={id} agentId={id} size="lg" />
            ))}
          </div>
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.025em] text-fg">One workspace for your coding agents.</h1>
          <p className="mt-2 text-base text-fg-muted">
            Codex, Claude Code and Muse Code work in your repositories. OpenAI and Anthropic models are a message away. Review every tool call and diff in one place.
          </p>

          <ol className="mt-8">
            <Step index={1} title="Local runtime" state={runtimeState}>
              <span className="break-words">{runtimeDetail}</span>
              {native?.state === "failed" ? (
                <Button size="xs" className="ml-2" onClick={() => void restartNativeRuntime()}>
                  Retry
                </Button>
              ) : null}
            </Step>
            <Step index={2} title="Connect at least one provider" state={ready.length ? "done" : connected ? "problem" : "pending"}>
              {providers.data ? (
                <ul className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {AGENT_ORDER.map((id) => {
                    const p = providers.data.find((x) => x.agentId === id);
                    if (!p) return null;
                    return (
                      <li key={id} className="flex items-center gap-2 text-sm">
                        <AgentMark agentId={id} size="sm" />
                        <span className="text-fg">{AGENT_DISPLAY[id].name}</span>
                        <Badge tone={p.status === "ready" ? "success" : p.status === "needs_auth" ? "warning" : "neutral"}>{STATUS_LABEL[p.status]}</Badge>
                      </li>
                    );
                  })}
                </ul>
              ) : connected ? (
                <span className="inline-flex items-center gap-1.5"><LoaderCircle className="size-3.5 animate-spin" /> Detecting installed CLIs…</span>
              ) : (
                "Provider status appears once the runtime is running."
              )}
              {connected && !ready.length ? <p className="mt-2">Sign in to a CLI or add an API key in Providers after setup.</p> : null}
            </Step>
            <Step index={3} title="Open a repository" state="pending">
              Coding agents work inside a Git repository you choose. Model chats are kept with that project too.
            </Step>
          </ol>

          <div className="mt-2 space-y-2.5">
            <Button variant="primary" size="lg" className="w-full rounded-xl" onClick={() => finish("live")}>
              Get started <ArrowRight />
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => finish("demo")}>
              <FlaskConical /> Explore with sample data instead
            </Button>
          </div>
          <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
            <ThemeToggle />
            <span className="text-xs text-fg-subtle">You can change everything later in Settings.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
