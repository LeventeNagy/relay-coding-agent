import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentMessage,
  Attachment,
  ChatSession,
  SessionSummary,
  ThinkingOptions,
  WebMode,
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
  /**
   * Plugin ids active in the current conversation, or `null` when the user
   * hasn't chosen — callers treat `null` as "use the connected-chat default".
   */
  activePluginIds: string[] | null;
  /** Set the active plugins for this conversation (persists if a session exists). */
  setActivePluginIds: (ids: string[]) => void;
  send: (
    text: string,
    skills?: SkillRef[],
    thinking?: ThinkingOptions,
    attachments?: Attachment[],
    webMode?: WebMode
  ) => void;
  /** Interrupt the in-flight run (Stop button); keeps the partial reply. */
  stop: () => void;
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
export const useSessions = (
  mode: WorkspaceMode,
  model: string | null,
  /** Connected, chat-scoped plugin ids — the default active set for new chats. */
  defaultPluginIds: string[]
): SessionsController => {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [activePluginIds, setActivePluginIdsState] = useState<string[] | null>(null);

  // Refs so the once-registered event handler and persistence effect see fresh values.
  const messagesRef = useRef<AgentMessage[]>([]);
  const activeMetaRef = useRef<ActiveMeta | null>(null);
  const modeRef = useRef<WorkspaceMode>(mode);
  const modelRef = useRef<string | null>(model);
  const prevStreamingRef = useRef<string | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const activePluginIdsRef = useRef<string[] | null>(null);
  const defaultPluginIdsRef = useRef<string[]>(defaultPluginIds);
  messagesRef.current = messages;
  modeRef.current = mode;
  modelRef.current = model;
  streamingIdRef.current = streamingId;
  activePluginIdsRef.current = activePluginIds;
  defaultPluginIdsRef.current = defaultPluginIds;

  /** The set actually used this run: explicit selection, or the connected default. */
  const resolvedPluginIds = (): string[] => activePluginIdsRef.current ?? defaultPluginIdsRef.current;

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
      // Persist the concrete set this conversation used (resolves the default).
      activePluginIds: resolvedPluginIds(),
      createdAt: meta.createdAt,
      updatedAt: new Date().toISOString()
    };
    void window.sessions.save(session).then(setSessions).catch((error) => {
      // eslint-disable-next-line no-console
      console.error("sessions.save failed:", error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setActivePluginIds = useCallback((ids: string[]) => {
    activePluginIdsRef.current = ids;
    setActivePluginIdsState(ids);
    // Persist immediately if the conversation already exists on disk.
    if (activeMetaRef.current) {
      persistActive(messagesRef.current);
    }
  }, [persistActive]);

  const stop = useCallback(() => {
    const runId = streamingIdRef.current;
    if (runId) {
      void window.agent.stop(runId);
    }
  }, []);

  const newSession = useCallback(() => {
    activeMetaRef.current = null;
    setActiveSessionId(null);
    setMessages([]);
    setStreamingId(null);
    activePluginIdsRef.current = null;
    setActivePluginIdsState(null);
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
      if (event.type === "progress") {
        setMessages((current) =>
          current.map((message) =>
            message.id === event.runId
              ? { ...message, progress: [...(message.progress ?? []), event.label] }
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
    (
      text: string,
      skills?: SkillRef[],
      thinking?: ThinkingOptions,
      attachments?: Attachment[],
      webMode?: WebMode
    ) => {
      const trimmed = text.trim();
      const hasAttachments = Boolean(attachments && attachments.length > 0);
      if ((!trimmed && !hasAttachments) || !model || streamingId) {
        return;
      }

      const userMessage: AgentMessage = {
        id: createId("user"),
        role: "user",
        content: trimmed,
        attachments: hasAttachments ? attachments : undefined,
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
        thinking,
        activePluginIds: resolvedPluginIds(),
        webMode
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // Restore the saved active set; legacy sessions (undefined) fall back to
        // the connected-chat default via `null`.
        const restored = session.activePluginIds ?? null;
        activePluginIdsRef.current = restored;
        setActivePluginIdsState(restored);
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
    activePluginIds,
    setActivePluginIds,
    send,
    stop,
    newSession,
    openSession,
    deleteSession
  };
};
