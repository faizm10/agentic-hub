# Agentic Hub backend

Local TypeScript runtime for Codex and Claude Code sessions. It stores projects, sessions, runs, approvals, and an ordered event log in SQLite, and exposes a loopback HTTP API. Muse appears in provider discovery as unavailable until a supported integration exists.

## Start

Requires Node.js 22, pnpm 10, Git, and the signed-in `codex` and/or `claude` CLI for live runs.

```sh
pnpm install
pnpm build
pnpm --filter @agentic-hub/runtime start
```

The runtime binds to `127.0.0.1:43117` by default. Set `AGENTIC_HUB_PORT=0` to request an available port, or set `AGENTIC_HUB_DATA_DIR` for a separate SQLite database. Startup prints the bound URL and the path to a fresh owner-only token file. The launcher should read the token file and pass its contents as `Authorization: Bearer <token>`. The token changes on each start and is deleted during normal shutdown. The runtime data directory is owner-only. Do not expose this API through a public port or reverse proxy.

Example from another terminal (substitute the token file path printed at startup):

```sh
TOKEN_FILE=/path/printed/by/runtime
curl -H "Authorization: Bearer $(cat "$TOKEN_FILE")" http://127.0.0.1:43117/providers
```

Register an existing Git repository with `POST /projects`, create a session with `POST /sessions`, send text with `POST /sessions/:id/messages`, then follow `GET /sessions/:id/events` using JSON polling or SSE. The [API contract](docs/API_CONTRACT.md) defines DTOs, errors, replay, and lifecycle details. The exported schemas are in `@agentic-hub/types`.

## Frontend integration

The desktop UI (`apps/desktop`) and the shared UI library (`packages/ui`) talk to this runtime through `createRuntimeClient` (`packages/ui/src/client/runtime-client.ts`). In development, the desktop's Vite server exposes a same-origin `/runtime` bridge (`apps/desktop/runtime-bridge.ts`). The bridge reads the live token file and forwards requests to the loopback runtime, so the webview never holds the token and the runtime keeps CORS disabled. The web dashboard (`apps/web`) shows a disconnected state until a paired bridge exists. See [apps/README.md](apps/README.md).

```sh
pnpm install
pnpm runtime:start     # terminal 1: builds and starts the runtime on 127.0.0.1:43117
pnpm dev:desktop       # terminal 2: desktop UI at http://localhost:1420 (choose "Connect to the local runtime")
pnpm dev:web           # optional: web dashboard at http://localhost:3200
```

For a native window, run `pnpm --filter @agentic-hub/desktop tauri:dev` instead of `dev:desktop`. This needs Rust and the Tauri prerequisites.

## Checks

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

For backend packages, `lint` runs strict TypeScript checks. The frontend packages use ESLint. `packages/ui` includes `runtime-client.integration.test.ts`, which drives the real runtime server (SessionManager, SQLite store, Git diff) through the frontend client with a scripted provider. Tests cover session transitions, concurrent turn rejection, persistence recovery and credential redaction, API authentication and validation, Git diff, and adapter event normalization. A live reply-only Codex turn returned `PONG` through App Server. Claude Code is installed but is currently signed out, so live Claude connectivity is unverified in this worktree. Approval paths have deterministic normalization coverage but have not yet been exercised against live provider prompts.

The runtime encrypts persisted project, session, task, run, event, and approval payloads with AES-256-GCM. Its owner-only key file sits beside `runtime.db` and is required to reopen that database; back up the two together. Existing plaintext payload rows are encrypted when opened. Common API key and authorization token forms are also redacted from task and event text before storage and streaming. That redaction is best effort, so avoid credentials in prompts. Database index columns (IDs, project paths, status, timestamps, and event sequence numbers) remain plaintext. Codex currently forwards command and file change approval requests; other App Server input requests fail closed. Claude `AskUserQuestion` input is not yet represented by the v1 approval DTO. Git diff reports a repository-wide working tree snapshot; isolated worktree creation and a paired web bridge are deferred.

## Provider APIs

- Codex: [App Server protocol](https://learn.chatgpt.com/docs/app-server), using local stdio JSON-RPC with `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, and documented approval requests.
- Claude Code: [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview), using `query`, `resume`, `canUseTool`, and abort cancellation.
