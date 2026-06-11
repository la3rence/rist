# Rist

A quiet cross-platform Redis desktop client built with Electron, React, TypeScript, ioredis, and ssh2.

## Product Direction

- Single-node and Redis Cluster connections.
- Optional SSH Tunnel for private Redis instances.
- Non-blocking key browsing with `SCAN` instead of `KEYS`.
- Preview for strings, hashes, lists, sets, sorted sets, and streams.
- Basic create, update, delete, and refresh flows.
- Minimal UI with dense navigation, quiet colors, and production-safe confirmations.

## Scripts

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

## Architecture

- `src/main`: Electron main process, Redis connections, SSH tunnel lifecycle, IPC handlers.
- `src/preload`: Safe renderer bridge exposed as `window.redisGui`.
- `src/renderer`: React UI for connections, key browsing, and value preview.
- `src/shared`: Shared TypeScript contracts between processes.

## Notes

Saved connection profiles are stored locally and encrypted with Electron `safeStorage` when available.

### macOS signing without Apple Developer ID

On macOS, `safeStorage` creates a `Rist Safe Store` item in Keychain. Pure ad-hoc signatures can make macOS ask for the login keychain password after every update because each build looks like a different app to Keychain.

Without an Apple Developer ID, keep using the same self-signed code-signing certificate for every macOS build:

```bash
pnpm mac:make-cert
```

Then add these GitHub Actions secrets:

- `MAC_CODESIGN_CERT_BASE64`: contents of `release/codesign/rist-local-codesign.p12.base64.txt`
- `MAC_CODESIGN_CERT_PASSWORD`: the `.p12` password
- `MAC_CODESIGN_CERT_NAME`: `Rist Local Code Signing`

For a local signed build:

```bash
CSC_LINK="file://$PWD/release/codesign/rist-local-codesign.p12" \
CSC_KEY_PASSWORD="<password>" \
CSC_NAME="Rist Local Code Signing" \
pnpm dist:mac
```

The first upgrade from an ad-hoc build to the self-signed build may still ask once, or require deleting the old `Rist Safe Store` item from Keychain. Subsequent builds should keep a stable signing identity as long as the same `.p12` is reused.

For macOS users, try the command below to skip Gatekeeper for unsigned builds.

```sh
xattr -dr com.apple.quarantine /path/to/Rist.app
```

Or open the app and go to System Settings - Privacy & Security - Open Anyway.
This is an Open Souce app. Feel free to check the source code.
