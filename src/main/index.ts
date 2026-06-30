import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { streamMessage } from "../mastra/agentService";
import { installCrashHandlers } from "./logger";
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
import { logProviderMappingCheck } from "./providerCheck";
import { deleteSkill, listSkills, saveSkill } from "./skillStore";
import {
  addSource,
  createProject,
  getProject,
  linkProject,
  listProjects,
  removeProject,
  removeSource,
  touchProject
} from "./projectStore";
import { listPets, savePet, removePet, pickPetImage } from "./petStore";
import { nativeTools } from "./nativeTools";
import { buildCodingTools, type ApprovalRequest } from "./codingTools";
import { prepareHistory } from "./contextManager";
import { clearCompaction } from "./contextStore";
import { ingest as ingestAttachments, readBase64, read as readAttachment } from "./attachmentStore";
import type {
  AgentAnswer,
  AgentMessage,
  AgentQuestion,
  AgentRequest,
  AgentRunHandle,
  AgentStreamEvent,
  ChatSession,
  RawAttachment,
  WorkspaceMode
} from "../shared/agent/types";
import type { PluginInput, PluginServerConfig } from "../shared/plugins/types";
import type { PetInput } from "../shared/pets/types";
import type { ProjectFramework, Source } from "../shared/projects/types";
import type { SkillInput } from "../shared/skills/types";

