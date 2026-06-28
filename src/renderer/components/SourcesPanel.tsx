import { ReactElement } from "react";
import { BookOpen, FileText, Link2, PanelRightClose, Trash2 } from "lucide-react";
import type { Project, Source } from "../../shared/projects/types";

interface SourcesPanelProps {
  project: Project;
  onRemove: (srcId: string) => void;
  onClose: () => void;
}

const kindIcon = (kind: Source["kind"]): ReactElement => {
  if (kind === "doc") {
    return <BookOpen size={14} />;
  }
  if (kind === "design") {
    return <FileText size={14} />;
  }
  return <Link2 size={14} />;
};

/**
 * Right-side panel listing a project's sources (design specs + framework docs).
 * These are injected into the agent's context on every code turn so it never
 * loses track. Sources are captured automatically from links you share in chat —
 * there's no manual add; you can only remove.
 */
export const SourcesPanel = ({ project, onRemove, onClose }: SourcesPanelProps): ReactElement => (
  <aside className="sources-panel" aria-label="Project sources">
    <div className="sources-head">
      <span>Sources</span>
      <button type="button" aria-label="Hide sources" onClick={onClose}>
        <PanelRightClose size={16} />
      </button>
    </div>

    <p className="sources-hint">
      Links you share in chat are remembered here and injected every turn — design specs and the
      latest framework docs.
    </p>

    <ul className="sources-list">
      {project.sources.length === 0 && <li className="sources-empty">Share a link in chat to add one</li>}
      {project.sources.map((source) => (
        <li key={source.id} className="source-row">
          <button
            type="button"
            className="source-open"
            title={source.url}
            onClick={() => void window.plugins.openExternal(source.url)}
          >
            <span className="source-icon">{kindIcon(source.kind)}</span>
            <span className="source-text">
              <span className="source-title">
                {source.title}
                {source.kind === "doc" && <span className="source-tag">docs</span>}
              </span>
              {source.note && <span className="source-note">{source.note}</span>}
            </span>
          </button>
          <button
            type="button"
            className="source-remove"
            aria-label={`Remove ${source.title}`}
            onClick={() => onRemove(source.id)}
          >
            <Trash2 size={13} />
          </button>
        </li>
      ))}
    </ul>
  </aside>
);
