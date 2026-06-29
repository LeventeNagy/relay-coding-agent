import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AccessMode,
  AgentAnswer,
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

const EMPTY_MESSAGES: AgentMessage[] = [];

interface ActiveMeta {
  id: string;
  title: string;
  createdAt: string;
  model: string | null;
  projectId?: string;
}

type ContextInfo = { used: number; window: number; compacted: boolean };

/**
 * One conversation's live state. Every session the user has opened or started a
 * run in lives here, keyed by session id — so a run keeps streaming and persists
 * even while the user is viewing a *different* session. The mode is captured at
 * creation so a background run finishing after a mode switch still saves under
 * its own mode.
 */
interface ConvState {
  mode: WorkspaceMode;
  meta: ActiveMeta;
  messages: AgentMessage[];
  /** The runId currently streaming into this conversation, or null when idle. */
  streamingRunId: string | null;
  contextInfo: ContextInfo | null;
  /** Plugin ids chosen for this conversation; null = use the connected default. */
  pluginIds: string[] | null;
}

export interface SessionsController {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  messages: AgentMessage[];
  isStreaming: boolean;
  /** Every session id with an in-flight run (for a "working" indicator in the list). */
  streamingSessionIds: string[];
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
    webMode?: WebMode,
    accessMode?: AccessMode,
    planMode?: boolean
  ) => void;
  /** Interrupt the active conversation's in-flight run (Stop button); keeps the partial reply. */
  stop: () => void;
  /** Answer a pending code-mode approval request, then clear the prompt. */
  approve: (approvalId: string, approved: boolean) => void;
  /** Submit answers to a pending clickable-question request, then clear it. */
  answer: (requestId: string, answers: AgentAnswer[]) => void;
  /** Active conversation's context usage (server truth) for the meter; null until a run reports. */
  contextInfo: ContextInfo | null;
  newSession: () => void;
  openSession: (id: string) => void;
  deleteSession: (id: string) => void;
}

/**
 * Owns every conversation for one workspace mode plus its persistence.
 *
 * Conversations run in parallel: each `send()` starts an independent backend run
 * (its own runId) and the per-session store keeps that run streaming and saving
 * regardless of which session is on screen. Stream events are routed to the
 * owning session via a runId→sessionId map, so switching away never stops a run.
 *
 * Sessions are created lazily: `newSession()` only clears the view to a draft; a
 * session record is created and saved on the FIRST `send()`, then re-saved on
 * every turn and whenever a run finishes.
 */