const createPluginId = (): string =>
  `plugin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** Abort controllers for in-flight agent runs, keyed by runId (for the Stop button). */
const runControllers = new Map<string, AbortController>();

/** Parked human-in-the-loop approval requests, keyed by approvalId. */
const pendingApprovals = new Map<string, { runId: string; resolve: (ok: boolean) => void }>();

/** Parked clickable-question requests, keyed by requestId. */
const pendingInputs = new Map<string, { runId: string; resolve: (answers: AgentAnswer[]) => void }>();

/** Resolve every pending approval/input for a run (on Stop / window close). */
const denyRunApprovals = (runId: string): void => {
  for (const [id, entry] of pendingApprovals) {
    if (entry.runId === runId) {
      entry.resolve(false);
      pendingApprovals.delete(id);
    }
  }
  for (const [id, entry] of pendingInputs) {
    if (entry.runId === runId) {
      entry.resolve([]);
      pendingInputs.delete(id);
    }
  }
};

/** Tell open windows the project list/sources changed (after auto-detecting links). */
const broadcastProjects = (): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send("projects:changed");
    }
  }
};

/** Extract http(s) URLs from a message, trimming trailing punctuation. */
const extractUrls = (text: string): string[] => {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?]+$/, "")))];
};

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

/** Locate the app logo across dev (project root) and built (out/renderer) layouts. */
const resolveAppIcon = (): string | undefined =>
  [
    join(__dirname, "../renderer/logo.png"),
    join(__dirname, "../../logo.png"),
    join(__dirname, "../../public/logo.png")
  ].find((candidate) => existsSync(candidate));

const createWindow = (): void => {
  nativeTheme.themeSource = "dark";

  const mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#080a0f",
    title: "Relay Coding Agent",
    icon: resolveAppIcon(),
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox stays off: a sandboxed preload must be CommonJS, but electron-vite
      // emits an ESM preload here (project is "type": "module"), so enabling it
      // breaks contextBridge exposure (window.* undefined). contextIsolation +
      // nodeIntegration:false is the security baseline; sandbox needs a separate
      // CJS-preload migration to enable safely.
      sandbox: false
    }
  });

  // Links from chat/markdown must open in the user's real browser, never in a
  // child Electron window. Deny all popups (target="_blank", window.open) and
  // hand http(s) URLs to the OS; same-origin navigations (app/HMR) proceed.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const target = new URL(url);
      const appOrigin = new URL(mainWindow.webContents.getURL()).origin;
      if (target.origin !== appOrigin && /^https?:$/.test(target.protocol)) {
        event.preventDefault();
        void shell.openExternal(url);
      }
    } catch {
      /* not a parseable URL — let Electron handle it */
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    // Lock down the packaged app with a CSP. Skipped in dev so Vite's HMR
    // (inline scripts, eval, ws:) keeps working; the dev server is local/trusted.
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'"
    ].join("; ");
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] }
      });
    });
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
  ipcMain.handle("sessions:delete", (_event, id: string, mode: WorkspaceMode) => {
    clearCompaction(id);
    return deleteSession(id, mode);
  });

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

  // --- Projects (code-mode folders) ---
  ipcMain.handle("projects:list", () => listProjects());
  ipcMain.handle("projects:create", (_event, name: string, framework?: ProjectFramework) =>
    createProject(name, framework)
  );
  ipcMain.handle(
    "projects:add-source",
    (_event, projectId: string, input: { title?: string; url: string; note?: string; kind?: Source["kind"] }) => {
      addSource(projectId, input);
      return listProjects();
    }
  );
  ipcMain.handle("projects:remove-source", (_event, projectId: string, srcId: string) => {
    removeSource(projectId, srcId);
    return listProjects();
  });
  ipcMain.handle("projects:link", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: "Select a project folder",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return linkProject(result.filePaths[0]);
  });
  ipcMain.handle("projects:remove", (_event, id: string) => {
    removeProject(id);
    return listProjects();
  });

  // --- Status pets (user-imported sprite sheets) ---
  ipcMain.handle("pets:list", () => listPets());
  ipcMain.handle("pets:pick-image", () => pickPetImage());
  ipcMain.handle("pets:save", (_event, input: PetInput) => savePet(input));
  ipcMain.handle("pets:remove", (_event, id: string) => removePet(id));

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

    const emit = (streamEvent: AgentStreamEvent): void => {
      if (!sender.isDestroyed()) {
        sender.send("agent:event", streamEvent);
      }
    };

    // Human-in-the-loop: ask the renderer to approve a risky action and await
    // its answer. The "agent:approve" handler resolves the parked promise; Stop
    // / window-close deny everything for this run so it can't hang.
    const requestApproval = (req: ApprovalRequest): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        if (controller.signal.aborted || sender.isDestroyed()) {
          resolve(false);
          return;
        }
        const approvalId = `appr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        pendingApprovals.set(approvalId, { runId, resolve });
        emit({ type: "approval", runId, approvalId, tool: req.tool, summary: req.summary, detail: req.detail });
      });

    // Clickable clarifying questions: present them in the UI and await answers.
    const requestUserInput = (questions: AgentQuestion[]): Promise<AgentAnswer[]> =>
      new Promise<AgentAnswer[]>((resolve) => {
        if (controller.signal.aborted || sender.isDestroyed()) {
          resolve([]);
          return;
        }
        const requestId = `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        pendingInputs.set(requestId, { runId, resolve });
        emit({ type: "questions", runId, requestId, questions });
      });

    // Assemble tools: chat → native tools only; code → native + filesystem/command
    // tools scoped to the session's project folder.
    let tools = toolsEnabled ? { ...nativeTools } : undefined;
    let projectRoot: string | undefined;
    let projectFramework: ProjectFramework | undefined;
    let projectSources: Source[] | undefined;
    if (toolsEnabled && request.activeTab === "code" && request.projectId) {
      let project = getProject(request.projectId);
      if (project) {
        // Auto-capture any links the user put in their latest message as sources,
        // so they're remembered and injected from now on (no manual paste needed).
        const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
        const existing = new Set(project.sources.map((s) => s.url));
        const newUrls = extractUrls(lastUser?.content ?? "").filter((u) => !existing.has(u));
        if (newUrls.length > 0) {
          for (const url of newUrls) {
            addSource(project.id, { url });
          }
          project = getProject(request.projectId) ?? project;
          broadcastProjects();
        }
        projectRoot = project.root;
        projectFramework = project.framework;
        projectSources = project.sources;
        touchProject(project.id);
        tools = {
          ...nativeTools,
          ...buildCodingTools({
            projectRoot,
            accessMode: request.accessMode ?? "ask",
            planMode: request.planMode,
            requestApproval,
            requestUserInput
          })
        };
      }
    }

    void (async () => {
      // Keep the conversation within the model's context window (summarize older
      // turns if needed); failures degrade to trimming inside prepareHistory.
      const prepared = await prepareHistory({
        sessionId: request.sessionId,
        model: request.model,
        messages: enriched,
        onProgress: (label) => emit({ type: "progress", runId, label })
      }).catch(() => ({
        recentMessages: enriched,
        summary: "",
        used: 0,
        window: 0,
        compacted: false
      }));
      emit({
        type: "context",
        runId,
        used: prepared.used,
        window: prepared.window,
        compacted: prepared.compacted
      });

      // Fetch live MCP toolsets for the plugins this conversation activated;
      // failures shouldn't block chat. Empty selection → no toolsets.
      const toolsets = await getToolsetsFor(request.activePluginIds ?? [], request.activeTab).catch(
        () => undefined
      );
      await streamMessage({
        runId,
        model: request.model,
        activeTab: request.activeTab,
        messages: prepared.recentMessages,
        contextSummary: prepared.summary,
        toolsets,
        tools,
        projectRoot,
        framework: projectFramework,
        sources: projectSources,
        planMode: request.planMode,
        thinking: request.thinking,
        skills: request.skills,
        webMode: request.webMode,
        abortSignal: controller.signal,
        onEvent: emit
      });
      runControllers.delete(runId);
      denyRunApprovals(runId);
    })();

    return { runId };
  });

  // Interrupt an in-flight run; the stream emits its partial text as "done".
  ipcMain.handle("agent:stop", (_event, runId: string) => {
    runControllers.get(runId)?.abort();
    runControllers.delete(runId);
    denyRunApprovals(runId);
  });

  // Answer a parked human-in-the-loop approval request.
  ipcMain.handle("agent:approve", (_event, approvalId: string, approved: boolean) => {
    const entry = pendingApprovals.get(approvalId);
    if (entry) {
      pendingApprovals.delete(approvalId);
      entry.resolve(approved);
    }
  });

  // Submit answers to a parked clickable-question request.
  ipcMain.handle("agent:answer", (_event, requestId: string, answers: AgentAnswer[]) => {
    const entry = pendingInputs.get(requestId);
    if (entry) {
      pendingInputs.delete(requestId);
      entry.resolve(answers);
    }
  });
};

app.whenReady().then(() => {
  // Log otherwise-fatal errors to userData/logs so packaged builds leave a trail.
  installCrashHandlers();
  applyKeysToEnv();
  // Verify our catalog's API-key env vars still match Mastra's registry, so a
  // future drift surfaces loudly here instead of as a user's mystery auth fail.
  logProviderMappingCheck();
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
