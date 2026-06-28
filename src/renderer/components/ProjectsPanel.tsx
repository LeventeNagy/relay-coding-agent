import { ReactElement, useState } from "react";
import { ChevronRight, FolderGit2, FolderPlus, Link2, Plus, Trash2 } from "lucide-react";
import type { Project, ProjectFramework } from "../../shared/projects/types";
import type { SessionSummary } from "../../shared/agent/types";

interface ProjectsPanelProps {
  projects: Project[];
  /** All code-mode sessions (grouped here by projectId). */
  sessions: SessionSummary[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  onSelectProject: (id: string) => void;
  onNewChat: (projectId: string) => void;
  onOpenSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onCreateProject: (name: string, framework: ProjectFramework) => void;
  onLinkProject: () => void;
  onRemoveProject: (id: string) => void;
  formatTime: (iso: string) => string;
}

/** Sidebar for code mode: projects (folders) each expanding to their chats. */
export const ProjectsPanel = ({
  projects,
  sessions,
  activeProjectId,
  activeSessionId,
  onSelectProject,
  onNewChat,
  onOpenSession,
  onDeleteSession,
  onCreateProject,
  onLinkProject,
  onRemoveProject,
  formatTime
}: ProjectsPanelProps): ReactElement => {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [framework, setFramework] = useState<ProjectFramework>("nextjs-shadcn");

  const submitCreate = (): void => {
    const trimmed = name.trim();
    if (trimmed) {
      onCreateProject(trimmed, framework);
    }
    setName("");
    setCreating(false);
  };

  return (
    <div className="projects-panel" aria-label="Projects">
      <div className="projects-head">
        <span>Projects</span>
        <button
          type="button"
          aria-label="New project"
          onClick={() => setCreating((c) => !c)}
        >
          <Plus size={15} />
        </button>
      </div>

      {creating && (
        <div className="project-create">
          <input
            autoFocus
            value={name}
            placeholder="Project name"
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitCreate();
              } else if (event.key === "Escape") {
                setCreating(false);
                setName("");
              }
            }}
          />
          <div className="project-template" role="radiogroup" aria-label="Project template">
            <button
              type="button"
              role="radio"
              aria-checked={framework === "nextjs-shadcn"}
              className={framework === "nextjs-shadcn" ? "active" : ""}
              onClick={() => setFramework("nextjs-shadcn")}
            >
              Next.js + shadcn
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={framework === "blank"}
              className={framework === "blank" ? "active" : ""}
              onClick={() => setFramework("blank")}
            >
              Blank
            </button>
          </div>
          <div className="project-create-actions">
            <button type="button" className="project-create-go" onClick={submitCreate}>
              <FolderPlus size={14} /> Create
            </button>
            <button type="button" className="project-create-link" onClick={() => { setCreating(false); onLinkProject(); }}>
              <Link2 size={14} /> Link folder
            </button>
          </div>
        </div>
      )}

      {projects.length === 0 && !creating && <p className="projects-empty">No projects yet</p>}

      {projects.map((project) => {
        const expanded = project.id === activeProjectId;
        const projectSessions = sessions.filter((s) => s.projectId === project.id);
        return (
          <div className={expanded ? "project-group open" : "project-group"} key={project.id}>
            <div className="project-row">
              <button
                type="button"
                className="project-row-main"
                onClick={() => onSelectProject(project.id)}
                title={project.root}
              >
                <ChevronRight size={14} className="project-caret" />
                <FolderGit2 size={15} />
                <span className="project-name">{project.name}</span>
              </button>
              <button
                type="button"
                className="project-remove"
                aria-label={`Remove ${project.name}`}
                title="Remove from list (keeps files on disk)"
                onClick={() => onRemoveProject(project.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>

            {expanded && (
              <div className="project-sessions">
                <button type="button" className="project-newchat" onClick={() => onNewChat(project.id)}>
                  <Plus size={13} /> New chat
                </button>
                {projectSessions.length === 0 && <p className="project-empty">No chats yet</p>}
                {projectSessions.map((session) => (
                  <div
                    className={session.id === activeSessionId ? "session-row active" : "session-row"}
                    key={session.id}
                  >
                    <button className="session-open" type="button" onClick={() => onOpenSession(session.id)}>
                      <span className="session-title">{session.title}</span>
                      <span className="session-repo">{formatTime(session.updatedAt)}</span>
                    </button>
                    <button
                      className="session-delete"
                      type="button"
                      aria-label={`Delete chat ${session.title}`}
                      onClick={() => onDeleteSession(session.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
