/**
 * Plugin = an MCP server Relay connects to. Its tools are injected into the
 * agent at run time (see mcpManager.getActiveToolsets). For now only local
 * `stdio` servers are supported; the union leaves room for `http` later.
 */
export type PluginTransport = "stdio";

/** Connection status, derived from the last connect/probe attempt. */
export type PluginStatus = "idle" | "connected" | "error";

/** Full server config as persisted in the main process (env may hold secrets). */
export interface PluginServerConfig {
  id: string;
  /** Catalog entry this was added from, if any (custom servers have none). */
  catalogId?: string;
  name: string;
  transport: PluginTransport;
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
  command: string;
  args: string[];
  /** Names of configured env vars (values withheld from the renderer). */
  envKeys: string[];
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
  command: string;
  args: string[];
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

/** Payload the renderer sends to add/update a server (env values included). */
export interface PluginInput {
  id?: string;
  catalogId?: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}
