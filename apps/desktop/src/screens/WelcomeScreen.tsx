import { AgentMark, AGENT_ORDER, Badge, Button, Switch, ThemeToggle, cn, useCopy } from "@agentic-hub/ui";
import { errorMessage, useAddProject, useConnection, useCreateSession, useEnvironment, useProjects, useProviders, useRefreshEnvironment } from "@agentic-hub/ui/client";
import { AGENT_DISPLAY, MODEL_CHAT_PROJECT_ID, type AgentId, type Project, type ToolCheck } from "@agentic-hub/ui/model";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Copy, ExternalLink, FlaskConical, FolderOpen, GitFork, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { GitHubImport } from "../components/GitHubImport";
import { isTauri, pickRepositoryFolder } from "../platform/native";
import { restartNativeRuntime, useNativeRuntimeStatus } from "../platform/runtime-status";
import { useAppState } from "../state/app-state";

type StepId = "setup" | "repository" | "start";
const STEPS: { id: StepId; label: string }[] = [
  { id: "setup", label: "Check setup" },
  { id: "repository", label: "Pick a repository" },
  { id: "start", label: "Start an agent" },
];

function CopyCommand({ command }: { command: string }) {
  const { copied, copy } = useCopy();
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-surface-2 py-0.5 pl-2 pr-0.5">
      <code className="min-w-0 truncate font-mono text-2xs text-fg">{command}</code>
      <Button size="icon-sm" variant="ghost" aria-label={`Copy ${command}`} onClick={() => copy(command)}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </span>
  );
}

