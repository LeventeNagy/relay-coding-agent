import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentMessage,
  ChatSession,
  SessionSummary,
  ThinkingOptions,
  WorkspaceMode
} from "../../shared/agent/types";
import type { SkillRef } from "../../shared/skills/types";

const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const makeTitle = (text: string): string => {
  const firstLine = text.split("\n")[0].trim();
  if (!firstLine) {
    return "New session";
  }
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine;
};

interface ActiveMeta {
  id: string;
  title: string;
  createdAt: string;
  model: string | null;
}

export interface SessionsController {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  messages: AgentMessage[];
  isStreaming: boolean;
  send: (text: string, skills?: SkillRef[], thinking?: ThinkingOptions) => void;
  newSession: () => void;
  openSession: (id: string) => void;
  deleteSession: (id: string) => void;
}

/**
 * Owns the conversation for one workspace mode plus its persistence.
 *
 * Sessions are created lazily: `newSession()` only clears the view to a draft;
 * a session record is created and saved on the FIRST `send()`. After that, the
 * session is re-saved whenever a streamed run finishes.
 */
export const useSessions = (mode: WorkspaceMode, model: string | null): SessionsController => {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);

  // Refs so the once-registered event handler and persistence effect see fresh values.
  const messagesRef = useRef<AgentMessage[]>([]);
  const activeMetaRef = useRef<ActiveMeta | null>(null);
  const modeRef = useRef<WorkspaceMode>(mode);
  const modelRef = useRef<string | null>(model);
  const prevStreamingRef = useRef<string | null>(null);
  messagesRef.current = messages;
  modeRef.current = mode;
  modelRef.current = model;

  const persistActive = useCallback((messagesToSave: AgentMessage[]) => {
    const meta = activeMetaRef.current;
    if (!meta) {
      return;
    }
    const session: ChatSession = {
      id: meta.id,
      title: meta.title,
      mode: modeRef.current,
      model: meta.model ?? modelRef.current,
      messages: messagesToSave,
      createdAt: meta.createdAt,
      updatedAt: new Date().toISOString()
    };
    void window.sessions.save(session).then(setSessions).catch((error) => {
      // eslint-disable-next-line no-console
      console.error("sessions.save failed:", error);
    });
  }, []);

  const newSession = useCallback(() => {
    activeMetaRef.current = null;
    setActiveSessionId(null);
    setMessages([]);
    setStreamingId(null);
  }, []);

  // Stream events (registered once); routed to the assistant message by runId.
  useEffect(() => {
    const unsubscribe = window.agent.onEvent((event) => {
      if (event.type === "delta") {
        setMessages((current) =>
          current.map((message) =>
            message.id === event.runId ? { ...message, content: message.content + event.text } : message
          )
        );
        return;
      }
      if (event.type === "reasoning") {
        setMessages((current) =>
          current.map((message) =>
            message.id === event.runId
              ? { ...message, reasoning: (message.reasoning ?? "") + event.text }
              : message
          )
        );
        return;
      }
      if (event.type === "error") {
        setMessages((current) =>
          current.map((message) =>
            message.id === event.runId
              ? { ...message, content: message.content || `⚠️ ${event.message}` }
              : message
          )
        );
      }
      setStreamingId((current) => (current === event.runId ? null : current));
    });
    return unsubscribe;
  }, []);

  // Persist when a run finishes (streamingId falls back to null).
  useEffect(() => {
    const was = prevStreamingRef.current;
    prevStreamingRef.current = streamingId;
    if (was && !streamingId) {
      persistActive(messagesRef.current);
    }
  }, [streamingId, persistActive]);

  // Load this mode's sessions and reset to a draft when the mode changes.
  useEffect(() => {
    let active = true;
    window.sessions
      .list(mode)
      .then((list) => {
        if (active) {
          setSessions(list);
        }
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("sessions.list failed:", error);
      });
    newSession();
    return () => {
      active = false;
    };
  }, [mode, newSession]);

  const send = useCallback(
    (text: string, skills?: SkillRef[], thinking?: ThinkingOptions) => {
      const trimmed = text.trim();
      if (!trimmed || !model || streamingId) {
        return;
      }

      const userMessage: AgentMessage = {
        id: createId("user"),
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString()
      };
      const runId = createId("run");
      const assistantMessage: AgentMessage = {
        id: runId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString()
      };

      const history = [...messagesRef.current, userMessage];
      const nextMessages = [...history, assistantMessage];

      // Lazily create the session on the first message of a draft.
      if (!activeMetaRef.current) {
        const now = new Date().toISOString();
        const meta: ActiveMeta = { id: createId("session"), title: makeTitle(trimmed), createdAt: now, model };
        activeMetaRef.current = meta;
        setActiveSessionId(meta.id);
        persistActive(nextMessages);
      }

      setMessages(nextMessages);
      setStreamingId(runId);
      void window.agent.start({
        runId,
        messages: history,
        model,
        activeTab: mode,
        skills: skills && skills.length > 0 ? skills : undefined,
        thinking
      });
    },
    [model, mode, streamingId, persistActive]
  );

  const openSession = useCallback((id: string) => {
    void window.sessions
      .get(id)
      .then((session) => {
        if (!session) {
          return;
        }
        activeMetaRef.current = {
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          model: session.model
        };
        setActiveSessionId(session.id);
        setMessages(session.messages);
        setStreamingId(null);
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("sessions.get failed:", error);
      });
  }, []);

  const deleteSession = useCallback(
    (id: string) => {
      void window.sessions
        .delete(id, modeRef.current)
        .then((list) => {
          setSessions(list);
          if (activeMetaRef.current?.id === id) {
            newSession();
          }
        })
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.error("sessions.delete failed:", error);
        });
    },
    [newSession]
  );

  return {
    sessions,
    activeSessionId,
    messages,
    isStreaming: streamingId !== null,
    send,
    newSession,
    openSession,
    deleteSession
  };
};
