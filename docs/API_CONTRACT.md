# Agentic Hub local runtime API (v1)

The canonical TypeScript types and Zod schemas live in `@agentic-hub/types`. JSON uses camelCase. IDs are UUIDs and times are ISO 8601 UTC strings. Unknown request fields are ignored by v1 schemas; clients should not depend on that behavior.

## Connection and authentication

The runtime binds to `127.0.0.1` by default. A random bearer token is generated for each runtime start and made available only to the launching desktop process (or a local token file with owner-only permissions). All endpoints except `/health` require `Authorization: Bearer <token>`. `/health` has no project paths or secret data. CORS is disabled by default. The web application must connect through an explicitly paired local bridge; this API must never be published directly to the internet. Remote approval forwarding is outside v1.

## Endpoints

| Method | Path | Request | Success response | Semantics |
| --- | --- | --- | --- | --- |
| GET | `/health` | — | `GetHealthResponse` | Runtime and provider readiness. |
| GET | `/providers` | — | `GetProvidersResponse` | Includes unavailable adapters and capability flags. |
| GET | `/projects` | — | `GetProjectsResponse` | Registered local repositories. |
| POST | `/projects` | `CreateProjectRequest` | `CreateProjectResponse` (201) | Resolve and validate an existing Git repository path; duplicate canonical paths return the existing project. |
| GET | `/sessions` | — | `GetSessionsResponse` | All sessions, newest first. |
| POST | `/sessions` | `CreateSessionRequest` | `SessionResponse` (201) | Create an idle session for a registered project and executable provider. |
| GET | `/sessions/:id` | — | `SessionResponse` | Current persisted state. |
| POST | `/sessions/:id/messages` | `SendMessageRequest` | `SendMessageResponse` (202) | Starts a turn or persists it in the queue while another turn is active. |
| POST | `/sessions/:id/cancel` | — | `CancelSessionResponse` | Request cancellation of an active turn; repeated cancellation is idempotent. |
| GET | `/sessions/:id/events` | — | `GetSessionEventsResponse` or SSE | Replay and subscribe to ordered events. |
| GET | `/sessions/:id/diff` | — | `GetSessionDiffResponse` | Current working tree diff for the session's project. |
| POST | `/approvals/:id/resolve` | `ResolveApprovalRequest` | `ResolveApprovalResponse` | Resolve a pending provider approval once. Unsupported provider approvals return `UNSUPPORTED_ACTION`. |

## Events and streaming

`GET /sessions/:id/events?after=N` returns JSON by default, with events whose `sequence` is strictly greater than `N` (`after` defaults to `-1`). `nextSequence` is the next sequence number the server will assign. With `Accept: text/event-stream`, the same route replays after `Last-Event-ID` (or `after`, if supplied), then follows live events. Each SSE record uses `id: <sequence>`, `event: <AgentEvent.type>`, and `data: <AgentEvent JSON>`. Event sequence numbers are per session, contiguous from zero, and assigned after durable persistence. Reconnect with the last received ID; clients should deduplicate by `(sessionId, sequence)`. A heartbeat comment may appear without an event ID. Event payloads are complete snapshots, not token deltas. A `completed` event terminates a turn; the stream may stay open for a later turn.

SSE requires the same bearer header as JSON routes. Browser `EventSource` cannot set that header, so use an authenticated `fetch` stream in desktop or a separately designed, explicitly paired bridge for web. The runtime does not enable CORS.

## Lifecycle and approvals

Sessions begin `idle`. A message creates a task and run, then moves the session to `running`. A provider approval moves it to `awaiting_approval`; resolving it returns to `running`. A turn ends `completed`, `failed`, or `cancelled`. Another message may be sent after `completed`, `failed`, or `cancelled` if the adapter supports interactive messages. Runtime restart marks in-flight sessions and runs `interrupted`; interrupted sessions require a new message to resume and are never silently replayed. `providerSessionId` preserves the provider's opaque conversation identifier when available. No event is fabricated to imply a provider approval or tool action that the provider did not report. Runtime decisions and provider events share the same ordered log.

Approval resolution must call the provider's supported mechanism before marking approval resolved. If that mechanism is unavailable, `/approvals/:id/resolve` returns `UNSUPPORTED_ACTION`. The optional runtime auto-approve setting sends approval decisions through that same mechanism; it is off by default. Clients should show `ApprovalRequest.description` as untrusted text.

