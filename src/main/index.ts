import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
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
import { getServer, listServers, removeServer, setEnabled, upsertServer } from "./mcpStore";
import {
  connectOAuth,
  disconnectOAuth,
  dispose as disposeMcp,
  getToolsetsFor,
  listSummaries,
  probeServer,
  pruneStatuses,
  refreshStatuses
} from "./mcpManager";
import { pluginCatalog } from "../shared/plugins/catalog";
import { deleteSkill, listSkills, saveSkill } from "./skillStore";
import { nativeTools } from "./nativeTools";
import { ingest as ingestAttachments, readBase64, read as readAttachment } from "./attachmentStore";
import type {
  AgentMessage,
  AgentRequest,
  AgentRunHandle,
  ChatSession,
  RawAttachment,
  WorkspaceMode
} from "../shared/agent/types";
import type { PluginInput, PluginServerConfig } from "../shared/plugins/types";
import type { SkillInput } from "../shared/skills/types";

const createPluginId = (): string =>
  `plugin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** Abort controllers for in-flight agent runs, keyed by runId (for the Stop button). */
const runControllers = new Map<string, AbortController>();

/** Build a full server config from a renderer input (new or existing). */
const configFromInput = (input: PluginInput): PluginServerConfig => ({
  id: input.id ?? createPluginId(),
  catalogId: input.catalogId,
  name: input.name,
  transport: input.transport ?? "stdio",
  auth: input.auth,
  url: input.url,
  scope: input.scope,
  command: input.command,
  args: input.args,
  env: input.env,
  // Preserve enabled state on edit; new servers start enabled.
  enabled: input.id ? (listServers().find((s) => s.id === input.id)?.enabled ?? true) : true
});

/** Tell every open window the plugin list/status changed (after startup hydrate). */
const broadcastPlugins = (): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send("plugins:changed");
    }
  }
};

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
    // OAuth servers connect via the browser flow; others get a best-effort probe
    // so the UI shows connected/tools immediately.
    if (config.transport === "http" && config.auth === "oauth") {
      await connectOAuth(config).catch(() => undefined);
    } else {
      await probeServer(config).catch(() => undefined);
    }
    return listSummaries();
  });
  ipcMain.handle("plugins:probe", (_event, input: PluginInput) => probeServer(configFromInput(input)));
  // Run (or re-run) the OAuth browser flow for an installed server.
  ipcMain.handle("plugins:connect", async (_event, id: string) => {
    const server = getServer(id);
    const result = server
      ? server.transport === "http" && server.auth === "oauth"
        ? await connectOAuth(server)
        : await probeServer(server)
      : { ok: false, tools: [], error: "Server not found." };
    return { result, plugins: listSummaries() };
  });
  ipcMain.handle("plugins:toggle", (_event, id: string, enabled: boolean) => {
    setEnabled(id, enabled);
    return listSummaries();
  });
  ipcMain.handle("plugins:remove", (_event, id: string) => {
    disconnectOAuth(id);
    removeServer(id);
    pruneStatuses();
    return listSummaries();
  });
  // Open an external URL (e.g. a provider's "create API key" page) in the browser.
  ipcMain.handle("plugins:open-external", (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
  });

  // --- Skills (reusable instructions referenced with /<slug>) ---
  ipcMain.handle("skills:list", () => listSkills());
  ipcMain.handle("skills:save", (_event, input: SkillInput) => saveSkill(input));
  ipcMain.handle("skills:delete", (_event, id: string) => deleteSkill(id));

  // --- Attachments (images stored on disk; documents extracted to text) ---
  ipcMain.handle("attachments:ingest", (_event, files: RawAttachment[]) => ingestAttachments(files));
  ipcMain.handle("attachments:read", (_event, id: string) => readAttachment(id));

  // --- Agent streaming ---
  // Renderer invokes "agent:start" and gets a runId synchronously; deltas are
  // pushed back over "agent:event" tagged with that runId.
  ipcMain.handle("agent:start", (event, request: AgentRequest): AgentRunHandle => {
    const runId = request.runId;
    const sender = event.sender;

    // Relay's native tools are on by default; set RELAY_NATIVE_TOOLS=0 to disable
    // them (escape hatch if a specific model misbehaves with tools attached).
    const toolsEnabled = process.env.RELAY_NATIVE_TOOLS !== "0";

    // Inline image attachments as data URLs so the model can see them. Read from
    // disk here (keeps agentService electron-free); document text already rides
    // inline on the message from ingest. Mutates only this transient copy.
    const enriched: AgentMessage[] = request.messages.map((message) => {
      if (!message.attachments?.some((att) => att.kind === "image")) {
        return message;
      }
      return {
        ...message,
        attachments: message.attachments.map((att) =>
          att.kind === "image" ? { ...att, imageBase64: readBase64(att.id) ?? undefined } : att
        )
      };
    });

    // Allow the renderer to interrupt this run (the Stop button) by aborting the
    // model stream in-flight.
    const controller = new AbortController();
    runControllers.set(runId, controller);

    void (async () => {
      // Fetch live MCP toolsets for the plugins this conversation activated;
      // failures shouldn't block chat. Empty selection → no toolsets.
      const toolsets = await getToolsetsFor(request.activePluginIds ?? [], request.activeTab).catch(
        () => undefined
      );
      await streamMessage({
        runId,
        model: request.model,
        activeTab: request.activeTab,
        messages: enriched,
        toolsets,
        tools: toolsEnabled ? nativeTools : undefined,
        thinking: request.thinking,
        skills: request.skills,
        abortSignal: controller.signal,
        onEvent: (streamEvent) => {
          if (!sender.isDestroyed()) {
            sender.send("agent:event", streamEvent);
          }
        }
      });
      runControllers.delete(runId);
    })();

    return { runId };
  });

  // Interrupt an in-flight run; the stream emits its partial text as "done".
  ipcMain.handle("agent:stop", (_event, runId: string) => {
    runControllers.get(runId)?.abort();
    runControllers.delete(runId);
  });
};

app.whenReady().then(() => {
  applyKeysToEnv();
  registerIpc();
  createWindow();

  // Hydrate live plugin status in the background (statuses are in-memory, so a
  // restart starts blank); push the result to the UI when done.
  void refreshStatuses().then(broadcastPlugins);

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
