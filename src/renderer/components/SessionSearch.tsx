import { ReactElement, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { SessionSummary } from "../../shared/agent/types";

interface SessionSearchProps {
  sessions: SessionSummary[];
  /** Formats an ISO timestamp for the result meta (e.g. "3h ago"). */
  formatTime: (iso: string) => string;
  /** Open the chosen session. */
  onOpen: (id: string) => void;
  /** Close the dialog. */
  onClose: () => void;
}

/** Show at most this many results (empty query = most recent sessions). */
const RESULT_LIMIT = 10;

/**
 * Command-palette-style overlay for finding a chat session by title. Opens from
 * the sessions-list search icon; filters as you type, arrow keys + Enter to
 * pick, Esc / outside-click to close.
 */
export const SessionSearch = ({
  sessions,
  formatTime,
  onOpen,
  onClose
}: SessionSearchProps): ReactElement => {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions;
    return matched.slice(0, RESULT_LIMIT);
  }, [query, sessions]);

  // Keep the highlighted index valid as results change.
  useEffect(() => {
    setIndex(0);
  }, [query]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const choose = (id: string): void => {
    onOpen(id);
    onClose();
  };

  return (
    <div className="session-search-overlay" onClick={onClose}>
      <div
        className="session-search"
        role="dialog"
        aria-label="Search sessions"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-search-input">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            placeholder="Search sessions…"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (results[index]) {
                  choose(results[index].id);
                }
              }
            }}
          />
        </div>
        <ul className="session-search-results" role="listbox" aria-label="Matching sessions">
          {results.length === 0 ? (
            <li className="session-search-empty">No sessions found</li>
          ) : (
            results.map((session, i) => (
              <li key={session.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  className={i === index ? "active" : ""}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => choose(session.id)}
                >
                  <span className="session-search-title">{session.title}</span>
                  <span className="session-search-meta">{formatTime(session.updatedAt)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
};
