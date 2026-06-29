<p align="center">
  <img src="logo.png" alt="Relay" width="96" height="96" />
</p>

<h1 align="center">Relay</h1>

<p align="center">
  An open-source, dark-mode desktop coding agent — built for people who want to use
  <strong>non-mainstream LLM providers</strong>, not just the big three.
</p>

---

Relay is an Electron app that puts DeepSeek, Qwen, GLM, Kimi, MiniMax, and other
open/Chinese models on equal footing with the usual suspects. Bring your own API key
(or run locally via Ollama), pick a model, and work in either a **Chat** workspace or
a full **Code** workspace with real file editing, command execution, and
human-in-the-loop permissions.

## ⚠️ Project status — early beta (expect rough edges)

**Relay is an early public beta (think alpha/0.1).** It already does a lot and is
usable day to day, but it is *not* polished production software yet — you should
expect bugs, half-finished corners, the occasional crash, and provider quirks
(rate limits, model-specific errors, auth gotchas across the many supported
providers). That's normal for software this young.

**This is being shared openly precisely so we can fix those things together.** If
you hit an error, please [open an issue](https://github.com/LeventeNagy/relay-coding-agent/issues)
with what you did, which provider/model you used, and the error text or a
screenshot — that's the single most helpful thing you can do. Bug reports, fixes,
and ideas are all genuinely welcome; with more eyes on it we can squash these
issues much faster than I can alone. See [CONTRIBUTING.md](CONTRIBUTING.md).

Known in-progress areas: signed installers / auto-update, broader automated test
coverage, and additional renderer hardening. Your API keys are **not** affected by
any of this — they're encrypted on your own machine and never leave it (see the
security model below).

📣 **Follow [@_levyathan_](https://x.com/_levyathan_) on Twitter/X** for updates,
progress, and release notes.

## Highlights

- **Many providers, one router.** DeepSeek, Alibaba/Qwen (DashScope + coding/token
  plans), Z.AI / GLM, Moonshot / Kimi (global + China), MiniMax, SiliconFlow, Tencent,
  Xiaomi, OpenRouter, and Ollama Cloud — via the Mastra model router. Add a key in
  Settings and its models appear in the picker.
- **Chat workspace.** Streaming replies, reasoning ("thinking") controls where the
  model supports them, image/document attachments, and web **search** + deep
  **research** (Tavily / Brave / DuckDuckGo, key optional).
- **Code workspace.** Projects live in real folders. The agent reads, writes, and edits
  files and runs commands **scoped to the project**, with permission modes
  (Ask / Approve / Full). **Plan mode** asks clarifying questions and proposes a plan
  before touching anything. **Sources** (your design docs + framework docs) are kept in
  the agent's context every turn so it never loses the plot, and new projects default
  to a **Next.js + shadcn/ui** stack the agent scaffolds and keeps current.
- **Plugins (MCP).** Connect Model Context Protocol servers — Notion and Linear via
  one-click OAuth; GitHub, Filesystem, Git, Supabase (OAuth), Convex, Postgres, and
  more. Plugins are chosen per conversation and filtered by workspace.
- **Skills.** Reusable instruction packs the agent can pull in on demand.
- **Parallel sessions.** Start a run in one session and switch away — it keeps
  streaming and saving in the background, with a "working" indicator.
- **Context management.** Per-model context windows, automatic compaction of older
  turns, and a live usage meter.

## Security model (short version)

- API keys, plugin credentials, OAuth tokens, and search keys are encrypted at rest
  with Electron `safeStorage` in the app's userData directory.
- Decrypted secrets never leave the main process — the renderer only ever sees key
  *names* and connection status.
- File and command tools are confined to the active project folder; writes and shell
  commands are gated by the permission mode (path traversal is blocked unless you grant
  Full access).
- The renderer runs with `contextIsolation` and no Node integration; links open in your
  real browser, never an in-app window.

See [SECURITY.md](SECURITY.md) for the full threat model and how to report issues.

## Getting started

Prerequisites: **Node.js ≥ 20** and **Corepack** (bundled with Node). Local (stdio) MCP
plugins like Filesystem/Git also need `npx` on your PATH.

```bash
corepack pnpm install     # install dependencies (pnpm 11)
corepack pnpm dev         # run the app in development
corepack pnpm build       # typecheck + production build into out/
```

Then open **Settings**, add an API key for any supported provider, and pick a model.

## Tech stack

Electron · electron-vite (Vite) · React 19 · TypeScript · [Mastra](https://mastra.ai)
(`@mastra/core` model router + `@mastra/mcp`).

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Run
`corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test` before opening a
PR.

## License

[MIT](LICENSE) © Levente Nagy
