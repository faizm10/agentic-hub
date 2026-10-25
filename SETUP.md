# Setup checklist

What you need to provide to get everything live, and where each value goes. Nothing here should ever be committed: env values go in Vercel or local `.env` files (ignored by git).

## 1. Web app on Vercel — done

Live at **https://agentic-hub-nu.vercel.app** (health check: `/api/health`). Configured on 2026-10-25:

- Project `agentic-hub` on team **faizm10's projects**, root directory `apps/web`, Next.js, Node 24, connected to `github.com/faizm10/agentic-hub` (pushes to `main` deploy to production).
- **Neon Postgres** (`agentic-hub-db`) from the Marketplace, connected to Production, Preview and Development (sets `DATABASE_URL` and friends).
- `AGENTIC_HUB_ENCRYPTION_KEY`: generated and stored as a Secret (Production, Preview) and Config (Development). **Backup copy: `~/.agentic-hub-secrets/vercel-encryption-key.txt`** (owner-only). Move it into a password manager.
- `AGENTIC_HUB_ALLOWED_EMAILS=faizmustansar10@gmail.com` (Production, Preview): only you can sign up. Change with `vercel env update AGENTIC_HUB_ALLOWED_EMAILS production` from `apps/web`.

For reference, this is what it took (you don't need to redo it):

| What | Where to get it | Where it goes |
| --- | --- | --- |
| Vercel account | Already logged in on this Mac as `faizm10` (`vercel whoami`). Teams: `faizm10's projects`, `uoguelphcourses`. | Pick the team when linking the project. |
| Postgres database (`DATABASE_URL`) | Vercel → Project → Storage → Marketplace → **Neon** (free tier is fine). It sets `DATABASE_URL` automatically. Use the pooled connection string. | Vercel env vars (Production + Preview). |
| Encryption key (`AGENTIC_HUB_ENCRYPTION_KEY`) | Run `openssl rand -base64 32`. | Vercel env vars. **Back it up** (e.g. password manager). If it's lost, stored API keys, chats and synced device data can't be decrypted. Never change it after launch. |
| Sign-up allow-list (optional, `AGENTIC_HUB_ALLOWED_EMAILS`) | Your email(s) or `@yourdomain.com`, comma-separated. | Vercel env vars. Recommended for a public URL; empty means anyone can sign up. |

Steps (or ask Claude to run them with the Vercel CLI):

```sh
cd apps/web
vercel link                      # choose the team, create project "agentic-hub", root dir = apps/web
vercel integration add neon      # or add Neon from the dashboard
vercel env add AGENTIC_HUB_ENCRYPTION_KEY production   # paste the openssl output
vercel env add AGENTIC_HUB_ENCRYPTION_KEY preview
vercel deploy --prod
```

Then open `https://<your-app>.vercel.app/api/health`; it should return `{"ok":true}`.

## 2. Model API keys (to chat with OpenAI / Anthropic)

| What | Where to get it | Where it goes |
| --- | --- | --- |
| OpenAI API key | https://platform.openai.com/api-keys (needs API billing; a ChatGPT subscription doesn't include it) | In the app: **Providers** → OpenAI → paste. Desktop and web store it separately, both encrypted. |
| Anthropic API key | https://console.anthropic.com/settings/keys (needs API billing; a Claude subscription doesn't include it) | **Providers** → Anthropic → paste. |

Keys are verified with the provider before saving and never shown again. For the terminal runtime you can instead set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (see `apps/runtime/.env.example`).

## 3. Coding-agent CLIs (desktop only, no keys stored by Agentic Hub)

| Agent | Install | Sign in |
| --- | --- | --- |
| Codex | `npm install -g @openai/codex` | `codex login` (ChatGPT account or OpenAI key) — already signed in on this Mac |
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` | run `claude` — already signed in on this Mac |
| Muse Code | `curl -fsSL https://dev.meta.ai/install.sh \| sh` | run `muse` and sign in, or set `META_API_KEY` — **not installed yet** |

Then press **Re-check** in Providers.

## 4. Signed macOS app (only if you'll share the app with others)

Unsigned builds work on your own Mac (right-click → Open). To distribute:

| What | Where to get it |
| --- | --- |
| Apple Developer Program membership | https://developer.apple.com/programs ($99/yr) |
| Developer ID Application certificate | Xcode → Settings → Accounts → Manage Certificates → + |
| Notarization credentials | Either an App Store Connect API key (Issuer ID, Key ID, `.p8` file) **or** Apple ID + app-specific password (appleid.apple.com) + Team ID |

These become env vars at build time (`APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`/`APPLE_API_KEY`/`APPLE_API_KEY_PATH`, or `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID`). Full commands: [docs/DESKTOP_RELEASE.md](docs/DESKTOP_RELEASE.md).

## 5. Pair your Mac with the web app (after step 1)

1. Web app → account menu → **Devices** → **Create pairing code**.
2. Desktop app → **Settings → Web access** → web URL + code.
3. Optional: turn on **Allow control from the web** on that Mac.

## Already done on this Mac

- Vercel CLI 65.2.0 installed and logged in; Vercel plugin installed for Claude Code, Cursor, Codex, Copilot CLI and VS Code.
- Rust toolchain installed (`~/.cargo/bin`, not added to your shell profile; run `source ~/.cargo/env` or add it to `~/.zshrc` to use `cargo` yourself).