Queued messages are encrypted in the local database. They run in order when the active turn finishes, and remaining messages resume after a runtime restart. `GET /sessions/:id/queue` lists them; `DELETE /sessions/:id/queue/:messageId` removes one before it starts.

`GET /sessions/:id/diff` reads the repository's current working tree against `HEAD`. Its `files` list includes untracked files; `patch` includes tracked changes only. It is a current repository snapshot, not a per-turn patch. Worktree isolation and remote access are outside this local v1 runtime.

## Errors

Non-2xx responses use `{ "error": { "code": "...", "message": "..." } }`. Expected codes are `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `CONFLICT` (409), `PROVIDER_UNAVAILABLE` (503), `UNSUPPORTED_ACTION` (422), and `INTERNAL_ERROR` (500). Provider errors are persisted as `error` events and terminate the active run as failed. No API error exposes credentials or raw environment variables.

## Additions in 0.2

| Method | Path | Request | Success response | Semantics |
| --- | --- | --- | --- | --- |
| GET | `/providers?refresh` | — | `GetProvidersResponse` | `refresh` re-runs CLI detection instead of using the 15 s cache. |
| GET | `/providers/:provider/models` | — | `GetModelsResponse` | Models from the provider's own discovery (`codex`, `claude`, `muse`, `openai`, `anthropic`). Cached for 5 minutes. |
| PUT | `/providers/:provider/credentials` | `SetCredentialRequest` | `ProviderResponse` | `openai` and `anthropic` only. The key is verified with the provider, then stored encrypted. It is never returned; `ProviderInfo.credential` carries a hint like `sk-…abcd` and its source (`stored` or `environment`). |
| DELETE | `/providers/:provider/credentials` | — | `ProviderResponse` | Removes a stored key. |
| GET | `/pairing` | — | `{ pairing: PairingStatus }` | Web control-plane pairing status. See [CONTROL_PLANE.md](CONTROL_PLANE.md). |
| POST | `/pairing` | `PairDeviceRequest` | `{ pairing: PairingStatus }` | Pairs with a web app using a one-time code. |
| PATCH | `/pairing` | `UpdatePairingRequest` | `{ pairing: PairingStatus }` | Turns "Allow control from the web" on or off. |
| DELETE | `/pairing` | — | `{ pairing: PairingStatus }` | Unpairs. |
| GET | `/settings` | — | `{ autoApprove: boolean }` | Reads the local approval setting. |
| PATCH | `/settings` | `{ autoApprove: boolean }` | `{ autoApprove: boolean }` | Changes the local approval setting. |
| GET | `/sessions/:id/queue` | — | `{ messages: QueuedMessage[] }` | Lists pending turns in order. |
| DELETE | `/sessions/:id/queue/:messageId` | — | `{ removed: true }` | Removes a pending turn. |
| GET | `/projects/:id/activity` | — | `{ activity: DeveloperActivity }` | GitHub commits and pull requests, Vercel deployments, and update status for a repository. Uses installed CLI sign-ins. |
| POST | `/projects/:id/update` | — | `{ updated: true }` | Fetches and fast-forwards a clean checkout; rejects dirty or diverged branches. |
| GET | `/ide-update` | — | `{ update: IdeUpdateInfo }` | Compares the installed version with the latest public GitHub release. |
| POST | `/ide-update/open` | — | `{ opened: true }` | Opens the latest release page in the system browser when a newer version exists. |

`ProviderInfo` gains optional `kind` (`agent` or `model`), `authMethod` (`cli` or `api-key`), `credential`, `version`, `defaultModel` and `setupUrl`. `AgentCapabilities` gains optional `modelDiscovery` and `textDeltas`. `GET /sessions` also returns `titles` and `messageCounts` keyed by session ID, and `GET /sessions/:id` returns `title` and `pendingApprovals`.

`AgentConfig.model` is passed to the provider when a session starts; leave it out for the provider's default.

### Streaming deltas

Over SSE, providers with `textDeltas` also send ephemeral records:

```
event: delta
data: {"sessionId":"…","taskRunId":"…","streamId":"…","kind":"text","delta":"Hel"}
```

Deltas have no `id`, are not persisted, and are never replayed after a reconnect. The complete `message` or `reasoning_summary` event that follows is authoritative; clients replace their partial text with it. JSON polling never returns deltas.

### Runtime process

On start the runtime takes an exclusive `runtime.lock` in its data directory (exit code 3 if another live runtime holds it), removes token files left by dead runtimes, and prints a machine-readable line for supervisors:

```
AGENTIC_HUB_READY {"url":"http://127.0.0.1:PORT","tokenFile":"…/token-PID","pid":PID,"version":"0.3.0"}
```

With `AGENTIC_HUB_EXIT_WITH_PARENT=1` it shuts down when its stdin closes, so it never outlives the desktop app.

## Workspace, integrations and approvals (v0.3)

All routes need the bearer token. Where a route takes `?sessionId=`, it acts on that session's worktree instead of the main checkout.

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/settings` | | `{ autoApprove, approvalPolicy }` |
| PATCH | `/settings` | `{ approvalPolicy }` or legacy `{ autoApprove }` | same |
| GET | `/environment` | `?refresh` | `{ environment: { tools: ToolCheck[], cloneDirectory, platform } }` (Git, Node.js, Claude Code, Codex, gh, Vercel, Muse) |
| GET | `/integrations` | | `{ integrations: IntegrationStatus[] }` |
| GET | `/github/repositories` | | `{ repositories }` from `gh repo list` |
| POST | `/projects/clone` | `{ repository: "owner/name" \| URL, directory? }` | `{ project }`, 201 when new |
| POST | `/sessions` | `{ projectId, config, isolation?: "none" \| "worktree" }` | `{ session }` with `worktree: { path, branch, baseRef }` when isolated |
| GET | `/projects/:id/files` | `?path=&sessionId=` | `{ entries: FileEntry[] }` (hides `.git`, `node_modules`, build output) |
| GET | `/projects/:id/file` | `?path=&sessionId=` | `{ file: { path, content, language, binary, truncated, size } }` (2 MB cap) |
| PUT | `/projects/:id/file` | `{ path, content }` | `{ file }`, written atomically |
| POST | `/projects/:id/commands` | `{ command, sessionId? }` | 202 `{ job }`; runs in the user's login shell in the checkout |
| POST | `/projects/:id/actions` | `{ input: IntegrationAction, confirm? }` | 202 `{ job }`; **428 `CONFIRMATION_REQUIRED`** for non-low-risk actions without `confirm: true` |
| GET | `/projects/:id/github` | `?sessionId=` | `{ github: GitHubOverview }` (repo, branches, commits, PRs with checks/review state, open issues) |
| GET | `/projects/:id/vercel` | `?sessionId=` | `{ vercel: VercelOverview }` (linked project, deployments) |
| GET | `/jobs` | `?projectId=` | `{ jobs }` (output tail only) |
| GET | `/jobs/:id` | | `{ job }` with full output (400 KB cap) |
| POST | `/jobs/:id/cancel` | | `{ job }`; kills the process group |
| GET | `/jobs/:id/stream` | `Accept: text/event-stream` | `snapshot`, then `output` (JSON string chunks), then `done` (final job) |

