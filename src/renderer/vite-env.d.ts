/// <reference types="vite/client" />

import type { AgentApi, ProvidersApi, SessionsApi, SettingsApi } from "../preload";

declare global {
  interface Window {
    agent: AgentApi;
    settings: SettingsApi;
    providers: ProvidersApi;
    sessions: SessionsApi;
  }
}
