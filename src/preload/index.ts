import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentRequest,
  AgentRunHandle,
  AgentStreamEvent,
  ChatSession,
  ProviderModels,
  SessionSummary,
  SettingsState,
  WorkspaceMode
} from "../shared/agent/types";
import type {
  PluginCatalogEntry,
  PluginInput,
  PluginProbeResult,
  PluginSummary
} from "../shared/plugins/types";
import type { Skill, SkillInput } from "../shared/skills/types";

const agentApi = {
  /** Start a streaming run; returns the runId used to tag incoming events. */
  start(request: AgentRequest): Promise<AgentRunHandle> {
    return ipcRenderer.invoke("agent:start", request);
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
  toggle(id: string, enabled: boolean): Promise<PluginSummary[]> {
    return ipcRenderer.invoke("plugins:toggle", id, enabled);
  },
  remove(id: string): Promise<PluginSummary[]> {
    return ipcRenderer.invoke("plugins:remove", id);
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

contextBridge.exposeInMainWorld("agent", agentApi);
contextBridge.exposeInMainWorld("settings", settingsApi);
contextBridge.exposeInMainWorld("providers", providersApi);
contextBridge.exposeInMainWorld("sessions", sessionsApi);
contextBridge.exposeInMainWorld("plugins", pluginsApi);
contextBridge.exposeInMainWorld("skills", skillsApi);

export type AgentApi = typeof agentApi;
export type SettingsApi = typeof settingsApi;
export type ProvidersApi = typeof providersApi;
export type SessionsApi = typeof sessionsApi;
export type PluginsApi = typeof pluginsApi;
export type SkillsApi = typeof skillsApi;
