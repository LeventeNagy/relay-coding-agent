/// <reference types="vite/client" />

import type {
  AgentApi,
  AttachmentsApi,
  OverlayApi,
  OverlayClientApi,
  PetsApi,
  PluginsApi,
  ProjectsApi,
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
    projects: ProjectsApi;
    skills: SkillsApi;
    pets: PetsApi;
    overlay: OverlayApi;
    overlayClient: OverlayClientApi;
    attachments: AttachmentsApi;
  }
}
