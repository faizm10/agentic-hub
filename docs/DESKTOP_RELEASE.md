# Desktop release: signing and notarization (macOS)

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

Bump the version in `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml` and `apps/desktop/package.json` together. The runtime reports its own version (`RUNTIME_VERSION` in `apps/runtime/src/control-plane.ts`).

## Notes

- The app bundles the runtime as a single JavaScript file (`Contents/Resources/runtime/agentic-hub-runtime.mjs`) and runs it with the user's Node.js 22.13+. Users without Node.js see a clear message with a Retry button.
- Auto-update is not configured. To add it, use the Tauri updater plugin with your own signing key and a hosted update manifest.
