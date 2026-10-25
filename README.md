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

Cherry-pick the shared contract checkpoint `c4b2287fa023d4cdb5558ad6da4d722cd16bb296` into `feat/frontend` before importing `@agentic-hub/types`. Run `pnpm install` in that worktree. The desktop launcher starts `@agentic-hub/runtime`, reads its token file, and calls the printed loopback URL. Use bearer-authenticated `fetch` for SSE; native browser `EventSource` cannot add the token header. A web client requires a separate explicitly paired local bridge; this repository does not provide remote execution.

Provider sessions keep opaque Codex thread IDs or Claude session IDs. On runtime restart, active runs are marked `interrupted` and never silently replayed. New messages can resume a saved provider conversation when the provider ID exists.

## Checks

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

The `lint` script currently runs strict TypeScript checks; there is no separate style linter. Tests cover session transitions, concurrent turn rejection, persistence recovery and credential redaction, API authentication and validation, Git diff, and adapter event normalization. A live reply-only Codex turn returned `PONG` through App Server. Claude Code is installed but is currently signed out, so live Claude connectivity is unverified in this worktree. Approval paths have deterministic normalization coverage but have not yet been exercised against live provider prompts.

The runtime redacts common API key and authorization token forms before persisting task and event text. This is best-effort detection, not a replacement for avoiding credentials in prompts. Codex currently forwards command and file change approval requests; other App Server input requests fail closed. Claude `AskUserQuestion` input is not yet represented by the v1 approval DTO. Git diff reports a repository-wide working tree snapshot; isolated worktree creation and a paired web bridge are deferred.

## Provider APIs

- Codex: [App Server protocol](https://learn.chatgpt.com/docs/app-server), using local stdio JSON-RPC with `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, and documented approval requests.
- Claude Code: [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview), using `query`, `resume`, `canUseTool`, and abort cancellation.
