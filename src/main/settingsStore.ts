import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { LOCAL_PROVIDER_VARIABLE } from "../shared/agent/providers";
import type { SettingsState } from "../shared/agent/types";

/**
 * Persists provider API keys (encrypted at rest via Electron safeStorage) and
 * the active model selection. Keys are kept on disk as base64 ciphertext and
 * are only ever decrypted in-process to (a) inject into process.env for the
 * Mastra model router and (b) never leave the main process.
 */

interface PersistedShape {
  /** envVar -> base64 ciphertext (or base64 plaintext when secure store is absent). */
  keys: Record<string, string>;
  /** Whether `keys` values are encrypted (safeStorage available at write time). */
  encrypted: boolean;
  activeModel: string | null;
}

const emptyState: PersistedShape = { keys: {}, encrypted: false, activeModel: null };

let cache: PersistedShape | null = null;

const filePath = (): string => join(app.getPath("userData"), "relay-settings.json");

const load = (): PersistedShape => {
  if (cache) {
    return cache;
  }
  try {
    const raw = readFileSync(filePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    cache = {
      keys: parsed.keys ?? {},
      encrypted: parsed.encrypted ?? false,
      activeModel: parsed.activeModel ?? null
    };
  } catch {
    cache = { ...emptyState };
  }
  return cache;
};

const persist = (state: PersistedShape): void => {
  cache = state;
  const path = filePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
};

const encrypt = (value: string): { cipher: string; encrypted: boolean } => {
  if (safeStorage.isEncryptionAvailable()) {
    return { cipher: safeStorage.encryptString(value).toString("base64"), encrypted: true };
  }
  // Fallback: store base64 plaintext so the app still works on platforms
  // without an OS keychain. Marked so we never try to decrypt it.
  return { cipher: Buffer.from(value, "utf8").toString("base64"), encrypted: false };
};

const decrypt = (cipher: string, encrypted: boolean): string | null => {
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

export const getSettingsState = (): SettingsState => {
  const state = load();
  return {
    configuredKeys: Object.keys(state.keys),
    activeModel: state.activeModel,
    secureStorageAvailable: safeStorage.isEncryptionAvailable()
  };
};

export const setProviderKey = (envVar: string, key: string): SettingsState => {
  if (envVar === LOCAL_PROVIDER_VARIABLE) {
    return getSettingsState();
  }
  const state = load();
  const trimmed = key.trim();
  if (!trimmed) {
    return deleteProviderKey(envVar);
  }
  const { cipher, encrypted } = encrypt(trimmed);
  // If the store already holds keys at a different encryption level, keep them
  // consistent: a single `encrypted` flag covers the whole file.
  const next: PersistedShape = {
    ...state,
    keys: { ...state.keys, [envVar]: cipher },
    encrypted: Object.keys(state.keys).length === 0 ? encrypted : state.encrypted
  };
  persist(next);
  applyKeysToEnv();
  return getSettingsState();
};

export const deleteProviderKey = (envVar: string): SettingsState => {
  const state = load();
  const nextKeys = { ...state.keys };
  delete nextKeys[envVar];
  persist({ ...state, keys: nextKeys });
  delete process.env[envVar];
  return getSettingsState();
};

export const setActiveModel = (model: string | null): SettingsState => {
  const state = load();
  persist({ ...state, activeModel: model });
  return getSettingsState();
};

/** Push every stored key into process.env so the Mastra router can read it. */
export const applyKeysToEnv = (): void => {
  const state = load();
  for (const [envVar, cipher] of Object.entries(state.keys)) {
    const value = decrypt(cipher, state.encrypted);
    if (value) {
      process.env[envVar] = value;
    }
  }
};