File paths are relative to the checkout. Absolute paths, `..`, symlinks that resolve outside the checkout and `.git/` are rejected with 400.

### Integration actions and their risk

| Action | Runs | Risk |
| --- | --- | --- |
| `git.commit` | `git add -A && git commit` | low |
| `github.pr.create` / `github.issue.create` | `gh pr create` / `gh issue create` | low |
| `github.pr.review` | `gh pr review` (comment, request-changes: low; approve: medium) | low/medium |
| `vercel.logs` | `vercel inspect <id> --logs` | low |
| `git.push` | `git push --set-upstream origin <branch>` | medium; high on the default branch |
| `vercel.deploy` | `vercel deploy` (preview: medium) / `--prod` (high) | medium/high |
| `github.pr.merge` | `gh pr merge` | high |

### Approval policy

`approvalPolicy = { mode: "ask" | "trusted", autoApproveFileEdits, trustedCommands[] }`. Every `approval_requested` event carries `risk` (`low`/`medium`/`high`) and `riskReasons` from the runtime's classifier (`packages/agent-core/src/approval-policy.ts`). In `trusted` mode only **low** risk requests are approved automatically (marked `autoApproved: true`): read-only tools, built-in or user-trusted command prefixes without shell chaining, and, if enabled, file edits inside the checkout. High risk (recursive/forced deletes, `sudo`, `git push`, history rewrites, deploys, publishes, `chmod`/`chown`, secrets and credentials, `curl | sh`, CI workflow edits, destructive SQL, infrastructure changes) always waits for the user. Before v0.3, `autoApprove: true` approved everything; it now maps to `trusted`.
