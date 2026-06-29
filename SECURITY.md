# Security Policy

## Reporting a vulnerability

Please report security issues **privately** rather than opening a public issue.
Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository, or email the maintainer. We'll acknowledge receipt and work with
you on a fix and disclosure timeline.

## Threat model & protections

Relay runs untrusted model output and connects to third-party providers and MCP
servers, so it is built around a few invariants:

- **Secrets stay in the main process.** API keys, plugin credentials, OAuth tokens, and
  web-search keys are encrypted at rest with Electron `safeStorage` in the app's
  userData directory. Decrypted values are only ever read in the main process and used
  to authenticate outbound requests. The renderer receives **key names and status
  only** — never secret values.

- **Renderer isolation.** The renderer runs with `contextIsolation: true` and
  `nodeIntegration: false`, and talks to the main process solely through the typed
  `contextBridge` API in `src/preload`. Links from chat/markdown open in the user's
  system browser; in-app popups and external-origin navigations are denied.

- **Scoped file & command tools.** In code mode the agent's `read_file` / `write_file`
  / `edit_file` / `run_command` tools are confined to the active project folder. Paths
  that resolve outside the root are rejected unless the user has explicitly granted
  **Full** access. Writes and shell commands are gated by the per-conversation
  permission mode (Ask / Approve / Full) via a human-in-the-loop approval prompt.

- **MCP plugins** run as the user configures them (local stdio subprocess or remote
  HTTP). Remote servers authenticate via OAuth or a stored bearer token; tokens are
  encrypted like other secrets and never sent to the renderer.

## Supported versions

Relay is pre-1.0; security fixes land on the latest `main`. Pin to a released commit if
you need stability.
