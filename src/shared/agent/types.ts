export type AgentRole = "user" | "assistant" | "system";

export type WorkspaceMode = "chat" | "code";

export interface AgentMessage {
  id: string;
  role: AgentRole;
  content: string;
  createdAt: string;
}

export interface AgentRequest {
  /** Client-generated run id; events are tagged with it (also the assistant message id). */
  runId: string;
  /** Full conversation so far; the last entry is the new user turn. */
  messages: AgentMessage[];
  /** Mastra model-router id, e.g. "deepseek/deepseek-chat". */
  model: string;
  activeTab: WorkspaceMode;
}

/** Streaming events pushed from main -> renderer for a single run. */
export type AgentStreamEvent =
  | { type: "delta"; runId: string; text: string }
  | { type: "done"; runId: string; text: string }
  | { type: "error"; runId: string; message: string };

/** Returned synchronously when a run is accepted. */
export interface AgentRunHandle {
  runId: string;
}

/** Map of provider-router slug -> available model ids (from the Mastra registry). */
export type ProviderModels = Record<string, string[]>;

/** Lightweight session record for the sidebar list (no message bodies). */
export interface SessionSummary {
  id: string;
  title: string;
  mode: WorkspaceMode;
  /** Mastra router id last used for this session, if any. */
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A full persisted conversation. */
export interface ChatSession extends SessionSummary {
  messages: AgentMessage[];
}

/** A provider entry the UI can render and select a model from. */
export interface ProviderInfo {
  name: string;
  /** Env var the Mastra router reads the key from. "Local server" for keyless. */
  variable: string;
  /** Mastra model-router id. */
  model: string;
  note: string;
  plans: string[];
}

/** Settings snapshot exposed to the renderer (never includes raw key values). */
export interface SettingsState {
  /** Env vars that currently have a stored key. */
  configuredKeys: string[];
  /** Currently selected model-router id, or null if none chosen. */
  activeModel: string | null;
  /** True when the OS-level secure store is available for encryption. */
  secureStorageAvailable: boolean;
}
