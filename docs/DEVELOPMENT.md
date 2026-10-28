# Agentic Hub: developer guide

Everything the README leaves out: how the pieces fit, building from source, running checks, deploying the web app, pairing, security and provider details.

## Repository layout

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

Open the DMG and drag **Agentic Hub** to Applications. Local builds are not signed, so on first launch right-click the app and choose **Open** (or run `xattr -dr com.apple.quarantine "/Applications/Agentic Hub.app"`). For signed and notarized builds, see [docs/DESKTOP_RELEASE.md](DESKTOP_RELEASE.md).

For a universal (Apple Silicon + Intel) build: `rustup target add x86_64-apple-darwin aarch64-apple-darwin` then `pnpm --filter @agentic-hub/desktop tauri build --target universal-apple-darwin`.

### What happens when it runs

1. The app finds Node.js 22.13+ through your login shell's `PATH` (so Homebrew, nvm, Volta and `~/.local/bin` installs work when launched from Finder). Set `AGENTIC_HUB_NODE` to override.
2. It starts the bundled runtime on a random loopback port with its data in `~/Library/Application Support/dev.agentichub.desktop/runtime` (owner-only files: encrypted SQLite database, its key, a lock and the per-start token).
3. If the runtime crashes it is restarted with backoff; the UI shows the state and a Retry button. Quitting the app stops the runtime gracefully (SIGTERM, then SIGKILL after 5 s).
4. The first-run wizard detects Git, Node.js, Claude Code, Codex, the GitHub CLI and the Vercel CLI (with copyable install/sign-in commands), lets you clone a GitHub repository or pick a folder, and starts your first agent session.
5. Updates install in place: the app checks GitHub Releases on launch and every 6 hours, shows **Update available**, downloads with progress, verifies the signature, and restarts. See [docs/DESKTOP_RELEASE.md](DESKTOP_RELEASE.md).

### Using it

