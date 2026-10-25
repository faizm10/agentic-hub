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
| POST | `/sessions/:id/messages` | `SendMessageRequest` | `SendMessageResponse` (202) | Queue one turn. A session accepts only one active turn. |
| POST | `/sessions/:id/cancel` | — | `CancelSessionResponse` | Request cancellation of an active turn; repeated cancellation is idempotent. |
| GET | `/sessions/:id/events` | — | `GetSessionEventsResponse` or SSE | Replay and subscribe to ordered events. |
| GET | `/sessions/:id/diff` | — | `GetSessionDiffResponse` | Current working tree diff for the session's project. |
| POST | `/approvals/:id/resolve` | `ResolveApprovalRequest` | `ResolveApprovalResponse` | Resolve a pending provider approval once. Unsupported provider approvals return `UNSUPPORTED_ACTION`. |

## Events and streaming

`GET /sessions/:id/events?after=N` returns JSON by default, with events whose `sequence` is strictly greater than `N` (`after` defaults to `-1`). `nextSequence` is the next sequence number the server will assign. With `Accept: text/event-stream`, the same route replays after `Last-Event-ID` (or `after`, if supplied), then follows live events. Each SSE record uses `id: <sequence>`, `event: <AgentEvent.type>`, and `data: <AgentEvent JSON>`. Event sequence numbers are per session, contiguous from zero, and assigned after durable persistence. Reconnect with the last received ID; clients should deduplicate by `(sessionId, sequence)`. A heartbeat comment may appear without an event ID. Event payloads are complete snapshots, not token deltas. A `completed` event terminates a turn; the stream may stay open for a later turn.

## Lifecycle and approvals

Sessions begin `idle`. A message creates a task and run, then moves the session to `running`. A provider approval moves it to `awaiting_approval`; resolving it returns to `running`. A turn ends `completed`, `failed`, or `cancelled`. Another message may be sent after `completed`, `failed`, or `cancelled` if the adapter supports interactive messages. Runtime restart marks in-flight sessions and runs `interrupted`; interrupted sessions require a new message to resume and are never silently replayed. `providerSessionId` preserves the provider's opaque conversation identifier when available. No event is fabricated to imply a provider approval or tool action that the provider did not report. Runtime decisions and provider events share the same ordered log.

Approval resolution must call the provider's supported mechanism before marking approval resolved. If that mechanism is unavailable, `/approvals/:id/resolve` returns `UNSUPPORTED_ACTION`; it never silently auto-approves. Clients should show `ApprovalRequest.description` as untrusted text.

## Errors

Non-2xx responses use `{ "error": { "code": "...", "message": "..." } }`. Expected codes are `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `CONFLICT` (409), `PROVIDER_UNAVAILABLE` (503), `UNSUPPORTED_ACTION` (422), and `INTERNAL_ERROR` (500). Provider errors are persisted as `error` events and terminate the active run as failed. No API error exposes credentials or raw environment variables.
