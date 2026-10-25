# Agentic Hub

One workspace for your coding agents and AI models.

- **Coding agents** work inside a Git repository on your computer: **Codex** (OpenAI, through its App Server), **Claude Code** (Anthropic, through the Claude Agent SDK) and **Muse Code** (Meta, through the Muse Session Protocol SDK). They stream replies, ask before risky tool calls, and show the resulting Git diff.
- **Model APIs**: chat with **OpenAI** and **Anthropic** models through their official APIs, with model discovery and streaming.
- **Desktop app** (macOS, Tauri 2) runs everything locally.
- **Web app** (Next.js on Vercel) has accounts, web chats with model APIs, and a secure pairing link to your desktop so you can follow, and optionally control, agent sessions from anywhere.

```
apps/desktop    Tauri 2 desktop app: React UI + Rust supervisor for the local runtime
apps/runtime    Local Node.js runtime: sessions, agents, approvals, Git, encrypted SQLite
apps/web        Next.js web app and control plane (deploys to Vercel)
packages/types        Shared API contract (Zod schemas)
packages/agent-core   Session manager and provider adapter interface
packages/agent-codex  Codex App Server adapter
packages/agent-claude Claude Agent SDK adapter
packages/agent-muse   Muse Code SDK adapter
packages/agent-api    OpenAI and Anthropic API adapters
packages/database     Encrypted SQLite store (node:sqlite)
packages/git          Repository and diff helpers
packages/ui           Shared design system, components and client layer
```

## How it fits together

```
 Desktop app (Tauri)                         Web app (Vercel)
 ┌─────────────────────────────┐             ┌──────────────────────────────┐
 │ React UI ──IPC──> Rust      │             │ Next.js UI ─> route handlers │
 │            bridge (token)   │             │   accounts, web chats,       │
 │              │              │   HTTPS,    │   encrypted keys (Postgres)  │
 │              ▼              │  outbound   │                              │
 │ Node runtime (127.0.0.1) ───┼────only────>│ /api/device/* control plane  │
 │  Codex · Claude Code · Muse │             └──────────────────────────────┘
 │  OpenAI · Anthropic         │
 └─────────────────────────────┘
```

- The runtime listens only on `127.0.0.1` with a per-start bearer token. In the desktop app, the Rust supervisor launches the runtime, reads its token, and proxies every request over Tauri IPC, so the token never reaches the webview.
- The web app never connects to your computer. A paired runtime calls out to the web app over HTTPS with its own device token. Commands from the web are queued, and your computer runs them only if you turn on **Allow control from the web** on that computer. It is off by default.
- Coding-agent CLIs (`codex`, `claude`, `muse`) are never run on Vercel.

## Requirements

- macOS 12+ (Apple Silicon or Intel) for the desktop app
- Node.js **22.13+** (the runtime uses the built-in `node:sqlite`) and pnpm 10
- Git
- For coding agents, at least one signed-in CLI:
  - Codex: `npm install -g @openai/codex`, then `codex login`
  - Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`, then run `claude` and sign in
  - Muse Code: `curl -fsSL https://dev.meta.ai/install.sh | sh`, then run `muse` and sign in (or set `META_API_KEY`)
