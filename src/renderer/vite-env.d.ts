/// <reference types="vite/client" />

import type {
  AgentApi,
  AttachmentsApi,
  PluginsApi,
  ProvidersApi,
  SessionsApi,
  SettingsApi,
  SkillsApi
} from "../preload";

declare global {
  interface Window {
    agent: AgentApi;
    settings: SettingsApi;
    providers: ProvidersApi;
    sessions: SessionsApi;
    plugins: PluginsApi;
    skills: SkillsApi;
    attachments: AttachmentsApi;
  }
}
