import { CSSProperties, PointerEvent, ReactElement, useEffect, useState } from "react";
import { Blocks, Code2, Columns2, MessageCircle, Plus, Search, Settings, Trash2 } from "lucide-react";
import { useSessions } from "./hooks/useSessions";
import { useSettings } from "./hooks/useSettings";
import { usePlugins } from "./hooks/usePlugins";
import { useSkills } from "./hooks/useSkills";
import { ChatView } from "./views/ChatView";
import { SettingsView } from "./views/SettingsView";
import { PluginsView } from "./views/PluginsView";
import { availableModels } from "../shared/agent/providers";
import type { WorkspaceMode } from "../shared/agent/types";

type AppView = WorkspaceMode | "settings" | "plugins";

const workspaceTabs: Array<{ id: WorkspaceMode; label: string; icon: typeof MessageCircle }> = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "code", label: "Code", icon: Code2 }
];

const relativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
};

export const App = (): ReactElement => {
  const settings = useSettings();
  const plugins = usePlugins();
  const skills = useSkills();
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceMode>("chat");
  const [activeView, setActiveView] = useState<AppView>("chat");
  const [sidebarWidth, setSidebarWidth] = useState(320);
  // Which tab the Plugins view opens on, and whether to pop the new-skill form,
  // when navigated to from the composer "+" menu.
  const [pluginsTab, setPluginsTab] = useState<"plugins" | "skills">("plugins");
  const [skillsAutoNew, setSkillsAutoNew] = useState(false);

  const openPlugins = (): void => {
    setPluginsTab("plugins");
    setSkillsAutoNew(false);
    setActiveView("plugins");
  };
  const openSkills = (autoNew: boolean): void => {
    setPluginsTab("skills");
    setSkillsAutoNew(autoNew);
    setActiveView("plugins");
  };

  const chat = useSessions(activeWorkspace, settings.state.activeModel);
  const activeWorkspaceLabel = workspaceTabs.find((tab) => tab.id === activeWorkspace)?.label ?? "Chat";

  // Auto-select the first usable model once keys are loaded and none is chosen.
  useEffect(() => {
    if (!settings.ready || settings.state.activeModel) {
      return;
    }
    const models = availableModels(settings.state.configuredKeys);
    if (models.length > 0) {
      void settings.setModel(models[0].model);
    }
  }, [settings.ready, settings.state.activeModel, settings.state.configuredKeys, settings]);

  const resizeSidebar = (event: PointerEvent<HTMLDivElement>): void => {
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    event.currentTarget.setPointerCapture(event.pointerId);

    const handleMove = (moveEvent: globalThis.PointerEvent): void => {
      const nextWidth = Math.min(420, Math.max(236, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(nextWidth);
    };
    const handleUp = (): void => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.classList.remove("resizing-sidebar");
    };

    document.body.classList.add("resizing-sidebar");
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };

  const startNewSession = (): void => {
    chat.newSession();
    setActiveView(activeWorkspace);
  };

  const openSession = (id: string): void => {
    chat.openSession(id);
    setActiveView(activeWorkspace);
  };

  const showChat = activeView === "chat" || activeView === "code";

  return (
    <div className="app-shell" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <div className="app-body">
        <aside className="sidebar" aria-label="Session sidebar">
          <div className="sidebar-brand">
            <div>
              <h1>Relay</h1>
              <p>Open-source coding agent</p>
            </div>
            <button className="icon-button" type="button" aria-label="Toggle sidebar">
              <Columns2 size={18} />
            </button>
          </div>

          <nav className="mode-switcher" aria-label="Workspace modes">
            {workspaceTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeWorkspace === tab.id && activeView !== "settings";
              return (
                <button
                  className={isActive ? "mode-tab active" : "mode-tab"}
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveWorkspace(tab.id);
                    setActiveView(tab.id);
                  }}
                  aria-current={activeView === tab.id ? "page" : undefined}
                  aria-label={tab.label}
                >
                  <Icon size={14} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          <div
            className="sidebar-resizer"
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            onPointerDown={resizeSidebar}
          />

          <button className="new-session" type="button" onClick={startNewSession}>
            <span>
              <Plus size={22} />
            </span>
            New session
          </button>

          <div className="session-list" aria-label="Recent sessions">
            <div className="session-list-header">
              <span>{activeWorkspaceLabel} sessions</span>
              <Search size={15} />
            </div>
            {chat.sessions.length === 0 && <p className="session-empty">No sessions yet</p>}
            {chat.sessions.map((session) => {
              const isActive = session.id === chat.activeSessionId && activeView !== "settings";
              return (
                <div className={isActive ? "session-row active" : "session-row"} key={session.id}>
                  <button className="session-open" type="button" onClick={() => openSession(session.id)}>
                    <span className="session-title">{session.title}</span>
                    <span className="session-repo">{relativeTime(session.updatedAt)}</span>
                  </button>
                  <button
                    className="session-delete"
                    type="button"
                    aria-label={`Delete session ${session.title}`}
                    onClick={() => chat.deleteSession(session.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="account-card">
            <button
              className={activeView === "plugins" ? "settings-button active" : "settings-button"}
              type="button"
              onClick={() => setActiveView("plugins")}
              aria-label="Open plugins"
            >
              <Blocks size={14} />
              <span>Plugins</span>
            </button>
            <button
              className={activeView === "settings" ? "settings-button active" : "settings-button"}
              type="button"
              onClick={() => setActiveView("settings")}
              aria-label="Open settings"
            >
              <Settings size={14} />
              <span>Settings</span>
            </button>
          </div>
        </aside>

        <main className="preview-canvas" aria-label="Workspace canvas">
          {showChat && (
            <ChatView
              chat={chat}
              settings={settings}
              skills={skills}
              mode={activeWorkspace}
              modeLabel={activeWorkspaceLabel}
              onAddSkill={() => openSkills(true)}
              onManageSkills={() => openSkills(false)}
              onOpenPlugins={openPlugins}
            />
          )}
          {activeView === "settings" && <SettingsView settings={settings} />}
          {activeView === "plugins" && (
            <PluginsView
              plugins={plugins}
              skills={skills}
              initialTab={pluginsTab}
              skillsAutoNew={skillsAutoNew}
            />
          )}
        </main>
      </div>
    </div>
  );
};
