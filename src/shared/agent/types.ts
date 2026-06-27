export type AgentRole = "user" | "assistant" | "system";

export type WorkspaceMode = "chat" | "code";

/**
 * A file the user attached to a message. Images are stored on disk under
 * userData and referenced by `id` (read back via `attachments:read`); documents
 * are extracted to text at ingest time and carry it inline in `text`.
 */
export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "document";
  /** Extracted text for documents (pdf/docx/plain); absent for images. */
  text?: string;
  /**
   * Transient *raw* base64 of an image (no data-URL prefix), injected by the
   * main process just before streaming so the model can see it. Paired with
   * `mimeType` to build a correctly-typed image part — passing a full data URI
   * instead makes the AI SDK mis-sniff the media type. Never persisted.
   */
  imageBase64?: string;
}

export interface AgentMessage {
  id: string;
  role: AgentRole;
  content: string;
  /** Files attached to this turn (images + documents). */
  attachments?: Attachment[];
  /** Streamed reasoning ("thinking") text, when the model emits it. */
  reasoning?: string;
  createdAt: string;
}

/** A file handed from the renderer to `attachments:ingest` (base64-encoded). */
export interface RawAttachment {
  name: string;
  mimeType: string;
  /** Base64 of the raw file bytes (no data-URL prefix). */
  data: string;
}

/** Per-request reasoning controls (currently Z.AI / GLM). */
export interface ThinkingOptions {
  enabled: boolean;
  /** reasoning_effort value, e.g. "high" | "max" (GLM-5.x). */
  effort?: string;
}

export interface AgentRequest {
  /** Client-generated run id; events are tagged with it (also the assistant message id). */
  runId: string;
  /** Full conversation so far; the last entry is the new user turn. */
  messages: AgentMessage[];
  /** Mastra model-router id, e.g. "deepseek/deepseek-chat". */
  model: string;
  activeTab: WorkspaceMode;
  /** Skills referenced (via /<slug>) in this turn; their instructions are applied. */
  skills?: Array<{ name: string; instructions: string }>;
  /** Reasoning controls for capable models (Z.AI / GLM). */
  thinking?: ThinkingOptions;
}

/** Streaming events pushed from main -> renderer for a single run. */
export type AgentStreamEvent =
  | { type: "delta"; runId: string; text: string }
  | { type: "reasoning"; runId: string; text: string }
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
