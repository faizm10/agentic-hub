# Desktop releases, signed updates and notarization (macOS)

## How updates work

- The app checks `https://github.com/faizm10/agentic-hub/releases/latest/download/latest.json` 8 seconds after launch and every 6 hours (Tauri updater plugin). Users can also press **Settings → Updates → Check for updates**.
- When a newer version exists, the sidebar shows **Update available**. Clicking it downloads the bundle with a progress bar, then offers **Restart to update**, which stops the local runtime cleanly and relaunches.
- Every update bundle is signed with the updater key (minisign). The app verifies it against the public key compiled into `tauri.conf.json → plugins.updater.pubkey` and refuses anything unsigned or tampered with. Errors (offline, bad signature, read-only install location) are shown with what to do next.
- Release notes come from `docs/releases/<tag>.md` if it exists, otherwise from the commit list since the previous tag.

## One-time setup (repository owner)

1. **Updater signing key.** Already generated on the maintainer's Mac:
   - private key: `~/.agentic-hub-secrets/tauri-updater.key` (password in `tauri-updater.key.password`, same folder)
   - public key: `~/.agentic-hub-secrets/tauri-updater.key.pub`, already in `apps/desktop/src-tauri/tauri.conf.json`

   Back both up in a password manager. **If the private key is lost, installed apps can never auto-update again** (users would have to download a release with a new key manually). To rotate deliberately: `pnpm --filter @agentic-hub/desktop tauri signer generate -w <path>`, replace `pubkey`, and ship that release once by manual download.
2. **GitHub Actions secrets** (repository → Settings → Secrets and variables → Actions):

   | Secret | Value | Required |
   | --- | --- | --- |
   | `TAURI_SIGNING_PRIVATE_KEY` | contents of `tauri-updater.key` | yes; the release job stops without it |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | contents of `tauri-updater.key.password` | yes |
   | `APPLE_CERTIFICATE` | base64 of your Developer ID Application `.p12` (`base64 -i cert.p12 \| pbcopy`) | for Gatekeeper-clean installs |
   | `APPLE_CERTIFICATE_PASSWORD` | password of that `.p12` | with the certificate |
   | `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID1234)` | with the certificate |
   | `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8` | App Store Connect API key: issuer UUID, key ID, `.p8` file contents | for notarization |

   With the CLI: `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.agentic-hub-secrets/tauri-updater.key` and `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.agentic-hub-secrets/tauri-updater.key.password`.
3. **Actions permissions**: Settings → Actions → General → Workflow permissions → *Read and write* (the release job creates releases with `GITHUB_TOKEN`).

Without the Apple secrets, releases still update in place with verified signatures, but first-time installs show a Gatekeeper warning (right-click → Open).

## Cutting a release

```sh
node scripts/version.mjs set 0.4.0        # writes every version file (semver)
git commit -am "Release 0.4.0"
git tag v0.4.0 && git push origin main v0.4.0
```

`.github/workflows/release.yml` then: checks the tag matches every version file, runs `pnpm check`, builds a universal macOS app, signs the updater bundle, uploads it with `latest.json` to a **draft** release, verifies the manifest's version and per-platform signatures, and only then publishes the release. A failed step leaves at most a draft, so users are never offered a broken or unsigned update. Pre-release tags (`v0.4.0-beta.1`) are marked as pre-releases.

`node scripts/version.mjs check` runs in CI and fails if any version file disagrees.

---

# Signing and notarization (local builds)

Local builds (`pnpm --filter @agentic-hub/desktop tauri:build`) are ad-hoc signed and run on the machine that built them. To distribute the app to other Macs without Gatekeeper warnings, sign it with a Developer ID certificate and notarize it with Apple. **This needs your Apple Developer account; none of it is automated with credentials in this repository.**

## What you need

- An Apple Developer Program membership.
- A **Developer ID Application** certificate in your login keychain (Xcode → Settings → Accounts → Manage Certificates → +, or developer.apple.com → Certificates).
- For notarization, either:
  - an **App Store Connect API key** (recommended): Issuer ID, Key ID and the `.p8` file, or
  - your Apple ID, an **app-specific password** (appleid.apple.com → Sign-In and Security) and your Team ID.

## Build, sign and notarize

Find the signing identity:

```sh
security find-identity -v -p codesigning
# e.g. "Developer ID Application: Your Name (TEAMID1234)"
```

Then build with these environment variables set (Tauri signs, notarizes and staples automatically when they are present):

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID1234)"

# Option A: App Store Connect API key
export APPLE_API_ISSUER="<issuer-uuid>"
export APPLE_API_KEY="<key-id>"
export APPLE_API_KEY_PATH="$HOME/keys/AuthKey_<key-id>.p8"

# Option B: Apple ID
# export APPLE_ID="you@example.com"
# export APPLE_PASSWORD="<app-specific-password>"
# export APPLE_TEAM_ID="TEAMID1234"

pnpm install && pnpm build
pnpm --filter @agentic-hub/desktop tauri build --target universal-apple-darwin
```

The hardened runtime is enabled in `tauri.conf.json`. The app needs no extra entitlements: the runtime it launches is the user's own Node.js, which is already signed.

Verify the result:

```sh
APP="apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/macos/Agentic Hub.app"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose "$APP"
xcrun stapler validate "$APP"
```

## Versioning

Use `node scripts/version.mjs set X.Y.Z`. It updates `apps/desktop/package.json` (which `tauri.conf.json` reads), `apps/desktop/src-tauri/Cargo.toml`, the runtime and web package versions, and `RUNTIME_VERSION`. The version is shown in **Settings → Updates** and **Settings → About**.

Local signed builds that should produce update bundles also need `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the environment (`createUpdaterArtifacts` is on).

## Notes

- The app bundles the runtime as a single JavaScript file (`Contents/Resources/runtime/agentic-hub-runtime.mjs`) and runs it with the user's Node.js 22.13+. Users without Node.js see a clear message with a Retry button.
- In a browser preview (no installer), Settings falls back to checking the latest GitHub release and opening its page.