- For model chats: an OpenAI and/or Anthropic **API key**. A ChatGPT or Claude subscription does not include API access; API usage is billed separately by each provider.
- To build the desktop app: Rust (stable, via [rustup](https://rustup.rs)) and Xcode Command Line Tools (`xcode-select --install`)

## Desktop app

### Install from source

```sh
git clone https://github.com/faizm10/agentic-hub.git
cd agentic-hub
pnpm install
pnpm build
pnpm --filter @agentic-hub/desktop tauri:build
```

This produces:

- `apps/desktop/src-tauri/target/release/bundle/macos/Agentic Hub.app`
- `apps/desktop/src-tauri/target/release/bundle/dmg/Agentic Hub_0.2.0_aarch64.dmg` (or `_x64` on Intel)

Open the DMG and drag **Agentic Hub** to Applications. Local builds are not signed, so on first launch right-click the app and choose **Open** (or run `xattr -dr com.apple.quarantine "/Applications/Agentic Hub.app"`). For signed and notarized builds, see [docs/DESKTOP_RELEASE.md](docs/DESKTOP_RELEASE.md).

For a universal (Apple Silicon + Intel) build: `rustup target add x86_64-apple-darwin aarch64-apple-darwin` then `pnpm --filter @agentic-hub/desktop tauri build --target universal-apple-darwin`.

### What happens when it runs

1. The app finds Node.js 22.13+ through your login shell's `PATH` (so Homebrew, nvm, Volta and `~/.local/bin` installs work when launched from Finder). Set `AGENTIC_HUB_NODE` to override.
2. It starts the bundled runtime on a random loopback port with its data in `~/Library/Application Support/dev.agentichub.desktop/runtime` (owner-only files: encrypted SQLite database, its key, a lock and the per-start token).
3. If the runtime crashes it is restarted with backoff; the UI shows the state and a Retry button. Quitting the app stops the runtime gracefully (SIGTERM, then SIGKILL after 5 s).
4. The first-run screen checks the runtime and providers, then asks you to open a repository.

### Using it

- **New chat** (⌘N): pick an agent or model and, if supported, a model. Suggestions fill the composer.
- Coding agents ask for approval before commands and file changes. Approve or deny inline; nothing is auto-approved.
- The review panel (⌘J) shows changed files and diffs from `git diff HEAD`, plus agent activity.
- **Settings → Providers**: CLI sign-in status with install/sign-in commands, model lists, and API key entry for OpenAI and Anthropic. Keys are verified with the provider before they're saved, stored encrypted by the runtime, and never shown again.
- **Settings → Web access**: pair this computer with your web account (see below).
- Keyboard: ⌘K palette · ⌘N new chat · ⌘O open repository · ⌘B sidebar · ⌘J review panel · ⌘⇧D full diff · ⌘. stop · ⌘1–5 pick agent · ⌘Y all chats · ⌘, settings.

## Development

```sh
pnpm install
pnpm build                       # builds the workspace packages

# Desktop UI in a browser, against a runtime you start yourself:
pnpm runtime:start               # terminal 1: runtime on 127.0.0.1:43117, data in ~/.agentic-hub
pnpm dev:desktop                 # terminal 2: http://localhost:1420 (Vite bridges /runtime with the token)

# Native window with the supervised runtime (needs Rust):
pnpm --filter @agentic-hub/desktop tauri:dev

# Web app (needs Postgres and an encryption key; see apps/web/.env.example):
cp apps/web/.env.example apps/web/.env.local   # then fill it in
pnpm dev:web                     # http://localhost:3200
```

Checks:

```sh
pnpm check                       # typecheck + lint + tests + production builds, all packages
cd apps/desktop/src-tauri && cargo test   # Rust supervisor and bridge tests
```

The runtime refuses to start if another runtime is using the same data directory. `AGENTIC_HUB_DATA_DIR` and `AGENTIC_HUB_PORT` change where it stores data and which port it uses (see `apps/runtime/.env.example`).

## Deploying the web app to Vercel

The web app lives in `apps/web` and builds with Turborepo from the monorepo root.

1. **Import the repository** in Vercel (New Project → import `faizm10/agentic-hub`).
2. Set **Root Directory** to `apps/web`. Framework, install and build commands come from `apps/web/vercel.json` (`pnpm install` and `pnpm turbo run build --filter=@agentic-hub/web` from the repository root). Keep the Node.js version at 22 or later.
3. **Add a database**: Project → Storage → Marketplace → **Neon** (Postgres). This sets `DATABASE_URL`. Any Postgres 14+ works; use a pooled connection string. Tables are created automatically on first request.
4. **Add environment variables** (Production and Preview):
   - `AGENTIC_HUB_ENCRYPTION_KEY`: output of `openssl rand -base64 32`. It encrypts API keys, chat content and synced device data at rest. Back it up; losing it makes that data unreadable.
   - Optional `AGENTIC_HUB_ALLOWED_EMAILS`: comma-separated emails or `@domain`s allowed to sign up. Leave empty to allow anyone.
5. **Deploy**, then open `https://<your-app>/api/health`. It should return `{"ok":true}`; otherwise it lists what's missing.
6. Sign up, add an OpenAI or Anthropic key under **Providers**, and chat.

With the Vercel CLI instead: `vercel link` (root directory `apps/web`), `vercel env add AGENTIC_HUB_ENCRYPTION_KEY`, `vercel integration add neon`, `vercel deploy --prod`.

### Pairing your computer with the web app

1. Web app → account menu → **Devices** → **Create pairing code** (single use, expires in 10 minutes).
2. Desktop app → **Settings → Web access** → enter the web address (`https://…`) and the code.
3. The computer appears as **Online**. Its projects and sessions show up in the web sidebar, and new events sync every 2 s while you're watching (15 s otherwise).
4. To start chats, send messages, stop runs or answer approvals from the web, turn on **Allow control from the web** on that computer. Remove a computer from **Devices** to revoke its token immediately.

Large tool outputs are truncated in the web copy (the full output stays on your computer), and file diffs are only available in the desktop app.

## Security model

- **Secrets stay server-side.** The browser never receives an API key or a runtime token. Web API keys are decrypted only inside the route handler that calls the provider.
- **Encryption at rest.** Desktop: AES-256-GCM over all session, event, approval and credential payloads in SQLite, with an owner-only key file. Web: AES-256-GCM (`AGENTIC_HUB_ENCRYPTION_KEY`) over API keys, chat titles and events, device snapshots, synced events and commands.
- **Accounts.** scrypt password hashes; random session tokens stored as SHA-256 hashes in HttpOnly, SameSite=Lax cookies (Secure in production); same-origin checks on every mutation; Postgres-backed rate limits on sign-up, sign-in and pairing.
- **Devices.** Pairing codes are single use, expire in 10 minutes and are stored hashed. Device tokens are 256-bit, stored hashed and revocable. The runtime only accepts HTTPS control planes (HTTP only for localhost) and never listens on a public interface.
- **Approvals.** Claude Code runs in `default` permission mode, so tool use goes through approvals; Codex and Muse forward their approval requests; unknown requests fail closed. Muse choices are matched to the server's offered options, preferring one-time grants.
- **Redaction.** Common API key and bearer token formats are redacted from stored prompts and events (best effort; avoid pasting credentials into prompts).

## Provider support

| Provider | Integration | Auth | Models | Streaming | Approvals | Cancel |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | App Server (`codex app-server`, JSON-RPC over stdio) | `codex login` | `model/list` | text and reasoning deltas | commands, file changes | `turn/interrupt` |
| Claude Code | Claude Agent SDK (`query`, user's `claude` binary) | `claude` sign-in | `supportedModels()` | partial messages | `canUseTool` | abort |
| Muse Code | `@muse-code/sdk` over `muse serve` (Muse Session Protocol) | `muse` sign-in or `META_API_KEY` | `model/list` | item deltas | server-offered choices | `turn/interrupt` |
| OpenAI | Official `openai` SDK, Responses API | API key | `models.list` (chat models) | text and reasoning summaries | n/a | abort |
| Anthropic | Official `@anthropic-ai/sdk`, Messages API | API key | `models.list` | text and thinking | n/a | abort |

## More documentation

- [docs/API_CONTRACT.md](docs/API_CONTRACT.md): local runtime HTTP API
- [docs/CONTROL_PLANE.md](docs/CONTROL_PLANE.md): device pairing and sync protocol
- [docs/DESKTOP_RELEASE.md](docs/DESKTOP_RELEASE.md): signing, notarization and releases
- [apps/README.md](apps/README.md): frontend architecture and design system
