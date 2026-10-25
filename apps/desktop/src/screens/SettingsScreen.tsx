import { Button, Kbd, SegmentedControl, ThemeToggle, safeStorage } from "@agentic-hub/ui";
import { useClient } from "@agentic-hub/ui/client";
import { FlaskConical, Plug } from "lucide-react";
import { useState, type ReactNode } from "react";
import { isTauri } from "../platform/native";
import { useAppState, type DataMode } from "../state/app-state";
import { ScreenBody, ScreenHeader } from "./ScreenHeader";

const SHORTCUTS: [string, string][] = [
  ["mod+k", "Command palette"],
  ["mod+n", "New session"],
  ["mod+o", "Open repository"],
  ["mod+y", "Session history"],
  ["mod+b", "Toggle sidebar"],
  ["mod+j", "Toggle review panel"],
  ["mod+shift+d", "Review changes"],
  ["mod+.", "Stop the active run"],
  ["mod+1", "Choose Codex (new session)"],
  ["mod+2", "Choose Claude Code (new session)"],
  ["mod+3", "Choose Muse (new session)"],
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

export function SettingsScreen({ toolbar }: { toolbar: ReactNode }) {
  const { prefs, setPrefs, navigate } = useAppState();
  const client = useClient();
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
              { value: "demo", label: "Demo fixtures", icon: <FlaskConical /> },
            ]}
          />
          <p className="mt-2 text-xs text-fg-muted">
            {prefs.dataMode === "demo"
              ? "Demo fixtures are sample data. Replies are scripted, no agent runs, and nothing on disk changes."
              : "Connects to the Agentic Hub runtime on this machine. Credentials stay with each agent's CLI or the runtime."}
          </p>
        </Section>
        <Section title="Providers" description="Agent CLIs, models and approval policy.">
          <Button size="sm" onClick={() => navigate("providers")}>
            Manage providers
          </Button>
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
        <Section title="About">
          <dl className="space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="w-24 text-fg-subtle">Version</dt>
              <dd className="font-mono text-xs text-fg-muted">0.1.0</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 text-fg-subtle">Shell</dt>
              <dd className="text-fg-muted">{isTauri() ? "Tauri desktop" : "Browser preview"}</dd>
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
