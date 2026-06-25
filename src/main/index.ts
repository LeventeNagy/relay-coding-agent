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
import type { AgentRequest, AgentRunHandle, ChatSession, WorkspaceMode } from "../shared/agent/types";

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

  // --- Agent streaming ---
  // Renderer invokes "agent:start" and gets a runId synchronously; deltas are
  // pushed back over "agent:event" tagged with that runId.
  ipcMain.handle("agent:start", (event, request: AgentRequest): AgentRunHandle => {
    const runId = request.runId;
    const sender = event.sender;

    void streamMessage({
      runId,
      model: request.model,
      activeTab: request.activeTab,
      messages: request.messages,
      onEvent: (streamEvent) => {
        if (!sender.isDestroyed()) {
          sender.send("agent:event", streamEvent);
        }
      }
    });

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
  if (process.platform !== "darwin") {
    app.quit();
  }
});
