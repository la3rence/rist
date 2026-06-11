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

For macOS user, please try to execute below command to skip GateKeeper.

```sh
xattr -dr com.apple.quarantine /path/to/Rist.app
```

Or open the app and go to System Settings - Privacy & Security - Open Anyway.
This is an Open Souce app. Feel free to check the source code.
