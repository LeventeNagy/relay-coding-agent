import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentAnswer,
  AgentRequest,
  AgentRunHandle,
  AgentStreamEvent,
  Attachment,
  ChatSession,
  ProviderModels,
  RawAttachment,
  SessionSummary,
  SettingsState,
  WorkspaceMode
} from "../shared/agent/types";
import type {
  PluginCatalogEntry,
  PluginConnectResult,
  PluginInput,
  PluginProbeResult,
  PluginSummary
} from "../shared/plugins/types";
import type { Skill, SkillInput } from "../shared/skills/types";
import type { Project, ProjectFramework, Source } from "../shared/projects/types";

const agentApi = {
  /** Start a streaming run; returns the runId used to tag incoming events. */
  start(request: AgentRequest): Promise<AgentRunHandle> {
    return ipcRenderer.invoke("agent:start", request);
  },
  /** Interrupt an in-flight run (the Stop button); keeps any partial text. */
  stop(runId: string): Promise<void> {
    return ipcRenderer.invoke("agent:stop", runId);
  },
  /** Answer a pending human-in-the-loop approval request (code mode). */
  approve(approvalId: string, approved: boolean): Promise<void> {
    return ipcRenderer.invoke("agent:approve", approvalId, approved);
  },
  /** Submit answers to a pending clickable-question request (code mode). */
  answer(requestId: string, answers: AgentAnswer[]): Promise<void> {
    return ipcRenderer.invoke("agent:answer", requestId, answers);
  },
  /** Subscribe to stream events. Returns an unsubscribe function. */
  onEvent(listener: (event: AgentStreamEvent) => void): () => void {
    const handler = (_event: unknown, payload: AgentStreamEvent): void => listener(payload);
    ipcRenderer.on("agent:event", handler);
    return () => ipcRenderer.removeListener("agent:event", handler);
  }
};

const settingsApi = {
  get(): Promise<SettingsState> {
    return ipcRenderer.invoke("settings:get");
  },
  setKey(envVar: string, key: string): Promise<SettingsState> {
    return ipcRenderer.invoke("settings:set-key", envVar, key);
  },
  deleteKey(envVar: string): Promise<SettingsState> {
    return ipcRenderer.invoke("settings:delete-key", envVar);
  },
  setModel(model: string | null): Promise<SettingsState> {
    return ipcRenderer.invoke("settings:set-model", model);
  }
};

const providersApi = {
  getModels(): Promise<ProviderModels> {
    return ipcRenderer.invoke("providers:get-models");
  }
};

const sessionsApi = {
  list(mode: WorkspaceMode): Promise<SessionSummary[]> {
    return ipcRenderer.invoke("sessions:list", mode);
  },
  get(id: string): Promise<ChatSession | null> {
    return ipcRenderer.invoke("sessions:get", id);
  },
  save(session: ChatSession): Promise<SessionSummary[]> {
    return ipcRenderer.invoke("sessions:save", session);
  },
  delete(id: string, mode: WorkspaceMode): Promise<SessionSummary[]> {
    return ipcRenderer.invoke("sessions:delete", id, mode);
  }
};

const pluginsApi = {
  catalog(): Promise<PluginCatalogEntry[]> {
    return ipcRenderer.invoke("plugins:catalog");
  },
  list(): Promise<PluginSummary[]> {
    return ipcRenderer.invoke("plugins:list");
  },
  add(input: PluginInput): Promise<PluginSummary[]> {
    return ipcRenderer.invoke("plugins:add", input);
  },
  probe(input: PluginInput): Promise<PluginProbeResult> {
    return ipcRenderer.invoke("plugins:probe", input);
  },
  /** Run (or re-run) the OAuth browser flow for an installed server. */
  connect(id: string): Promise<PluginConnectResult> {
    return ipcRenderer.invoke("plugins:connect", id);
  },
  toggle(id: string, enabled: boolean): Promise<PluginSummary[]> {
    return ipcRenderer.invoke("plugins:toggle", id, enabled);
  },
  remove(id: string): Promise<PluginSummary[]> {
    return ipcRenderer.invoke("plugins:remove", id);
  },
  /** Open an external URL (e.g. a provider's "create key" page) in the browser. */
  openExternal(url: string): Promise<void> {
    return ipcRenderer.invoke("plugins:open-external", url);
  },
  /** Subscribe to plugin list/status changes (e.g. startup status hydration). */
  onChanged(listener: () => void): () => void {
    const handler = (): void => listener();
    ipcRenderer.on("plugins:changed", handler);
    return () => ipcRenderer.removeListener("plugins:changed", handler);
  }
};