- **New chat** (⌘N): pick an agent or model and, if supported, a model. Suggestions fill the composer.
- Coding agents ask for approval before commands and file changes. Each request shows a risk level. **Settings → Approvals** can auto-approve low-risk requests (read-only tools, trusted commands such as `pnpm test`, optionally in-repo file edits); destructive commands, pushes, deploys, permission changes and secrets always ask.
- **Multi** toggle in the composer: pick several agents (for example Claude Code and Codex, or OpenAI and Anthropic) and run one prompt with all of them at once. Results stream side by side on the multi-agent board; a follow-up goes to every agent. Combine with **Worktree** so coding agents never edit the same checkout.
- **Message queue** for every agent and model: send follow-ups while a reply is still running and they're delivered in order (removable while queued). On the desktop the runtime holds the queue; on the web, paired computers queue on their side and web chats queue in the tab.
- **Usage** (sidebar): tokens per provider and model over 7/30/90 days, daily chart, cache share, and Claude Code's reported cost. Counts come from what each provider reports for every reply (Claude Code, Codex, OpenAI and Anthropic APIs); costs are never estimated from guessed prices. The web Usage page combines web chats with each paired computer's report.
- **Worktree** toggle in the composer (or the command palette): the agent works on a new `agentic/…` branch in its own Git worktree, so several agents can run on one repository without touching your checkout.
- **Code** (⌘E): file explorer, Monaco editor (⌘S saves), and a terminal plus activity feed (⌘\`). Files the active agent changes are marked live; the header shows what the agent is doing and when it needs you. Switch between the main checkout and session worktrees from the header.
- **GitHub & Vercel**: commit, push, open pull requests, review and merge, open issues, hand an issue or PR to an agent, list deployments, deploy previews or production, and read build logs (with "Fix with an agent" for failed builds). Uses your `gh` and `vercel` sign-ins; pushes, merges and deploys need an explicit confirmation that the runtime enforces.
- The review panel (⌘J) shows changed files and diffs from `git diff HEAD`, plus agent activity.
- **Settings → Providers**: CLI sign-in status with install/sign-in commands, model lists, and API key entry for OpenAI and Anthropic. Keys are verified with the provider before they're saved, stored encrypted by the runtime, and never shown again.
- **Settings → Web access**: pair this computer with your web account (see below).
- Keyboard: ⌘K palette · ⌘N new chat · ⌘O open repository · ⌘E code · ⌘\` terminal · ⌘B sidebar · ⌘J review panel · ⌘⇧D full diff · ⌘. stop · ⌘1–5 pick agent · ⌘Y all chats · ⌘, settings.

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

Checks (also run in CI by `.github/workflows/ci.yml`):

```sh
pnpm check                       # typecheck + lint + tests + production builds, all packages
pnpm version:check               # every version file agrees (semver)
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
5. With control on, the web matches the desktop for agent work: Codex, Claude Code and Muse on that computer (with the computer's model list), worktree isolation, multi-agent runs, the message queue, approvals and usage. Coding agents always run on your computer, never on Vercel, so that computer must be online. The file editor, terminal and GitHub/Vercel actions stay desktop-only.

Large tool outputs are truncated in the web copy (the full output stays on your computer), and file diffs are only available in the desktop app.

## Security model

- **Secrets stay server-side.** The browser never receives an API key or a runtime token. Web API keys are decrypted only inside the route handler that calls the provider.
- **Encryption at rest.** Desktop: AES-256-GCM over all session, event, approval and credential payloads in SQLite, with an owner-only key file. Web: AES-256-GCM (`AGENTIC_HUB_ENCRYPTION_KEY`) over API keys, chat titles and events, device snapshots, synced events and commands.
- **Accounts.** scrypt password hashes; random session tokens stored as SHA-256 hashes in HttpOnly, SameSite=Lax cookies (Secure in production); same-origin checks on every mutation; Postgres-backed rate limits on sign-up, sign-in and pairing.
- **Devices.** Pairing codes are single use, expire in 10 minutes and are stored hashed. Device tokens are 256-bit, stored hashed and revocable. The runtime only accepts HTTPS control planes (HTTP only for localhost) and never listens on a public interface.
- **Approvals.** Claude Code runs in `default` permission mode, so tool use goes through approvals; Codex and Muse forward their approval requests; unknown requests fail closed. Muse choices are matched to the server's offered options, preferring one-time grants. The runtime scores every request; nothing above low risk is ever auto-approved, and provider permission modes are never bypassed.
- **Workspace access.** File reads and writes are confined to the repository or session worktree (no `..`, absolute paths, escaping symlinks or `.git/`). Integration actions above low risk return `428 CONFIRMATION_REQUIRED` unless the request carries an explicit confirmation. Agentic Hub stores no GitHub or Vercel tokens; it calls the user's signed-in CLIs.
- **Updates.** Only bundles signed with the updater key are installed; the public key is compiled into the app.
- **Redaction.** Common API key and bearer token formats are redacted from stored prompts and events (best effort; avoid pasting credentials into prompts).

## Provider support

| Provider | Integration | Auth | Models | Streaming | Approvals | Cancel |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | App Server (`codex app-server`, JSON-RPC over stdio) | `codex login` | `model/list` | text and reasoning deltas | commands, file changes | `turn/interrupt` |
| Claude Code | Claude Agent SDK (`query`, user's `claude` binary) | `claude` sign-in | `supportedModels()` | partial messages | `canUseTool` | abort |
| Muse Code | `@muse-code/sdk` over `muse serve` (Muse Session Protocol) | `muse` sign-in or `META_API_KEY` | `model/list` | item deltas | server-offered choices | `turn/interrupt` |
| OpenAI | Official `openai` SDK, Responses API | API key | `models.list` (chat models) | text and reasoning summaries | n/a | abort |
| Anthropic | Official `@anthropic-ai/sdk`, Messages API | API key | `models.list` | text and thinking | n/a | abort |