function ToolRow({ tool }: { tool: ToolCheck }) {
  const ok = tool.installed && tool.authenticated !== false;
  const command = !tool.installed ? tool.installCommand : tool.authenticated === false ? tool.authCommand : null;
  return (
    <li className="flex items-start gap-3 py-2">
      <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", ok ? "bg-success-soft text-success" : tool.required ? "bg-danger-soft text-danger" : "bg-surface-3 text-fg-subtle")}>
        {ok ? <Check className="size-3" /> : <CircleAlert className="size-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium text-fg">{tool.name}</span>
          {tool.version ? <span className="font-mono text-2xs text-fg-subtle">{tool.version}</span> : null}
          {tool.account ? <Badge tone="success">{tool.account}</Badge> : null}
          {tool.required ? null : <span className="text-2xs text-fg-subtle">optional</span>}
        </div>
        <p className="text-xs text-fg-muted">{ok ? (tool.id === "gh" || tool.id === "vercel" ? tool.detail : "Ready") : tool.detail}</p>
        {command ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <CopyCommand command={command} />
            <a href={tool.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-2xs text-fg-subtle hover:text-fg">
              Docs <ExternalLink className="size-3" />
            </a>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function SetupStep({ onNext }: { onNext: () => void }) {
  const native = useNativeRuntimeStatus();
  const connection = useConnection();
  const connected = connection.status === "connected";
  const environment = useEnvironment(connected);
  const refresh = useRefreshEnvironment();
  const providers = useProviders();
  const { navigate } = useAppState();
  const readyAgents = providers.data?.filter((p) => p.status === "ready") ?? [];
  const tools = environment.data?.tools ?? [];
  const missingRequired = tools.filter((t) => t.required && !t.installed);

  if (!connected)
    return (
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          {native?.state === "failed" ? <CircleAlert className="size-4 text-danger" /> : <LoaderCircle className="size-4 animate-spin text-fg-muted" />}
          {native?.state === "failed" ? "The local runtime couldn't start" : "Starting the local runtime…"}
        </div>
        <p className="mt-2 text-sm text-fg-muted">
          {native?.state === "failed" || native?.state === "restarting"
            ? native.detail
            : native
              ? "It runs on this computer only and listens on 127.0.0.1."
              : (connection.detail ?? "In a browser preview, start it with `pnpm runtime:start`.")}
        </p>
        {native?.state === "failed" ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void restartNativeRuntime()}>
              Retry
            </Button>
            {/node/i.test(native.detail) ? <CopyCommand command="brew install node" /> : null}
          </div>
        ) : null}
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface px-4 py-2">
        <div className="flex items-center justify-between pt-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Detected on this Mac</h3>
          <Button size="xs" variant="ghost" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw className={refresh.isPending ? "animate-spin" : ""} /> Re-check
          </Button>
        </div>
        {environment.isPending ? (
          <p className="flex items-center gap-2 py-3 text-sm text-fg-muted">
            <LoaderCircle className="size-3.5 animate-spin" /> Looking for Git, Node.js, Claude Code, Codex, GitHub and Vercel…
          </p>
        ) : environment.isError ? (
          <p className="py-3 text-sm text-danger">{errorMessage(environment.error)}</p>
        ) : (
          <ul className="divide-y divide-border">
            {tools.map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-fg-muted">
        {readyAgents.length ? (
          <>
            Ready to use: <span className="text-fg">{readyAgents.map((p) => AGENT_DISPLAY[p.agentId].name).join(", ")}</span>.{" "}
          </>
        ) : (
          <>No agent is signed in yet. Run a sign-in command above, or </>
        )}
        <button type="button" className="underline underline-offset-2 hover:text-fg" onClick={() => navigate("providers")}>
          add an OpenAI or Anthropic API key
        </button>
        .
      </p>
      <div className="flex justify-end">
        <Button variant="primary" onClick={onNext} disabled={missingRequired.length > 0}>
          {missingRequired.length ? `Install ${missingRequired.map((t) => t.name).join(" and ")} first` : "Continue"} <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

function RepositoryStep({ onPicked, onSkip }: { onPicked: (project: Project) => void; onSkip: () => void }) {
  const projects = useProjects();
  const environment = useEnvironment();
  const add = useAddProject();
  const [error, setError] = useState<string | null>(null);
  const recent = (projects.data ?? []).filter((p) => p.id !== MODEL_CHAT_PROJECT_ID).slice(0, 4);
  const gh = environment.data?.tools.find((t) => t.id === "gh");

  const pick = async () => {
    setError(null);
    try {
      const result = await pickRepositoryFolder();
      if (result.kind === "picked") onPicked(await add.mutateAsync(result.path));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-2 text-sm font-medium">Clone from GitHub</h3>
        <GitHubImport githubConnected={Boolean(gh?.authenticated)} cloneDirectory={environment.data?.cloneDirectory} onImported={onPicked} />
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Already on this Mac?</h3>
          <p className="text-xs text-fg-muted">Choose a folder that contains a Git repository.</p>
        </div>
        <Button onClick={() => void pick()} disabled={!isTauri() || add.isPending}>
          {add.isPending ? <LoaderCircle className="animate-spin" /> : <FolderOpen />} Choose folder…
        </Button>
        {error ? <p className="w-full text-xs text-danger">{error}</p> : null}
        {recent.length ? (
          <div className="flex w-full flex-wrap gap-1.5 pt-1">
            {recent.map((p) => (
              <Button key={p.id} size="xs" variant="outline" onClick={() => onPicked(p)}>
                {p.name}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onSkip}>
          Skip, I just want to chat with a model
        </Button>
      </div>
    </div>
  );
}

const STARTERS = ["Give me a tour of this repository and how to run it", "Find and fix a failing test", "Add a README section describing the architecture"];

function StartStep({ project, onStarted }: { project: Project; onStarted: (sessionId: string) => void }) {
  const { prefs, setPrefs } = useAppState();
  const providers = useProviders();
  const create = useCreateSession();
  const agents = AGENT_ORDER.filter((id) => AGENT_DISPLAY[id].kind === "agent" && providers.data?.find((p) => p.agentId === id)?.status === "ready");
  const [agent, setAgent] = useState<AgentId | undefined>(agents.includes(prefs.defaultAgent) ? prefs.defaultAgent : agents[0]);
  const [prompt, setPrompt] = useState(STARTERS[0]!);
  const chosen = agent && agents.includes(agent) ? agent : agents[0];

  if (!agents.length)
    return (
      <div className="rounded-xl border border-warning/40 bg-warning-soft/50 p-4 text-sm">
        <p className="font-medium text-fg">No coding agent is signed in yet.</p>
        <p className="mt-1 text-fg-muted">
          Run <code className="font-mono">claude</code> or <code className="font-mono">codex login</code> in a terminal, then go back and press Re-check.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {agents.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setAgent(id)}
            aria-pressed={chosen === id}
            className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors focus-ring", chosen === id ? "border-accent bg-accent-soft text-fg" : "border-border bg-surface hover:border-border-strong")}
          >
            <AgentMark agentId={id} size="sm" /> {AGENT_DISPLAY[id].name}
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-border bg-surface p-3 focus-within:border-accent">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} aria-label="First task" className="w-full resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" placeholder="Describe a task…" />
        <div className="flex flex-wrap gap-1.5">
          {STARTERS.map((s) => (
            <button key={s} type="button" onClick={() => setPrompt(s)} className="rounded-full border border-border px-2.5 py-0.5 text-2xs text-fg-muted hover:border-border-strong hover:text-fg">
              {s}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2.5 text-sm text-fg-muted">
        <Switch checked={prefs.isolateSessions} onCheckedChange={(isolateSessions) => setPrefs({ isolateSessions })} />
        <GitFork className="size-3.5" /> Work on a separate branch in its own worktree
        <span className="text-2xs text-fg-subtle">(your checkout stays untouched)</span>
      </label>
      {create.isError ? <p className="text-sm text-danger">{errorMessage(create.error)}</p> : null}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-fg-subtle">{AGENT_DISPLAY[chosen!].name} always asks before commands, pushes or deploys. You can relax this for low-risk actions in Settings.</p>
        <Button
          variant="primary"
          size="lg"
          disabled={!prompt.trim() || create.isPending}
          onClick={() =>
            create.mutate(
              { projectId: project.id, agentId: chosen!, prompt: prompt.trim(), isolation: prefs.isolateSessions ? "worktree" : "none" },
              {
                onSuccess: (session) => {
                  setPrefs({ defaultAgent: chosen! });
                  onStarted(session.id);
                },
              },
            )
          }
        >
          {create.isPending ? <LoaderCircle className="animate-spin" /> : <Sparkles />} Start
        </Button>
      </div>
    </div>
  );
}

function Frame({ step, children, footer }: { step: StepId; children: ReactNode; footer?: ReactNode }) {
  const index = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="flex h-full flex-col bg-bg">
      <div data-tauri-drag-region className={isTauri() ? "h-10 shrink-0" : "h-0"} />
      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-8">
        <div className="w-full max-w-[560px]">
          <div className="mb-5 flex items-center gap-1.5">
            {AGENT_ORDER.map((id) => (
              <AgentMark key={id} agentId={id} size="md" />
            ))}
          </div>
          <h1 className="text-[1.6rem] font-semibold leading-tight tracking-[-0.025em] text-fg">Your first agent, in a few minutes.</h1>
          <p className="mt-1.5 text-sm text-fg-muted">Agentic Hub runs Claude Code and Codex on your own repositories, with live streaming, diffs and approvals. No servers or tokens to configure.</p>
          <ol className="mb-6 mt-6 flex items-center gap-2 text-xs" aria-label="Setup progress">
            {STEPS.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2" aria-current={i === index ? "step" : undefined}>
                <span className={cn("flex size-5 items-center justify-center rounded-full border text-2xs", i < index ? "border-success/40 bg-success-soft text-success" : i === index ? "border-accent bg-accent text-accent-fg" : "border-border text-fg-subtle")}>
                  {i < index ? <Check className="size-3" /> : i + 1}
                </span>
                <span className={i === index ? "font-medium text-fg" : "text-fg-muted"}>{s.label}</span>
                {i < STEPS.length - 1 ? <span className="h-px w-6 bg-border" /> : null}
              </li>
            ))}
          </ol>
          <div key={step} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
            {children}
          </div>
          <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
            {footer ?? <span />}
            <ThemeToggle />
          </div>
        </div>
      </div>
    </div>
  );
}

export function WelcomeScreen() {
  const { setPrefs, navigate, selectSession } = useAppState();
  const [step, setStep] = useState<StepId>("setup");
  const [project, setProject] = useState<Project | null>(null);

  const finish = (patch: Parameters<typeof setPrefs>[0] = {}) => setPrefs({ onboarded: true, dataMode: "live", ...patch });

  return (
    <Frame
      step={step}
      footer={
        <div className="flex items-center gap-1">
          {step !== "setup" ? (
            <Button variant="ghost" size="sm" onClick={() => setStep(step === "start" ? "repository" : "setup")}>
              <ArrowLeft /> Back
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPrefs({ onboarded: true, dataMode: "demo" });
              navigate("workspace");
            }}
          >
            <FlaskConical /> Explore sample data
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              finish();
              navigate("workspace");
            }}
          >
            Skip setup
          </Button>
        </div>
      }
    >
      {step === "setup" ? <SetupStep onNext={() => setStep("repository")} /> : null}
      {step === "repository" ? (
        <RepositoryStep
          onPicked={(p) => {
            setProject(p);
            setStep("start");
          }}
          onSkip={() => {
            finish({ activeProjectId: MODEL_CHAT_PROJECT_ID, activeSessionId: undefined, defaultAgent: "anthropic" });
            navigate("workspace");
          }}
        />
      ) : null}
      {step === "start" && project ? (
        <StartStep
          project={project}
          onStarted={(sessionId) => {
            finish();
            selectSession(sessionId, project.id);
          }}
        />
      ) : null}
    </Frame>
  );
}
