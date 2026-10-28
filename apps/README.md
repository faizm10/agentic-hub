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

## Data sources

Every screen reads data through one interface, `AgentHubClient`
(`packages/ui/src/client/types.ts`). Components never call `fetch` or Tauri
`invoke` themselves.

| Client | Where | Behaviour |
| --- | --- | --- |
| `createRuntimeClient()` | `packages/ui/src/client/runtime-client.ts` | Live client over the runtime's HTTP API and SSE (including ephemeral `delta` records). In the desktop app it is given `tauriFetch` (`apps/desktop/src/platform/tauri-fetch.ts`), which routes requests and streams through the Rust bridge; in a browser preview it calls the Vite `/runtime` bridge. Either way the bearer token stays outside page script. |
| `createWebClient()` | `apps/web/lib/web-client.ts` | The web app: web chats over `/api/chats` (server-side model calls, SSE back), and paired-computer sessions mirrored by the control plane, with actions queued as device commands. |
| `createDemoClient()` | `packages/ui/src/fixtures` | Opt-in sample data ("Explore with sample data"). Reports `mode: "demo"` and is labeled everywhere; it never saves keys or pairs. |
| `createUnavailableClient()` | `packages/ui/src/client` | Rejects every call with `RuntimeUnavailableError`, for hosts without a transport. |

## Architecture notes

- **View model, not contract.** `packages/ui/src/model/types.ts` holds *provisional* frontend view-model types, and `model/events.ts` defines the stream event vocabulary plus a pure reducer (`applySessionEvent`). These are not the shared contract and do not live in `packages/types`.
- **Streaming and reconnects.** `useSessionStream` loads a snapshot, then subscribes from its `lastSeq`. The reducer drops events with `seq <= lastSeq`, so a reconnecting stream can replay safely. `createReconnectingStream` is a transport-agnostic backoff loop (WebSocket, SSE or a Tauri channel), and the runtime client uses it for SSE. One runtime event (a complete snapshot) maps to one `batch` view event with the same sequence number, so replays stay idempotent.
- **No optimistic state for backend-owned semantics.** Approve, reject, cancel and send only call the client. Status changes come back as events (`approval.resolved`, `run.status`). Errors show inline, and the composer keeps the draft if a send fails.
- **TanStack Query** caches lists and snapshots. Stream events are written into the cache with `setQueryData`. Switching data source remounts the provider tree (`key={mode}`) so no query observer stays bound to the old client.

## Desktop specifics

- **Capabilities** (`src-tauri/capabilities/default.json`): `core:default`, window dragging, `dialog:allow-open` and `updater:default` (signed updates; `src/platform/updater.ts`), plus the app's own `runtime_*` and `app_restart` commands (`src-tauri/src/bridge.rs`), which only accept relative runtime API paths. There is no fs, shell or http plugin. The folder picker returns a path that is handed to the runtime via `addProject`.
- **CSP** is strict (`script-src 'self'`). The pre-paint theme script is served as `public/theme-init.js`, not inline.
- **Layout:** resizable, collapsible sidebar and review panel (`react-resizable-panels`), with sizes persisted per window. Under 900px both become overlay drawers that don't overwrite the desktop layout.
- **Preferences** (theme, data source, open panels, default agent, last project and session) are stored in `localStorage`, behind try/catch.
- The macOS title bar is overlaid, and drag regions use `data-tauri-drag-region`.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| ⌘K | Command palette (sessions, projects, actions) |
| ⌘N / ⌘O | New chat / open repository |
| ⌘E / ⌘\` | Code (explorer + editor) / terminal |
| ⌘B / ⌘J | Toggle sidebar / review panel |
| ⌘⇧D | Full-screen diff review |
| ⌘. | Stop the active run |
| ⌘1–5 | Pick Codex / Claude Code / Muse Code / OpenAI / Anthropic for a new chat |
| ⌘Y / ⌘, | History / settings |
| ↵ / ⇧↵ | Send / newline |

There is deliberately no global "approve" shortcut, to prevent approving a command by accident.

## Design system

Tokens live in `packages/ui/src/styles/tokens.css`: OKLCH CSS variables for
light and dark, mapped into Tailwind v4 through `@theme inline`. The theme is
`data-theme` on `<html>`, set before paint and driven by `ThemeProvider`
(System, Light or Dark). Each provider has its own token (`--agent-codex`,
`--agent-claude`, `--agent-muse`, `--agent-openai`, `--agent-anthropic`). Code blocks are highlighted with highlight.js using token-driven colours. Diffs use dedicated add/delete/hunk tokens.
Motion is minimal and respects `prefers-reduced-motion`.

The diff viewer is a custom, lightweight unified/split viewer. The desktop
**Code** screen uses Monaco (`apps/desktop/src/editor`), bundled locally with
Vite worker imports because the CSP forbids CDNs, and loaded lazily so it
doesn't slow startup.

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

Not exposed by the runtime yet, and therefore not shown: executable path, test results, staging and discarding individual hunks, and an activity feed across devices. Workspace methods (files, terminal jobs, integrations, approval policy) live on `AgentHubClient`; the web and demo clients reject them via `unsupportedWorkspace()`.

## Known limitations

- Web users see synced copies of device sessions. Diffs and very large tool outputs stay on the computer.
- Coding-agent model lists are shown in the desktop app; the web composer uses each computer's default model for them.
- Claude `AskUserQuestion` prompts and Muse questions are not yet represented as approvals.
- Without Tauri (browser preview), the folder picker falls back to a manual path field.
