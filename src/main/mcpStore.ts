import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PluginServerConfig } from "../shared/plugins/types";

/**
 * Persists configured MCP servers. The `env` map can hold secrets (API tokens),
 * so env *values* are encrypted at rest via Electron safeStorage exactly like
 * provider keys in settingsStore — same base64 ciphertext + single `encrypted`
 * flag, with a base64-plaintext fallback for platforms without an OS keychain.
 * Decrypted values never leave the main process.
 */

/** On-disk shape: same as PluginServerConfig but env values are ciphertext. */
interface StoredServer extends Omit<PluginServerConfig, "env"> {
  env: Record<string, string>;
}

interface PersistedShape {
  servers: StoredServer[];
  /** Whether env values across the file are encrypted (safeStorage available). */
  encrypted: boolean;
}

const emptyState: PersistedShape = { servers: [], encrypted: false };

let cache: PersistedShape | null = null;

const filePath = (): string => join(app.getPath("userData"), "relay-plugins.json");

const load = (): PersistedShape => {
  if (cache) {
    return cache;
  }
  try {
    const raw = readFileSync(filePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    cache = {
      servers: Array.isArray(parsed.servers) ? parsed.servers : [],
      encrypted: parsed.encrypted ?? false
    };
  } catch {
    cache = { servers: [], encrypted: false };
  }
  return cache;
};

const persist = (state: PersistedShape): void => {
  cache = state;
  const path = filePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
};

const encryptValue = (value: string): string => {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString("base64");
  }
  return Buffer.from(value, "utf8").toString("base64");
};

const decryptValue = (cipher: string, encrypted: boolean): string | null => {
  try {
    const buf = Buffer.from(cipher, "base64");
    if (encrypted) {
      if (!safeStorage.isEncryptionAvailable()) {
        return null;
      }
      return safeStorage.decryptString(buf);
    }
    return buf.toString("utf8");
  } catch {
    return null;
  }
};

const encryptEnv = (env: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = encryptValue(value);
  }
  return out;
};

const decryptEnv = (env: Record<string, string>, encrypted: boolean): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, cipher] of Object.entries(env)) {
    const value = decryptValue(cipher, encrypted);
    if (value !== null) {
      out[key] = value;
    }
  }
  return out;
};

/** Full configs with env DECRYPTED — for the manager only, never the renderer. */
export const listServers = (): PluginServerConfig[] => {
  const state = load();
  return state.servers.map((server) => ({
    ...server,
    env: decryptEnv(server.env, state.encrypted)
  }));
};

export const getServer = (id: string): PluginServerConfig | undefined =>
  listServers().find((server) => server.id === id);

/** Enabled servers only (what the agent should actually connect to). */
export const enabledServers = (): PluginServerConfig[] =>
  listServers().filter((server) => server.enabled);

/** Create or replace a server. Returns the decrypted config that was stored. */
export const upsertServer = (config: PluginServerConfig): PluginServerConfig => {
  const state = load();
  const stored: StoredServer = { ...config, env: encryptEnv(config.env) };
  const index = state.servers.findIndex((server) => server.id === config.id);
  const servers = [...state.servers];
  if (index >= 0) {
    servers[index] = stored;
  } else {
    servers.push(stored);
  }
  // The `encrypted` flag covers the whole file; lock it in on first write.
  const encrypted = state.servers.length === 0 ? safeStorage.isEncryptionAvailable() : state.encrypted;
  persist({ servers, encrypted });
  return config;
};

export const removeServer = (id: string): void => {
  const state = load();
  persist({ ...state, servers: state.servers.filter((server) => server.id !== id) });
};

export const setEnabled = (id: string, enabled: boolean): void => {
  const state = load();
  const servers = state.servers.map((server) => (server.id === id ? { ...server, enabled } : server));
  persist({ ...state, servers });
};
