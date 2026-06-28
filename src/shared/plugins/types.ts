/**
 * Plugin = an MCP server Relay connects to. Its tools are injected into the
 * agent at run time (see mcpManager.getToolsetsFor). `stdio` servers are
 * local subprocesses; `http` servers are remote endpoints (with OAuth or a
 * bearer token).
 */
export type PluginTransport = "stdio" | "http";

/** How a server authenticates: OAuth browser flow, an API key, or nothing. */
export type PluginAuth = "oauth" | "key" | "none";

/**
 * Which workspace mode(s) a plugin is offered in. Chat-eligible plugins appear
 * in the chat composer's "+" menu; `code`-only ones (local-repo dev tools like
 * GitHub) are hidden from chat and reserved for the future code mode. Defaults
 * to "both" when omitted.
 */
export type PluginScope = "chat" | "code" | "both";

/** Connection status, derived from the last connect/probe attempt. */
export type PluginStatus = "idle" | "connected" | "error";

/** Full server config as persisted in the main process (env may hold secrets). */
export interface PluginServerConfig {
  id: string;
  /** Catalog entry this was added from, if any (custom servers have none). */
  catalogId?: string;
  name: string;
  transport: PluginTransport;
  /** How this server authenticates (drives the connect UX). */
  auth?: PluginAuth;
  /** Remote endpoint for `http` transport. */
  url?: string;
  /** Which workspace mode(s) this plugin is offered in (defaults to "both"). */
  scope?: PluginScope;
  /** Command/args for `stdio` transport (empty for `http`). */
  command: string;
  args: string[];
  /** Environment variables for the subprocess (tokens etc.). Encrypted at rest. */
  env: Record<string, string>;
  enabled: boolean;
}

/**
 * Renderer-safe view of a configured plugin. Never carries env *values* — only
 * the key names so the UI can show which secrets are set — plus live status.
 */
export interface PluginSummary {
  id: string;
  catalogId?: string;
  name: string;
  transport: PluginTransport;
  auth?: PluginAuth;
  /** Which workspace mode(s) this plugin is offered in (defaults to "both"). */
  scope?: PluginScope;
  command: string;
  args: string[];
  /** Names of configured env vars (values withheld from the renderer). */
  envKeys: string[];
  /** For OAuth servers: whether valid tokens are stored (Connected vs Connect). */
  authed?: boolean;
  enabled: boolean;
  status: PluginStatus;
  toolCount: number;
  /** Last connection error, if status is "error". */
  error?: string;
}

/** A hint for an env var a catalog entry needs (rendered as a form field). */
export interface PluginEnvHint {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

/** A curated, installable MCP server shown in the marketplace. */
export interface PluginCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  /** True for the small "Featured" rail at the top of the marketplace. */
  featured?: boolean;
  /** Defaults to "stdio" when omitted. */
  transport?: PluginTransport;
  /** How to authenticate; defaults to "key" if envHints present, else "none". */
  auth?: PluginAuth;
  /** Remote endpoint for `http`/OAuth servers. */
  url?: string;
  /** Which workspace mode(s) this plugin is offered in (defaults to "both"). */
  scope?: PluginScope;
  /** Deep-link to where the user creates an API key (for `key` servers). */
  keyUrl?: string;
  /** Command for `stdio` servers (optional for `http`). */
  command?: string;
  args?: string[];
  envHints?: PluginEnvHint[];
  /**
   * Args the user must fill before the server is usable (e.g. a directory path
   * for the filesystem server). Rendered as text inputs appended to `args`.
   */
  argHints?: Array<{ label: string; placeholder?: string }>;
}

/** Result of test-connecting to a server (used by Add + status refresh). */
export interface PluginProbeResult {
  ok: boolean;
  tools: string[];
  error?: string;
}

/** Returned by `plugins:connect`: the attempt result plus refreshed summaries. */
export interface PluginConnectResult {
  result: PluginProbeResult;
  plugins: PluginSummary[];
}

/** Payload the renderer sends to add/update a server (env values included). */
export interface PluginInput {
  id?: string;
  catalogId?: string;
  name: string;
  transport?: PluginTransport;
  auth?: PluginAuth;
  url?: string;
  scope?: PluginScope;
  command: string;
  args: string[];
  env: Record<string, string>;
}