const projectsApi = {
  list(): Promise<Project[]> {
    return ipcRenderer.invoke("projects:list");
  },
  create(name: string, framework?: ProjectFramework): Promise<Project> {
    return ipcRenderer.invoke("projects:create", name, framework);
  },
  /** Open the native folder picker and link the chosen folder (null if cancelled). */
  link(): Promise<Project | null> {
    return ipcRenderer.invoke("projects:link");
  },
  remove(id: string): Promise<Project[]> {
    return ipcRenderer.invoke("projects:remove", id);
  },
  /** Subscribe to project/source changes (e.g. links auto-captured from chat). */
  onChanged(listener: () => void): () => void {
    const handler = (): void => listener();
    ipcRenderer.on("projects:changed", handler);
    return () => ipcRenderer.removeListener("projects:changed", handler);
  },
  addSource(
    projectId: string,
    input: { title?: string; url: string; note?: string; kind?: Source["kind"] }
  ): Promise<Project[]> {
    return ipcRenderer.invoke("projects:add-source", projectId, input);
  },
  removeSource(projectId: string, srcId: string): Promise<Project[]> {
    return ipcRenderer.invoke("projects:remove-source", projectId, srcId);
  }
};

const skillsApi = {
  list(): Promise<Skill[]> {
    return ipcRenderer.invoke("skills:list");
  },
  save(input: SkillInput): Promise<Skill[]> {
    return ipcRenderer.invoke("skills:save", input);
  },
  delete(id: string): Promise<Skill[]> {
    return ipcRenderer.invoke("skills:delete", id);
  },
  /** Subscribe to external skill-list changes (e.g. an agent install). */
  onChanged(listener: () => void): () => void {
    const handler = (): void => listener();
    ipcRenderer.on("skills:changed", handler);
    return () => ipcRenderer.removeListener("skills:changed", handler);
  }
};

const attachmentsApi = {
  /** Persist images / extract document text; returns attachment refs. */
  ingest(files: RawAttachment[]): Promise<Attachment[]> {
    return ipcRenderer.invoke("attachments:ingest", files);
  },
  /** Read a stored image back as a data URL (null if missing). */
  read(id: string): Promise<string | null> {
    return ipcRenderer.invoke("attachments:read", id);
  }
};

contextBridge.exposeInMainWorld("agent", agentApi);
contextBridge.exposeInMainWorld("settings", settingsApi);
contextBridge.exposeInMainWorld("providers", providersApi);
contextBridge.exposeInMainWorld("sessions", sessionsApi);
contextBridge.exposeInMainWorld("plugins", pluginsApi);
contextBridge.exposeInMainWorld("projects", projectsApi);
contextBridge.exposeInMainWorld("skills", skillsApi);
contextBridge.exposeInMainWorld("attachments", attachmentsApi);

export type AgentApi = typeof agentApi;
export type AttachmentsApi = typeof attachmentsApi;
export type SettingsApi = typeof settingsApi;
export type ProvidersApi = typeof providersApi;
export type SessionsApi = typeof sessionsApi;
export type PluginsApi = typeof pluginsApi;
export type ProjectsApi = typeof projectsApi;
export type SkillsApi = typeof skillsApi;
