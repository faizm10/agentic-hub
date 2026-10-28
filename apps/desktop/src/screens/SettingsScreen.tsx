import { Badge, Button, Input, Kbd, PairingSettings, SegmentedControl, Switch, ThemeToggle, safeStorage } from "@agentic-hub/ui";
import { errorMessage, useApprovalPolicy, useClient, useIntegrations, usePairing, usePairingActions, useSetApprovalPolicy } from "@agentic-hub/ui/client";
import type { ApprovalPolicy } from "@agentic-hub/ui/model";
import { FlaskConical, Plug, ShieldCheck, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { UpdatePanel, useAppVersion } from "../components/UpdateControls";
import { isTauri } from "../platform/native";
import { restartNativeRuntime, useNativeRuntimeStatus } from "../platform/runtime-status";
import { useAppState, type DataMode } from "../state/app-state";
import { ScreenBody, ScreenHeader } from "./ScreenHeader";

const SHORTCUTS: [string, string][] = [
  ["mod+k", "Command palette"],
  ["mod+n", "New chat"],
  ["mod+o", "Open repository"],
  ["mod+e", "Code: files and editor"],
  ["mod+`", "Terminal"],
  ["mod+y", "All chats"],
  ["mod+b", "Toggle sidebar"],
  ["mod+j", "Toggle review panel"],
  ["mod+shift+d", "Review changes"],
  ["mod+.", "Stop the active run"],
  ["mod+1", "Choose Codex (new chat)"],
  ["mod+2", "Choose Claude Code (new chat)"],
  ["mod+3", "Choose Muse Code (new chat)"],
  ["mod+4", "Choose OpenAI (new chat)"],
  ["mod+5", "Choose Claude (new chat)"],
  ["enter", "Send message"],
  ["shift+enter", "New line in message"],
  ["mod+,", "Settings"],
];

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-b border-border py-6 first:pt-0 last:border-0 md:grid-cols-[220px_1fr] md:gap-8">
      <div>
        <h2 className="text-sm font-medium text-fg">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function WebAccess() {
  const client = useClient();
  const live = client.mode === "live";
  const pairing = usePairing(live);
  const actions = usePairingActions();
  if (!live) return <p className="text-sm text-fg-muted">Switch the data source to the local runtime to pair this computer with the web app.</p>;
  return (
    <PairingSettings
      pairing={pairing.data}
      loading={pairing.isPending && !pairing.isError}
      error={pairing.isError ? errorMessage(pairing.error) : undefined}
      onPair={(input) => actions.pair.mutateAsync(input)}
      onToggleRemoteControl={(allowRemoteControl) => actions.update.mutateAsync({ allowRemoteControl })}
      onUnpair={() => actions.unpair.mutateAsync()}
    />
  );
}

function ApprovalPolicySettings() {
  const policy = useApprovalPolicy();
  const save = useSetApprovalPolicy();
  const [command, setCommand] = useState("");
  if (policy.isPending) return <p className="text-sm text-fg-muted">Loading approval settings…</p>;
  if (policy.isError) return <p className="text-sm text-danger">{errorMessage(policy.error)}</p>;
  const value = policy.data;
  const update = (patch: Partial<ApprovalPolicy>) => save.mutate({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <SegmentedControl<ApprovalPolicy["mode"]>
        label="Approval mode"
        value={value.mode}
        onChange={(mode) => update({ mode })}
        options={[
          { value: "ask", label: "Ask every time" },
          { value: "trusted", label: "Auto-approve low risk", icon: <ShieldCheck /> },
        ]}
      />
      <p className="text-xs text-fg-muted">
        {value.mode === "ask"
          ? "Every command and file change waits for you."
          : "Read-only tools and trusted commands run without asking. Anything else waits for you."}{" "}
        <span className="text-fg">Destructive commands, pushes, deploys, permission changes and anything touching secrets always ask.</span>
      </p>
      {value.mode === "trusted" ? (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Auto-approve file edits inside the repository
              <span className="block text-xs text-fg-muted">Edits outside the repository, to .env files, keys or CI workflows still ask.</span>
            </span>
            <Switch checked={value.autoApproveFileEdits} onCheckedChange={(autoApproveFileEdits) => update({ autoApproveFileEdits })} />
          </label>
          <div>
            <p className="text-sm">Trusted commands</p>
            <p className="text-xs text-fg-muted">Besides built-ins like <code className="font-mono">git status</code>, <code className="font-mono">pnpm test</code> and <code className="font-mono">cargo check</code>. Matched as a prefix; chained commands (<code className="font-mono">&amp;&amp;</code>, pipes) always ask.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {value.trustedCommands.map((c) => (
                <Badge key={c} className="gap-1 font-mono">
                  {c}
                  <button type="button" aria-label={`Remove ${c}`} onClick={() => update({ trustedCommands: value.trustedCommands.filter((x) => x !== c) })}>
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const next = command.trim();
                if (next && !value.trustedCommands.includes(next)) update({ trustedCommands: [...value.trustedCommands, next] });
                setCommand("");
              }}
            >
              <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="e.g. make lint" aria-label="Trusted command" className="max-w-xs font-mono text-xs" />
              <Button type="submit" size="md" disabled={!command.trim()}>Add</Button>
            </form>
          </div>
        </div>
      ) : null}
      {save.isError ? <p className="text-xs text-danger">{errorMessage(save.error)}</p> : null}
    </div>
  );
}

function IntegrationList({ onOpen }: { onOpen: () => void }) {
  const integrations = useIntegrations();
  if (integrations.isPending) return <p className="text-sm text-fg-muted">Checking GitHub and Vercel sign-in…</p>;
  if (integrations.isError) return <p className="text-sm text-danger">{errorMessage(integrations.error)}</p>;
  return (
    <div className="space-y-2">
      {integrations.data.map((i) => (
        <div key={i.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
          <span className="w-16 text-sm font-medium">{i.name}</span>
          <Badge tone={i.authenticated ? "success" : i.installed ? "warning" : "neutral"}>{i.authenticated ? "Connected" : i.installed ? "Signed out" : "Not installed"}</Badge>
          <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{i.authenticated ? i.detail : <code className="font-mono">{i.installed ? i.connectCommand : i.detail}</code>}</span>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={onOpen}>Open GitHub &amp; Vercel</Button>
        <Button size="sm" variant="ghost" onClick={() => void integrations.refetch()} disabled={integrations.isFetching}>Re-check</Button>
      </div>
    </div>
  );
}

function RuntimeStatusRow() {
  const status = useNativeRuntimeStatus();
  if (!status) return <dd className="text-fg-muted">Vite bridge to <code className="font-mono text-xs">pnpm runtime:start</code></dd>;
  const label =
    status.state === "ready" ? `Running (v${status.version})` : status.state === "starting" ? "Starting…" : status.state === "stopped" ? "Stopped" : status.detail;
  return (
    <dd className="flex min-w-0 items-center gap-2 text-fg-muted">
      <span className="truncate">{label}</span>
      {status.state !== "ready" && status.state !== "starting" ? (
        <Button size="xs" onClick={() => void restartNativeRuntime()}>
          Restart
        </Button>
      ) : null}
    </dd>
  );
}

export function SettingsScreen({ toolbar }: { toolbar: ReactNode }) {
  const { prefs, setPrefs, navigate } = useAppState();
  const client = useClient();
  const version = useAppVersion();
  const [layoutReset, setLayoutReset] = useState(false);

  return (
    <>
      <ScreenHeader title="Settings" toolbar={toolbar} />
      <ScreenBody>
        <Section title="Appearance" description="Follows your system by default.">
          <ThemeToggle />
        </Section>
        <Section title="Data source" description="Where sessions, projects and events come from.">
          <SegmentedControl<DataMode>
            label="Data source"
            value={prefs.dataMode}
            onChange={(dataMode) => setPrefs({ dataMode, activeSessionId: undefined, activeProjectId: undefined })}
            options={[
              { value: "live", label: "Local runtime", icon: <Plug /> },
              { value: "demo", label: "Sample data", icon: <FlaskConical /> },
            ]}
          />
          <p className="mt-2 text-xs text-fg-muted">
            {prefs.dataMode === "demo"
              ? "Sample data for exploring the interface. Replies are scripted, no agent runs, and nothing on disk changes."
              : "The Agentic Hub runtime on this computer. CLI sign-ins stay with each CLI; API keys are stored encrypted by the runtime."}
          </p>
        </Section>
        <Section title="Providers" description="Sign in to coding agents and add model API keys.">
          <Button size="sm" onClick={() => navigate("providers")}>
            Manage providers
          </Button>
        </Section>
        <Section title="Approvals" description="How coding agents' requests to run commands and edit files are answered.">
          {client.mode === "demo" ? <p className="text-sm text-fg-muted">Switch to the local runtime to change approvals.</p> : <ApprovalPolicySettings />}
        </Section>
        <Section title="Web access" description="Use this computer's agents from the Agentic Hub website.">
          <WebAccess />
        </Section>
        <Section title="Integrations" description="GitHub and Vercel use your own CLI sign-ins. Nothing is stored by Agentic Hub.">
          {client.mode === "demo" ? <p className="text-sm text-fg-muted">Switch to the local runtime to connect integrations.</p> : <IntegrationList onOpen={() => navigate("activity")} />}
        </Section>
        <Section title="Layout" description="Panel sizes are remembered per window.">
          <Button
            size="sm"
            onClick={() => {
              safeStorage.remove("agentic-hub.layout.desktop");
              setPrefs({ sidebarOpen: true, inspectorOpen: true });
              setLayoutReset(true);
            }}
          >
            Reset panel layout
          </Button>
          {layoutReset ? <span className="ml-3 text-xs text-fg-muted">Layout reset — takes effect on next launch.</span> : null}
        </Section>
        <Section title="Keyboard shortcuts">
          <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={keys} className="flex items-center justify-between gap-3 py-0.5">
                <dt className="text-sm text-fg-muted">{label}</dt>
                <dd>
                  <Kbd keys={keys} />
                </dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section title="Updates" description="Signed releases from GitHub, installed in place.">
          <UpdatePanel />
        </Section>
        <Section title="About">
          <dl className="space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="w-24 text-fg-subtle">Version</dt>
              <dd className="font-mono text-xs text-fg-muted">{version}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-fg-subtle">Runtime</dt>
              <RuntimeStatusRow />
            </div>
            <div className="flex gap-2">
              <dt className="w-24 text-fg-subtle">Shell</dt>
              <dd className="text-fg-muted">{isTauri() ? "Desktop app" : "Browser preview"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 text-fg-subtle">Client</dt>
              <dd className="text-fg-muted">{client.label}</dd>
            </div>
          </dl>
          <Button size="sm" variant="ghost" className="mt-3 -ml-2" onClick={() => {
            setPrefs({ onboarded: false });
            navigate("welcome");
          }}>
            Show welcome screen
          </Button>
        </Section>
      </ScreenBody>
    </>
  );
}
