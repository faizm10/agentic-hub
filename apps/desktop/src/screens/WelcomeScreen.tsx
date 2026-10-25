import { AgentMark, Badge, Kbd, ThemeToggle, cn } from "@agentic-hub/ui";
import { ArrowRight, FlaskConical, Plug } from "lucide-react";
import { isTauri } from "../platform/native";
import { useAppState, type DataMode } from "../state/app-state";

function Choice({
  icon,
  title,
  description,
  badge,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-all focus-ring hover:-translate-y-px hover:shadow-md",
        primary ? "border-accent/40 bg-accent-soft/40 hover:border-accent/70" : "border-border bg-surface hover:border-border-strong",
      )}
    >
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border [&_svg]:size-4", primary ? "border-accent/30 text-accent" : "border-border text-fg-muted")}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium text-fg">
          {title}
          {badge}
        </span>
        <span className="mt-0.5 block text-sm text-fg-muted">{description}</span>
      </span>
      <ArrowRight className="mt-1 size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

export function WelcomeScreen() {
  const { setPrefs, navigate } = useAppState();
  const start = (dataMode: DataMode) => {
    setPrefs({ onboarded: true, dataMode });
    navigate(dataMode === "live" ? "repositories" : "workspace");
  };
  return (
    <div className="flex h-full flex-col bg-bg">
      <div data-tauri-drag-region className={isTauri() ? "h-10 shrink-0" : "h-0"} />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <div className="w-full max-w-[440px] animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
          <div className="mb-8 flex items-center gap-1.5">
            <AgentMark agentId="codex" size="lg" />
            <AgentMark agentId="claude-code" size="lg" />
            <AgentMark agentId="muse" size="lg" />
          </div>
          <h1 className="text-[1.6rem] font-semibold leading-tight tracking-[-0.02em] text-fg">One workspace for your coding agents.</h1>
          <p className="mt-2 text-base text-fg-muted">
            Run Codex, Claude Code and Muse against your repositories. Review every tool call, approve what runs, and inspect
            the diff before it lands.
          </p>
          <div className="mt-8 space-y-2.5">
            <Choice
              primary
              icon={<Plug />}
              title="Connect to the local runtime"
              description="Use agents installed on this machine. Requires the Agentic Hub runtime."
              onClick={() => start("live")}
            />
            <Choice
              icon={<FlaskConical />}
              title="Explore with sample data"
              badge={<Badge tone="info">Demo</Badge>}
              description="Clearly-labeled fixtures. Nothing runs and no files change."
              onClick={() => start("demo")}
            />
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <ThemeToggle />
            <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <Kbd keys="mod+k" /> command palette
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
