import { MCPClient } from "@mastra/mcp";
import type {
  PluginServerConfig,
  PluginProbeResult,
  PluginStatus,
  PluginSummary
} from "../shared/plugins/types";
import { enabledServers, listServers } from "./mcpStore";
import { authorize, buildOAuthProvider, clearTokens, hasTokens } from "./mcpOAuth";

/**
 * Owns live MCPClient connections in the main process. Builds one cached client
 * for all *enabled* servers and hands their tools to the agent as namespaced
 * toolsets (Mastra's per-run `{ toolsets }` injection). The cache is keyed by a
 * hash of the enabled config so we only re-spawn the underlying stdio processes
 * when the configuration actually changes.
 */

type Toolsets = Awaited<ReturnType<MCPClient["listToolsets"]>>;

interface StatusEntry {
  status: PluginStatus;
  toolCount: number;
  error?: string;
}

let activeClient: MCPClient | null = null;
let activeKey = "";
const statusById = new Map<string, StatusEntry>();

/** Stable signature of the enabled servers; changes when any field changes. */
const configKey = (servers: PluginServerConfig[]): string =>
  JSON.stringify(
    servers.map((s) => ({
      id: s.id,
      transport: s.transport,
      url: s.url,
      command: s.command,
      args: s.args,
      env: s.env,
      // OAuth servers rebuild once tokens appear (provider gains credentials).
      authed: s.transport === "http" && s.auth === "oauth" ? hasTokens(s.id) : undefined
    }))
  );

/** Convert our config to a Mastra server definition (stdio subprocess or remote http). */
const toServerDef = (config: PluginServerConfig): Record<string, unknown> => {
  if (config.transport === "http" && config.url) {
    if (config.auth === "oauth") {
      return { url: new URL(config.url), authProvider: buildOAuthProvider(config.id) };
    }
    // http + static bearer token (stored under the conventional __bearer env key).
    const token = config.env.__bearer;
    return {
      url: new URL(config.url),
      ...(token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : {})
    };
  }
  return { command: config.command, args: config.args, env: config.env };
};

/**
 * Returns namespaced toolsets for all enabled servers, or undefined if none.
 * Reuses the cached client unless the enabled config changed. Also refreshes
 * per-server status so the UI can reflect connection results.
 */
export const getActiveToolsets = async (): Promise<Toolsets | undefined> => {
  const servers = enabledServers();
  if (servers.length === 0) {
    await dispose();
    return undefined;
  }

  const key = configKey(servers);
  if (!activeClient || key !== activeKey) {
    await dispose();
    activeClient = new MCPClient({
      id: "relay-active",
      servers: Object.fromEntries(servers.map((s) => [s.id, toServerDef(s)])) as never
    });
    activeKey = key;
  }

  try {
    const { toolsets, errors } = await activeClient.listToolsetsWithErrors();
    for (const server of servers) {
      const failure = errors?.[server.id];
      if (failure) {
        statusById.set(server.id, { status: "error", toolCount: 0, error: failure });
      } else {
        statusById.set(server.id, {
          status: "connected",
          toolCount: Object.keys(toolsets[server.id] ?? {}).length
        });
      }
    }
    return toolsets;
  } catch (error) {
    // A hard failure invalidates the client so the next run rebuilds it.
    await dispose();
    const message = error instanceof Error ? error.message : String(error);
    for (const server of servers) {
      statusById.set(server.id, { status: "error", toolCount: 0, error: message });
    }
    return undefined;
  }
};

/**
 * Test-connects to a single server config and reports its tools or an error.
 * Used by the Add form and manual status refresh. Always disconnects after.
 */
export const probeServer = async (config: PluginServerConfig): Promise<PluginProbeResult> => {
  const client = new MCPClient({
    id: `probe-${config.id}-${Date.now()}`,
    servers: { [config.id]: toServerDef(config) } as never,
    timeout: 30000
  });
  try {
    const { toolsets, errors } = await client.listToolsetsWithErrors();
    const failure = errors?.[config.id];
    if (failure) {
      statusById.set(config.id, { status: "error", toolCount: 0, error: failure });
      return { ok: false, tools: [], error: failure };
    }
    const tools = Object.keys(toolsets[config.id] ?? {});
    statusById.set(config.id, { status: "connected", toolCount: tools.length });
    return { ok: true, tools };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusById.set(config.id, { status: "error", toolCount: 0, error: message });
    return { ok: false, tools: [], error: message };
  } finally {
    await client.disconnect().catch(() => undefined);
  }
};

/**
 * Run the browser OAuth flow for a remote server, then probe it so the UI shows
 * its tools. Invalidates the active client so the next run rebuilds with the
 * now-authenticated provider. Never throws — failures (denial, timeout, a server
 * that doesn't support dynamic registration, network/TLS) are returned as an
 * error result and recorded as the server's status.
 */
export const connectOAuth = async (config: PluginServerConfig): Promise<PluginProbeResult> => {
  statusById.set(config.id, { status: "idle", toolCount: 0 });
  try {
    await authorize(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[relay] OAuth connect failed for ${config.name}:`, message);
    statusById.set(config.id, { status: "error", toolCount: 0, error: message });
    return { ok: false, tools: [], error: message };
  }
  await dispose(); // force the cached active client to rebuild with tokens
  return probeServer(config);
};

/**
 * Probe enabled servers once to populate live status after a restart (statuses
 * are in-memory). OAuth servers are skipped here — a probe could trigger the
 * auth redirect and pop the browser on launch; their status is derived from
 * stored tokens in listSummaries instead. Runs in parallel and never throws.
 */
export const refreshStatuses = async (): Promise<void> => {
  await Promise.all(
    enabledServers()
      .filter((server) => server.auth !== "oauth")
      .map((server) => probeServer(server).catch(() => undefined))
  );
};

/** Disconnect an OAuth server: forget its tokens and reset status. */
export const disconnectOAuth = (id: string): void => {
  clearTokens(id);
  statusById.set(id, { status: "idle", toolCount: 0 });
  void dispose();
};

/** Last-known status for a server (idle until first probe/connect). */
export const statusFor = (id: string): StatusEntry =>
  statusById.get(id) ?? { status: "idle", toolCount: 0 };

/**
 * Renderer-safe summaries: stored config + live status, with env *values*
 * stripped (only key names cross the IPC boundary).
 */
export const listSummaries = (): PluginSummary[] =>
  listServers().map((server) => {
    const status = statusFor(server.id);
    const authed = server.auth === "oauth" ? hasTokens(server.id) : undefined;
    // OAuth servers aren't probed at startup, so reflect their durable truth:
    // valid stored tokens = connected (live tool count fills in on first use).
    const effectiveStatus =
      status.status === "idle" && authed && server.enabled ? "connected" : status.status;
    return {
      id: server.id,
      catalogId: server.catalogId,
      name: server.name,
      transport: server.transport,
      auth: server.auth,
      command: server.command,
      args: server.args,
      envKeys: Object.keys(server.env).filter((k) => k !== "__bearer"),
      authed,
      enabled: server.enabled,
      status: effectiveStatus,
      toolCount: status.toolCount,
      error: status.error
    };
  });

/** Drop status entries for servers that no longer exist. */
export const pruneStatuses = (): void => {
  const ids = new Set(listServers().map((s) => s.id));
  for (const id of statusById.keys()) {
    if (!ids.has(id)) {
      statusById.delete(id);
    }
  }
};

/** Disconnect and forget the active client. Call on quit. */
export const dispose = async (): Promise<void> => {
  if (activeClient) {
    await activeClient.disconnect().catch(() => undefined);
    activeClient = null;
    activeKey = "";
  }
};
