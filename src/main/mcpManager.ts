import { MCPClient } from "@mastra/mcp";
import type {
  PluginServerConfig,
  PluginProbeResult,
  PluginStatus,
  PluginSummary
} from "../shared/plugins/types";
import { enabledServers, listServers } from "./mcpStore";

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
    servers.map((s) => ({ id: s.id, command: s.command, args: s.args, env: s.env }))
  );

/** Convert our config to a Mastra stdio server definition. */
const toServerDef = (config: PluginServerConfig) => ({
  command: config.command,
  args: config.args,
  env: config.env
});

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
      servers: Object.fromEntries(servers.map((s) => [s.id, toServerDef(s)]))
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
    servers: { [config.id]: toServerDef(config) },
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
    return {
      id: server.id,
      catalogId: server.catalogId,
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args,
      envKeys: Object.keys(server.env),
      enabled: server.enabled,
      status: status.status,
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
