import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import { join } from "node:path";
import { streamMessage } from "../mastra/agentService";
import { getProviderModels } from "./modelRegistry";
import {
  applyKeysToEnv,
  deleteProviderKey,
  getSettingsState,
  setActiveModel,
  setProviderKey
} from "./settingsStore";
import { deleteSession, getSession, listSessions, saveSession } from "./sessionStore";
import { listServers, removeServer, setEnabled, upsertServer } from "./mcpStore";
import {
  dispose as disposeMcp,
  getActiveToolsets,
  listSummaries,
  probeServer,
  pruneStatuses
} from "./mcpManager";
import { pluginCatalog } from "../shared/plugins/catalog";
import { deleteSkill, listSkills, saveSkill } from "./skillStore";
import type { AgentRequest, AgentRunHandle, ChatSession, WorkspaceMode } from "../shared/agent/types";
import type { PluginInput, PluginServerConfig } from "../shared/plugins/types";
import type { SkillInput } from "../shared/skills/types";

const createPluginId = (): string =>
  `plugin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** Build a full server config from a renderer input (new or existing). */
const configFromInput = (input: PluginInput): PluginServerConfig => ({
  id: input.id ?? createPluginId(),
  catalogId: input.catalogId,
  name: input.name,
  transport: "stdio",
  command: input.command,
  args: input.args,
  env: input.env,
  // Preserve enabled state on edit; new servers start enabled.
  enabled: input.id ? (listServers().find((s) => s.id === input.id)?.enabled ?? true) : true
});

const createWindow = (): void => {
  nativeTheme.themeSource = "dark";

  const mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#080a0f",
    title: "Relay Coding Agent",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

const registerIpc = (): void => {
  // --- Settings ---
  ipcMain.handle("settings:get", () => getSettingsState());
  ipcMain.handle("settings:set-key", (_event, envVar: string, key: string) => setProviderKey(envVar, key));
  ipcMain.handle("settings:delete-key", (_event, envVar: string) => deleteProviderKey(envVar));
  ipcMain.handle("settings:set-model", (_event, model: string | null) => setActiveModel(model));

  // --- Provider model catalog (read from Mastra's bundled registry) ---
  ipcMain.handle("providers:get-models", () => getProviderModels());

  // --- Sessions ---
  ipcMain.handle("sessions:list", (_event, mode: WorkspaceMode) => listSessions(mode));
  ipcMain.handle("sessions:get", (_event, id: string) => getSession(id));
  ipcMain.handle("sessions:save", (_event, session: ChatSession) => saveSession(session));
  ipcMain.handle("sessions:delete", (_event, id: string, mode: WorkspaceMode) => deleteSession(id, mode));

  // --- Plugins (MCP servers) ---
  ipcMain.handle("plugins:catalog", () => pluginCatalog);
  ipcMain.handle("plugins:list", () => {
    pruneStatuses();
    return listSummaries();
  });
  ipcMain.handle("plugins:add", async (_event, input: PluginInput) => {
    const config = configFromInput(input);
    upsertServer(config);
    // Best-effort probe so the UI shows connected/tools immediately.
    await probeServer(config).catch(() => undefined);
    return listSummaries();
  });
  ipcMain.handle("plugins:probe", (_event, input: PluginInput) => probeServer(configFromInput(input)));
  ipcMain.handle("plugins:toggle", (_event, id: string, enabled: boolean) => {
    setEnabled(id, enabled);
    return listSummaries();
  });
  ipcMain.handle("plugins:remove", (_event, id: string) => {
    removeServer(id);
    pruneStatuses();
    return listSummaries();
  });

  // --- Skills (reusable instructions referenced with /<slug>) ---
  ipcMain.handle("skills:list", () => listSkills());
  ipcMain.handle("skills:save", (_event, input: SkillInput) => saveSkill(input));
  ipcMain.handle("skills:delete", (_event, id: string) => deleteSkill(id));

  // --- Agent streaming ---
  // Renderer invokes "agent:start" and gets a runId synchronously; deltas are
  // pushed back over "agent:event" tagged with that runId.
  ipcMain.handle("agent:start", (event, request: AgentRequest): AgentRunHandle => {
    const runId = request.runId;
    const sender = event.sender;

    void (async () => {
      // Fetch live MCP toolsets for enabled plugins; failures shouldn't block chat.
      const toolsets = await getActiveToolsets().catch(() => undefined);
      await streamMessage({
        runId,
        model: request.model,
        activeTab: request.activeTab,
        messages: request.messages,
        toolsets,
        skills: request.skills,
        onEvent: (streamEvent) => {
          if (!sender.isDestroyed()) {
            sender.send("agent:event", streamEvent);
          }
        }
      });
    })();

    return { runId };
  });
};

app.whenReady().then(() => {
  applyKeysToEnv();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  void disposeMcp().finally(() => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
});
