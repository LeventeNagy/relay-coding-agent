import { app } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ChatSession, SessionSummary, WorkspaceMode } from "../shared/agent/types";

/**
 * Persists chat sessions as a single JSON file under userData. Sessions are
 * created lazily by the renderer (only after the first message is sent), so
 * this store just upserts whatever it is handed.
 */

interface PersistedShape {
  sessions: Record<string, ChatSession>;
}

let cache: PersistedShape | null = null;

const filePath = (): string => join(app.getPath("userData"), "relay-sessions.json");

const load = (): PersistedShape => {
  if (cache) {
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath(), "utf8")) as Partial<PersistedShape>;
    cache = { sessions: parsed.sessions ?? {} };
  } catch {
    cache = { sessions: {} };
  }
  return cache;
};

const persist = (state: PersistedShape): void => {
  cache = state;
  const path = filePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
};

const toSummary = (session: ChatSession): SessionSummary => ({
  id: session.id,
  title: session.title,
  mode: session.mode,
  model: session.model,
  projectId: session.projectId,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt
});

/** Summaries for one mode, most-recently-updated first. */
export const listSessions = (mode: WorkspaceMode): SessionSummary[] => {
  return Object.values(load().sessions)
    .filter((session) => session.mode === mode)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toSummary);
};

export const getSession = (id: string): ChatSession | null => {
  return load().sessions[id] ?? null;
};

/** Upsert a session and return the refreshed summary list for its mode. */
export const saveSession = (session: ChatSession): SessionSummary[] => {
  const state = load();
  persist({ sessions: { ...state.sessions, [session.id]: session } });
  return listSessions(session.mode);
};

export const deleteSession = (id: string, mode: WorkspaceMode): SessionSummary[] => {
  const state = load();
  const next = { ...state.sessions };
  delete next[id];
  persist({ sessions: next });
  return listSessions(mode);
};
