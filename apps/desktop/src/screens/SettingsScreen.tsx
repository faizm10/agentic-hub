import { Button, Kbd, PairingSettings, SegmentedControl, ThemeToggle, safeStorage } from "@agentic-hub/ui";
import { errorMessage, useAutoApprove, useClient, usePairing, usePairingActions, useSetAutoApprove } from "@agentic-hub/ui/client";
import { FlaskConical, Plug } from "lucide-react";
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
  const autoApprove = useAutoApprove(client.mode === "live");
  const setAutoApprove = useSetAutoApprove();
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
        <Section title="Tool approvals" description="Choose how this computer answers coding agent approval requests.">
          {client.mode === "demo" ? <p className="text-sm text-fg-muted">Switch to the local runtime to change approvals.</p> : autoApprove.isPending ? <p className="text-sm text-fg-muted">Loading approval settings…</p> : (
            <SegmentedControl<"manual" | "automatic">
              label="Tool approval mode"
              value={autoApprove.data ? "automatic" : "manual"}
              onChange={(mode) => void setAutoApprove.mutate(mode === "automatic")}
              options={[{ value: "manual", label: "Ask me" }, { value: "automatic", label: "Auto approve" }]}
            />
          )}
          <p className="mt-2 text-xs text-fg-muted">Auto approve allows requested commands and file changes without pausing. It applies to coding agents on this computer and is off by default.</p>
          {autoApprove.isError ? <p className="mt-2 text-xs text-danger">{errorMessage(autoApprove.error)}</p> : null}
          {setAutoApprove.isError ? <p className="mt-2 text-xs text-danger">{errorMessage(setAutoApprove.error)}</p> : null}
        </Section>
        <Section title="Web access" description="Use this computer's agents from the Agentic Hub website.">
          <WebAccess />
        </Section>
        <Section title="GitHub and Vercel" description="View commits, pull requests, deployments, and repository updates in the IDE.">
          <p className="mb-3 text-xs text-fg-muted">Use your existing CLI sign-ins: <code className="font-mono">gh auth login</code> and <code className="font-mono">vercel login</code>. Link the repository with <code className="font-mono">vercel link</code>.</p>
          <Button size="sm" onClick={() => navigate("activity")}>Open developer activity</Button>
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
