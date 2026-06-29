# Contributing to Relay

Thanks for your interest in improving Relay! This is a young project, so issues, ideas,
and PRs are all welcome.

## Development setup

Prerequisites: **Node.js ≥ 20** and **Corepack** (ships with Node). Enable it with
`corepack enable` if you haven't.

```bash
corepack pnpm install   # install deps (pnpm 11, pinned via packageManager)
corepack pnpm dev       # launch the app with hot reload
```

The codebase is split into three Electron layers:

- `src/main` — main process: IPC handlers, the Mastra agent service, stores
  (settings, sessions, projects, plugins), and tools.
- `src/preload` — the `contextBridge` API exposed to the renderer.
- `src/renderer` — React UI (views, components, hooks).
- `src/shared` — types and pure logic shared across layers.

## Before opening a PR

Please make sure these pass locally:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

CI runs the same checks on every push and pull request.

## Guidelines

- **Match the surrounding code.** Follow the existing naming, comment density, and
  idioms of the file you're editing.
- **Keep secrets in the main process.** Never send decrypted API keys, tokens, or
  plugin credentials across the IPC boundary — the renderer only receives key names and
  status. New `ipcMain` handlers that accept renderer input should validate it.
- **Respect the file/command sandbox.** Code-mode tools are confined to the active
  project root; don't widen that without the permission flow.
- **Add a test** for pure logic where practical (see `*.test.ts` next to the modules in
  `src/shared` and `src/main`).
- **Don't bump `@mastra/*` casually.** It's pinned deliberately; upgrades need a manual
  check that it still externalizes and streams correctly.

## Reporting security issues

Please do **not** open a public issue for vulnerabilities — see [SECURITY.md](SECURITY.md).