export const useSessions = (
  mode: WorkspaceMode,
  model: string | null,
  /** Connected, eligible plugin ids — the default active set for new chats. */
  defaultPluginIds: string[],
  /** Code mode: the project a new chat belongs to (stamped on the session). */
  projectId?: string | null
): SessionsController => {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [convs, setConvs] = useState<Record<string, ConvState>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draftPluginIds, setDraftPluginIds] = useState<string[] | null>(null);

  // Refs so the once-registered event handler and callbacks see fresh values.
  const convsRef = useRef<Record<string, ConvState>>(convs);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  const draftPluginIdsRef = useRef<string[] | null>(draftPluginIds);
  const modeRef = useRef<WorkspaceMode>(mode);
  const modelRef = useRef<string | null>(model);
  const defaultPluginIdsRef = useRef<string[]>(defaultPluginIds);
  const projectIdRef = useRef<string | null | undefined>(projectId);
  // runId → owning session id, so stream events land in the right conversation.
  const runToSessionRef = useRef<Map<string, string>>(new Map());
  // Per-session streaming snapshot, to detect a run finishing (→ persist).
  const prevStreamingRef = useRef<Record<string, string | null>>({});
  convsRef.current = convs;
  activeSessionIdRef.current = activeSessionId;
  draftPluginIdsRef.current = draftPluginIds;
  modeRef.current = mode;
  modelRef.current = model;
  defaultPluginIdsRef.current = defaultPluginIds;
  projectIdRef.current = projectId;

  const persistConv = useCallback((conv: ConvState) => {
    const session: ChatSession = {
      id: conv.meta.id,
      title: conv.meta.title,
      mode: conv.mode,
      model: conv.meta.model ?? modelRef.current,
      projectId: conv.meta.projectId,
      // Drop transient prompt state so a reload never re-shows a dead approval/
      // question form, and so the in-progress turn is safely saved.
      messages: conv.messages.map((m) =>
        m.pendingApproval || m.pendingQuestions
          ? { ...m, pendingApproval: undefined, pendingQuestions: undefined }
          : m
      ),
      // Persist the concrete set this conversation used (resolves the default).
      activePluginIds: conv.pluginIds ?? defaultPluginIdsRef.current,
      createdAt: conv.meta.createdAt,
      updatedAt: new Date().toISOString()
    };
    void window.sessions
      .save(session)
      .then((list) => {
        // saveSession returns the list for *its* mode; only adopt it if it's the
        // mode we're currently viewing, so a background run finishing in the
        // other mode never clobbers the visible list.
        if (conv.mode === modeRef.current) {
          setSessions(list);
        }
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("sessions.save failed:", error);
      });
  }, []);

  /** Update the streaming message (by runId) inside its owning conversation. */
  const updateRunMessage = useCallback(
    (runId: string, updater: (message: AgentMessage) => AgentMessage) => {
      const sid = runToSessionRef.current.get(runId);
      if (!sid) {
        return;
      }
      setConvs((prev) => {
        const conv = prev[sid];
        if (!conv) {
          return prev;
        }
        return {
          ...prev,
          [sid]: { ...conv, messages: conv.messages.map((m) => (m.id === runId ? updater(m) : m)) }
        };
      });
    },
    []
  );

  // Stream events (registered once); routed to the owning session by runId.
  useEffect(() => {
    const unsubscribe = window.agent.onEvent((event) => {
      switch (event.type) {
        case "delta":
          updateRunMessage(event.runId, (m) => ({ ...m, content: m.content + event.text }));
          break;
        case "reasoning":
          updateRunMessage(event.runId, (m) => ({ ...m, reasoning: (m.reasoning ?? "") + event.text }));
          break;
        case "progress":
          updateRunMessage(event.runId, (m) => ({ ...m, progress: [...(m.progress ?? []), event.label] }));
          break;
        case "approval":
          updateRunMessage(event.runId, (m) => ({
            ...m,
            pendingApproval: {
              approvalId: event.approvalId,
              tool: event.tool,
              summary: event.summary,
              detail: event.detail
            }
          }));
          break;
        case "questions":
          updateRunMessage(event.runId, (m) => ({
            ...m,
            pendingQuestions: { requestId: event.requestId, questions: event.questions }
          }));
          break;
        case "error":
          updateRunMessage(event.runId, (m) => ({
            ...m,
            content: m.content || `⚠️ ${event.message}`,
            pendingApproval: undefined,
            pendingQuestions: undefined
          }));
          break;
        case "done":
          updateRunMessage(event.runId, (m) => ({
            ...m,
            pendingApproval: undefined,
            pendingQuestions: undefined
          }));
          break;
        case "context": {
          const sid = runToSessionRef.current.get(event.runId);
          if (sid) {
            setConvs((prev) =>
              prev[sid]
                ? {
                    ...prev,
                    [sid]: {
                      ...prev[sid],
                      contextInfo: { used: event.used, window: event.window, compacted: event.compacted }
                    }
                  }
                : prev
            );
          }
          break;
        }
      }

      // A finished run clears the conversation's streaming flag; persistence is
      // handled by the effect below once the final messages have committed.
      if (event.type === "done" || event.type === "error") {
        const sid = runToSessionRef.current.get(event.runId);
        if (sid) {
          setConvs((prev) => {
            const conv = prev[sid];
            if (!conv || conv.streamingRunId !== event.runId) {
              return prev;
            }
            return { ...prev, [sid]: { ...conv, streamingRunId: null } };
          });
        }
        runToSessionRef.current.delete(event.runId);
      }
    });
    return unsubscribe;
  }, [updateRunMessage]);

  // Persist a conversation the moment its run finishes (streaming → null), using
  // the committed messages. Mirrors per-conversation streaming state across renders.
  useEffect(() => {
    const snapshot: Record<string, string | null> = {};
    for (const [sid, conv] of Object.entries(convs)) {
      const was = prevStreamingRef.current[sid];
      if (was && !conv.streamingRunId) {
        persistConv(conv);
      }
      snapshot[sid] = conv.streamingRunId;
    }
    prevStreamingRef.current = snapshot;
  }, [convs, persistConv]);

  const setActivePluginIds = useCallback(
    (ids: string[]) => {
      const sid = activeSessionIdRef.current;
      if (sid && convsRef.current[sid]) {
        setConvs((prev) => (prev[sid] ? { ...prev, [sid]: { ...prev[sid], pluginIds: ids } } : prev));
        persistConv({ ...convsRef.current[sid], pluginIds: ids });
      } else {
        draftPluginIdsRef.current = ids;
        setDraftPluginIds(ids);
      }
    },
    [persistConv]
  );

  const stop = useCallback(() => {
    const sid = activeSessionIdRef.current;
    const runId = sid ? convsRef.current[sid]?.streamingRunId : null;
    if (runId) {
      void window.agent.stop(runId);
    }
  }, []);

  const approve = useCallback((approvalId: string, approved: boolean) => {
    void window.agent.approve(approvalId, approved);
    // Optimistically clear the prompt wherever it lives (active conv in practice).
    setConvs((prev) => {
      const next: Record<string, ConvState> = {};
      let changed = false;
      for (const [sid, conv] of Object.entries(prev)) {
        if (conv.messages.some((m) => m.pendingApproval?.approvalId === approvalId)) {
          next[sid] = {
            ...conv,
            messages: conv.messages.map((m) =>
              m.pendingApproval?.approvalId === approvalId ? { ...m, pendingApproval: undefined } : m
            )
          };
          changed = true;
        } else {
          next[sid] = conv;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const answer = useCallback((requestId: string, answers: AgentAnswer[]) => {
    void window.agent.answer(requestId, answers);
    setConvs((prev) => {
      const next: Record<string, ConvState> = {};
      let changed = false;
      for (const [sid, conv] of Object.entries(prev)) {
        if (conv.messages.some((m) => m.pendingQuestions?.requestId === requestId)) {
          next[sid] = {
            ...conv,
            messages: conv.messages.map((m) =>
              m.pendingQuestions?.requestId === requestId ? { ...m, pendingQuestions: undefined } : m
            )
          };
          changed = true;
        } else {
          next[sid] = conv;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const newSession = useCallback(() => {
    setActiveSessionId(null);
    activeSessionIdRef.current = null;
    draftPluginIdsRef.current = null;
    setDraftPluginIds(null);
  }, []);

  const send = useCallback(
    (
      text: string,
      skills?: SkillRef[],
      thinking?: ThinkingOptions,
      attachments?: Attachment[],
      webMode?: WebMode,
      accessMode?: AccessMode,
      planMode?: boolean
    ) => {
      const trimmed = text.trim();
      const hasAttachments = Boolean(attachments && attachments.length > 0);
      const model = modelRef.current;
      const sid = activeSessionIdRef.current;
      const activeConv = sid ? convsRef.current[sid] : undefined;
      // Block only the active conversation while it streams; others run in parallel.
      if ((!trimmed && !hasAttachments) || !model || activeConv?.streamingRunId) {
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

      // Resolve the target conversation: the active session, or a fresh one
      // (created lazily from the draft on the first message).
      let meta: ActiveMeta;
      let baseMessages: AgentMessage[];
      let pluginIds: string[] | null;
      if (sid && activeConv) {
        meta = activeConv.meta;
        baseMessages = activeConv.messages;
        pluginIds = activeConv.pluginIds;
      } else {
        const now = new Date().toISOString();
        meta = {
          id: createId("session"),
          title: makeTitle(trimmed),
          createdAt: now,
          model,
          projectId: projectIdRef.current ?? undefined
        };
        baseMessages = [];
        pluginIds = draftPluginIdsRef.current;
        setActiveSessionId(meta.id);
        activeSessionIdRef.current = meta.id;
        draftPluginIdsRef.current = null;
        setDraftPluginIds(null);
      }

      const targetSid = meta.id;
      const history = [...baseMessages, userMessage];
      const nextMessages = [...history, assistantMessage];
      const resolvedPluginIds = pluginIds ?? defaultPluginIdsRef.current;

      runToSessionRef.current.set(runId, targetSid);
      const conv: ConvState = {
        mode: modeRef.current,
        meta,
        messages: nextMessages,
        streamingRunId: runId,
        contextInfo: convsRef.current[targetSid]?.contextInfo ?? null,
        pluginIds
      };
      setConvs((prev) => ({ ...prev, [targetSid]: conv }));
      // Persist the user's turn immediately so a crash or reload never loses it.
      persistConv(conv);

      void window.agent.start({
        runId,
        sessionId: targetSid,
        messages: history,
        model,
        activeTab: modeRef.current,
        skills: skills && skills.length > 0 ? skills : undefined,
        thinking,
        activePluginIds: resolvedPluginIds,
        webMode,
        projectId: meta.projectId,
        accessMode,
        planMode
      });
    },
    [persistConv]
  );

  const openSession = useCallback((id: string) => {
    // Already live (possibly streaming) — just switch the view, don't clobber it.
    if (convsRef.current[id]) {
      setActiveSessionId(id);
      activeSessionIdRef.current = id;
      return;
    }
    void window.sessions
      .get(id)
      .then((session) => {
        if (!session) {
          return;
        }
        const conv: ConvState = {
          mode: session.mode,
          meta: {
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            model: session.model,
            projectId: session.projectId
          },
          messages: session.messages,
          streamingRunId: null,
          contextInfo: null,
          // Restore the saved active set; legacy sessions (undefined) fall back to
          // the connected default via `null`.
          pluginIds: session.activePluginIds ?? null
        };
        setConvs((prev) => ({ ...prev, [id]: conv }));
        setActiveSessionId(id);
        activeSessionIdRef.current = id;
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
          setConvs((prev) => {
            if (!prev[id]) {
              return prev;
            }
            const next = { ...prev };
            delete next[id];
            return next;
          });
          if (activeSessionIdRef.current === id) {
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

  // Load this mode's sessions and reset to a draft when the mode changes. Live
  // conversations (including running ones from the other mode) are kept in the
  // store so their runs keep streaming and persisting across a mode switch.
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

  const active = activeSessionId ? convs[activeSessionId] : undefined;
  const streamingSessionIds = Object.entries(convs)
    .filter(([, conv]) => conv.streamingRunId !== null)
    .map(([sid]) => sid);

  return {
    sessions,
    activeSessionId,
    messages: active?.messages ?? EMPTY_MESSAGES,
    isStreaming: Boolean(active?.streamingRunId),
    streamingSessionIds,
    activePluginIds: active ? active.pluginIds : draftPluginIds,
    setActivePluginIds,
    contextInfo: active?.contextInfo ?? null,
    send,
    stop,
    approve,
    answer,
    newSession,
    openSession,
    deleteSession
  };
};
