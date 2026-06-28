import { app } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Persists per-session compaction state: a running `summary` of the oldest turns
 * plus `compactedCount` (how many leading messages that summary already covers).
 * Kept in its own file — separate from relay-sessions.json — so the renderer's
 * own session saves never clobber it. Plaintext, consistent with sessions.
 */

export interface CompactionState {
  summary: string;
  /** Number of leading messages folded into `summary` (messages are append-only). */
  compactedCount: number;
  updatedAt: string;
}

interface PersistedShape {
  contexts: Record<string, CompactionState>;
}

let cache: PersistedShape | null = null;

const filePath = (): string => join(app.getPath("userData"), "relay-context.json");

const load = (): PersistedShape => {
  if (cache) {
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath(), "utf8")) as Partial<PersistedShape>;
    cache = { contexts: parsed.contexts ?? {} };
  } catch {
    cache = { contexts: {} };
  }
  return cache;
};

const persist = (state: PersistedShape): void => {
  cache = state;
  const path = filePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
};

export const getCompaction = (sessionId: string): CompactionState | undefined =>
  load().contexts[sessionId];

export const setCompaction = (sessionId: string, state: Omit<CompactionState, "updatedAt">): void => {
  const current = load();
  persist({
    contexts: {
      ...current.contexts,
      [sessionId]: { ...state, updatedAt: new Date().toISOString() }
    }
  });
};

export const clearCompaction = (sessionId: string): void => {
  const current = load();
  if (!current.contexts[sessionId]) {
    return;
  }
  const next = { ...current.contexts };
  delete next[sessionId];
  persist({ contexts: next });
};
