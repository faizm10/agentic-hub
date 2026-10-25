# Agentic Hub — Frontend

Desktop app (Tauri + React), web companion (Next.js) and the shared component
library they both use. Backend pieces (`apps/runtime`, `packages/types`, agent
integrations, Git, database) are described in the root `README.md` and
`docs/API_CONTRACT.md`.

```
apps/desktop      Vite + React UI, Tauri v2 shell in src-tauri/
apps/web          Next.js 16 App Router companion dashboard
packages/ui       Design tokens, primitives, components, client boundary, demo fixtures
```

## Setup

Requirements: Node 22+, pnpm 10. For the native desktop shell you also need
Rust (stable) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install

pnpm dev:desktop                         # desktop UI in a browser at http://localhost:1420
pnpm --filter @agentic-hub/desktop tauri:dev   # native window (needs Rust)
pnpm dev:web                             # web dashboard at http://localhost:3200

pnpm fe:check                            # typecheck + lint + tests + builds
```

`fe:typecheck`, `fe:lint`, `fe:test` and `fe:build` run each step on its own.

## Data sources: demo vs live

Every screen reads data through one interface, `AgentHubClient`
(`packages/ui/src/client/types.ts`). Components never call `fetch` or Tauri
`invoke` themselves.

| Client | Where | Behaviour |
| --- | --- | --- |
| `createDemoClient()` | `packages/ui/src/fixtures` | Sample data plus scripted event replays. Reports `mode: "demo"`, so shells show a persistent **Demo mode** banner. Every replay opens with a notice that no agent is running and nothing on disk changes. |
| `createRuntimeClient()` | `packages/ui/src/client/runtime-client.ts` | Live client over the runtime's v1 HTTP API and bearer-authenticated `fetch` SSE. `client/adapters.ts` maps `@agentic-hub/types` onto the view model. While the runtime is unreachable, calls reject with `RuntimeUnavailableError` and the connection reports `disconnected`. A probe retries on its own, and `<RefetchOnReconnect />` reloads data once the runtime is back. |
| `createUnavailableClient()` | `packages/ui/src/client` | Used where no live transport exists: the web dashboard (no paired control plane) and packaged Tauri builds (no native bridge yet). Every call rejects with `RuntimeUnavailableError`. |

- **Desktop:** the welcome screen asks whether to connect to the local runtime or explore demo data. You can switch later in Settings → Data source. Live mode calls `/runtime/*` on the Vite dev/preview server. `apps/desktop/runtime-bridge.ts` forwards those calls to `AGENTIC_HUB_RUNTIME_URL` (default `http://127.0.0.1:43117`) and attaches the bearer token read from the newest live `token-<pid>` file in `AGENTIC_HUB_DATA_DIR` (default `~/.agentic-hub`). The token never reaches page script. The bridge rejects non-loopback Hosts, cross-origin requests and cross-site requests.
- **Web:** defaults to "Control plane — not connected", which shows the offline explainer. Demo data is opt-in from the header menu.
- **Remote actions on the web** (start, cancel, approve) are always disabled with an explanation. `remoteActionsAvailable()` returns `false` until an authenticated control plane exists. The browser never talks to `localhost` or the filesystem.

## Architecture notes

- **View model, not contract.** `packages/ui/src/model/types.ts` holds *provisional* frontend view-model types, and `model/events.ts` defines the stream event vocabulary plus a pure reducer (`applySessionEvent`). These are not the shared contract and do not live in `packages/types`.
- **Streaming and reconnects.** `useSessionStream` loads a snapshot, then subscribes from its `lastSeq`. The reducer drops events with `seq <= lastSeq`, so a reconnecting stream can replay safely. `createReconnectingStream` is a transport-agnostic backoff loop (WebSocket, SSE or a Tauri channel), and the runtime client uses it for SSE. One runtime event (a complete snapshot) maps to one `batch` view event with the same sequence number, so replays stay idempotent.
- **No optimistic state for backend-owned semantics.** Approve, reject, cancel and send only call the client. Status changes come back as events (`approval.resolved`, `run.status`). Errors show inline, and the composer keeps the draft if a send fails.
- **TanStack Query** caches lists and snapshots. Stream events are written into the cache with `setQueryData`. Switching data source remounts the provider tree (`key={mode}`) so no query observer stays bound to the old client.

## Desktop specifics

- **Capabilities** (`src-tauri/capabilities/default.json`): `core:default`, window dragging, and `dialog:allow-open`, nothing else. There is no fs, shell or http plugin. The folder picker returns a path that is handed to the runtime via `addProject`.
- **CSP** is strict (`script-src 'self'`). The pre-paint theme script is served as `public/theme-init.js`, not inline.
- **Layout:** resizable, collapsible sidebar and review panel (`react-resizable-panels`), with sizes persisted per window. Under 900px both become overlay drawers that don't overwrite the desktop layout.
- **Preferences** (theme, data source, open panels, default agent, last project and session) are stored in `localStorage`, behind try/catch.
- The macOS title bar is overlaid, and drag regions use `data-tauri-drag-region`.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| ⌘K | Command palette (sessions, projects, actions) |
| ⌘N / ⌘O | New session / open repository |
| ⌘B / ⌘J | Toggle sidebar / review panel |
| ⌘⇧D | Full-screen diff review |
| ⌘. | Stop the active run |
| ⌘1–3 | Pick Codex / Claude Code / Muse for a new session |
| ⌘Y / ⌘, | History / settings |
| ↵ / ⇧↵ | Send / newline |

There is deliberately no global "approve" shortcut, to prevent approving a command by accident.

## Design system

Tokens live in `packages/ui/src/styles/tokens.css`: OKLCH CSS variables for
light and dark, mapped into Tailwind v4 through `@theme inline`. The theme is
`data-theme` on `<html>`, set before paint and driven by `ThemeProvider`
(System, Light or Dark). Each agent has its own token (`--agent-codex`,
`--agent-claude`, `--agent-muse`). Diffs use dedicated add/delete/hunk tokens.
Motion is minimal and respects `prefers-reduced-motion`.

The diff viewer is a custom, lightweight unified/split viewer with no Monaco
bundle. Swap in Monaco's diff editor only if inline editing becomes a
requirement.

Components (all exported from `@agentic-hub/ui`): `AppShell`,
`ProjectSidebar`, `ProjectSwitcher`, `SessionList`, `SessionHeader`,
`AgentSelector`, `ChatComposer`, `ChatMessage`, `ReasoningSummary`,
`AgentEventTimeline`, `ToolExecutionCard`, `ApprovalRequestCard`,
`RunStatusIndicator`, `ChangedFilesList`, `DiffViewer`, `SessionInspector`,
`SessionDetailsPanel`, `AgentActivityList`, `TestResultsList`,
`ProviderSettings`, `DeviceStatusCard`, `ConnectionBanner`, `CommandPalette`,
`ThemeToggle`, `EmptyState`, `ErrorState`, `DisconnectedState`, plus Radix-based
primitives.

## Backend integration

Contract mapping, implemented in `packages/ui/src/client/adapters.ts`:

| Runtime (`@agentic-hub/types`) | UI view model |
| --- | --- |
| provider `claude` / `codex` / `muse` | agent `claude-code` / `codex` / `muse` |
| approval decision `deny` | `reject` |
| session status `interrupted` | run status `interrupted` (shown as "Interrupted") |
| `ProviderInfo` (installed, authenticated, ready, reason) | `ProviderConfig.status` `ready` / `needs_auth` / `not_installed` / `error` |
| `GET /sessions/:id/diff` (one repository patch) | per-file `FileDiff`, split from the patch. Untracked files are listed but have no patch. |
| snapshot events (`message`, `tool_result`, …) | one `batch` event folding the equivalent deltas |
| `createSession({ prompt })` | `POST /sessions`, then `POST /sessions/:id/messages` |

Session titles and message counts are derived from the event log (the first user message), because the runtime has no title field.

Not exposed by the runtime yet, and therefore not shown or kept read-only: provider models, approval policy, executable path and version, a settings write API, test results, risk levels on approvals, staging and discarding changes, devices and the activity feed.

## Known limitations

- The Tauri shell has not been compiled in this environment (no Rust toolchain). `tauri.conf.json` validates against the official v2 schema, and the Vite frontend builds and runs.
- Live mode needs the Vite dev/preview server bridge. A packaged Tauri build reports the runtime as unavailable until a native launcher/bridge exists (it would spawn the runtime, read its token file, and proxy requests from Rust).
- The web dashboard stays disconnected by design. The runtime contract requires an explicitly paired bridge for web clients, and none exists yet.
- Without Tauri, the folder picker falls back to a manual path field that is clearly labeled.
