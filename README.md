# Agentic Hub

One app for your AI coding agents. Run **Claude Code**, **Codex** and **Muse Code** on your own repositories, chat with **OpenAI** and **Anthropic** models, and watch everything happen live: replies, file changes, diffs and approvals.

## Live

| What | Where |
| --- | --- |
| Website | **https://agentic-hub-nu.vercel.app** |
| Mac app download | **https://github.com/faizm10/agentic-hub/releases/latest** |
| Website health check | https://agentic-hub-nu.vercel.app/api/health |

## Get started (Mac)

1. **Download** the latest `.dmg` from [Releases](https://github.com/faizm10/agentic-hub/releases/latest), open it, and drag **Agentic Hub** into Applications.
2. **Open the app.** If macOS warns you, right-click the app and choose **Open**.
3. **Follow the setup screen.** It checks what's installed and shows the exact command for anything missing:
   - Node.js 22.13 or newer: `brew install node`
   - Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`, then run `claude` once to sign in
   - Codex: `npm install -g @openai/codex`, then `codex login`
   - Optional: GitHub (`brew install gh`, then `gh auth login --web`) and Vercel (`npm i -g vercel`, then `vercel login`)
4. **Pick a repository.** Clone one from GitHub or choose a folder on your Mac.
5. **Type a task and press Enter.**

The app updates itself. When a new version is out you'll see **Update available** in the sidebar.

## What you can do

- **Run agents on your code.** Agents ask before running commands or editing files. Risky actions (deleting files, pushing, deploying, secrets) always ask.
- **Run several agents at once.** Turn on **Multi** in a new chat, pick agents, and compare their answers side by side.
- **Keep your code safe.** Turn on **Worktree** and each agent works on its own branch.
- **Queue messages.** Send follow-ups while an agent is still replying; they go out in order.
- **Edit and run code.** **Code** (⌘E) has a file explorer, an editor and a terminal.
- **Track usage.** **Usage** shows tokens per provider and model, and the cost Claude Code reports.
- **Use GitHub and Vercel.** Commit, push, open and review pull requests, deploy, and read build logs.

## Use it from the website

1. Sign in at **https://agentic-hub-nu.vercel.app**.
2. Chat with OpenAI or Anthropic right away: add your API key under **Providers**.
3. To use your Mac's agents from the web: on the website open **Devices → Create pairing code**, then in the Mac app go to **Settings → Web access** and enter the code.
4. In the Mac app, turn on **Allow control from the web**. Your Mac must be on and the app open.

## Keyboard shortcuts

⌘K command palette · ⌘N new chat · ⌘E code · ⌘` terminal · ⌘O open repository · ⌘. stop · ⌘, settings

## For developers

```sh
pnpm install
pnpm build
pnpm runtime:start     # terminal 1: local runtime
pnpm dev:desktop       # terminal 2: app UI at http://localhost:1420
pnpm check             # typecheck, lint, tests and builds
```

To ship a new version: `node scripts/version.mjs set 0.4.0`, open a PR, merge it. The Mac release builds and publishes itself.

More detail:

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): architecture, building from source, deploying the website, security
- [docs/DESKTOP_RELEASE.md](docs/DESKTOP_RELEASE.md): releases, signing and auto-updates
- [docs/API_CONTRACT.md](docs/API_CONTRACT.md): local runtime API
- [SETUP.md](SETUP.md): accounts and secrets checklist
