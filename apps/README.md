# Agentic Hub — Frontend

Desktop app (Tauri + React), web companion (Next.js) and the shared component
library they both use. Backend pieces (`apps/runtime`, `packages/types`, agent
integrations, Git, database) are owned by the backend branch and are **not**
part of this tree.

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
| `createUnavailableClient()` | `packages/ui/src/client` | Live mode until the backend contract is integrated. Every call rejects with `RuntimeUnavailableError`, so the UI renders honest offline and disconnected states. |

- **Desktop:** the welcome screen asks whether to connect to the local runtime or explore demo data. You can switch later in Settings → Data source.
- **Web:** defaults to "Control plane — not connected", which shows the offline explainer. Demo data is opt-in from the header menu.
- **Remote actions on the web** (start, cancel, approve) are always disabled with an explanation. `remoteActionsAvailable()` returns `false` until an authenticated control plane exists. The browser never talks to `localhost` or the filesystem.

## Architecture notes

- **View model, not contract.** `packages/ui/src/model/types.ts` holds *provisional* frontend view-model types, and `model/events.ts` defines the stream event vocabulary plus a pure reducer (`applySessionEvent`). These are not the shared contract and do not live in `packages/types`.
- **Streaming and reconnects.** `useSessionStream` loads a snapshot, then subscribes from its `lastSeq`. The reducer drops events with `seq <= lastSeq`, so a reconnecting stream can replay safely. `createReconnectingStream` is a transport-agnostic backoff loop (WebSocket, SSE or a Tauri channel), with tests but not yet wired to a real transport.
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

Once the backend contract commit is cherry-picked:

1. Add `"@agentic-hub/types": "workspace:*"` to `packages/ui`.
2. In `packages/ui/src/client/adapters.ts`, map the contract types to the view model, including the stream events to `SessionEventPayload`.
3. Add `client/runtime-client.ts` implementing `AgentHubClient` over the runtime transport, using `createReconnectingStream` for events. Then switch `apps/desktop/src/client.ts` (live) and `apps/web/lib/data-source.tsx` (control plane) over to it.

What the UI needs from the backend (to confirm against the contract, not invent):

- List and register projects. `addProject(path)` should validate that the path is a Git repo and return its branch.
- List, get and create sessions. A snapshot needs a **monotonic per-session `seq`**, and the event stream must be **resumable from a cursor**.
- Events covering messages (delta and complete), reasoning summaries, tool start/output/complete with exit code, approval requested/resolved, run status, changed files and test runs.
- Send message, cancel run and resolve approval. The backend is the source of truth for state transitions; the UI waits for events.
- Per-file diff (unified patch), provider detection (status, executable, version, models, approval policy) and a settings write API.
- For the web: an authenticated control plane exposing devices, activity and, once authorized, remote actions.

Things that are visibly disabled until the backend exists: staging and discarding changes (review screen), editing provider settings, and every remote action on the web.

## Root-level changes made by this branch

No shared scaffolding existed, so this branch created the minimum needed for a
pnpm workspace. Merge these with the backend branch by taking the union:

- `pnpm-workspace.yaml`: `apps/*`, `packages/*`
- `package.json`: workspace root with `dev:*` and `fe:*` scripts only
- `.gitignore`: Node, Next, Vite and Tauri build outputs
- `pnpm-lock.yaml`: regenerate after merging (`pnpm install`)

## Known limitations

- The Tauri shell has not been compiled in this environment (no Rust toolchain). `tauri.conf.json` validates against the official v2 schema, and the Vite frontend builds and runs.
- Live mode is intentionally non-functional until the backend contract lands.
- Without Tauri, the folder picker falls back to a manual path field that is clearly labeled.
