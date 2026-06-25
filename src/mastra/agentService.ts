import { Agent } from "@mastra/core/agent";
import type { AgentMessage, AgentStreamEvent, WorkspaceMode } from "../shared/agent/types";

const createId = (): string => {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const instructionsFor = (mode: WorkspaceMode): string => {
  const base =
    "You are Relay, an open-source coding agent. Be concise, technical, and action-oriented. " +
    "Prefer concrete steps, file paths, and code over prose.";
  switch (mode) {
    case "code":
      return `${base} You are in CODE mode: focus on implementation, edits, and verification steps.`;
    default:
      return `${base} You are in CHAT mode: help the user think through their product and engineering questions.`;
  }
};

const toModelMessages = (messages: AgentMessage[]) => {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) =>
      message.role === "assistant"
        ? { role: "assistant" as const, content: message.content }
        : { role: "user" as const, content: message.content }
    );
};

export interface StreamArgs {
  runId: string;
  model: string;
  activeTab: WorkspaceMode;
  messages: AgentMessage[];
  onEvent: (event: AgentStreamEvent) => void;
}

/**
 * Streams a Mastra agent reply for a single run, emitting delta/done/error
 * events. API keys are expected to already be present in process.env (the
 * settings store injects them) so the Mastra model router can authenticate.
 */
export const streamMessage = async ({ runId, model, activeTab, messages, onEvent }: StreamArgs): Promise<void> => {
  try {
    const agent = new Agent({
      id: "relay",
      name: "relay",
      instructions: instructionsFor(activeTab),
      model
    });

    const result = await agent.stream(toModelMessages(messages));

    let full = "";
    for await (const delta of result.textStream) {
      if (!delta) {
        continue;
      }
      full += delta;
      onEvent({ type: "delta", runId, text: delta });
    }

    if (!full) {
      // No text streamed (e.g. model returned only tool calls); fall back to the
      // resolved final text so the UI still receives content.
      full = await result.text;
      if (full) {
        onEvent({ type: "delta", runId, text: full });
      }
    }

    onEvent({ type: "done", runId, text: full });
  } catch (error) {
    onEvent({ type: "error", runId, message: describeAgentError(error) });
  }
};

/**
 * AI SDK API errors set `message` to a generic "Provider returned error"; the
 * useful text (rate-limit notes, auth failures, retry hints) lives in the
 * provider's response body. Pull that out and prefix the HTTP status.
 */
const describeAgentError = (error: unknown): string => {
  const err = error as {
    statusCode?: number;
    responseBody?: string;
    message?: string;
    data?: { error?: { message?: string; metadata?: { raw?: string } } };
  };

  const fromBody = (): string | undefined => {
    const raw = err?.data?.error?.metadata?.raw;
    if (typeof raw === "string" && raw.trim()) {
      return raw;
    }
    const dataMessage = err?.data?.error?.message;
    if (typeof dataMessage === "string" && dataMessage.trim()) {
      return dataMessage;
    }
    if (typeof err?.responseBody === "string") {
      try {
        const body = JSON.parse(err.responseBody) as { error?: { message?: string; metadata?: { raw?: string } } };
        return body?.error?.metadata?.raw ?? body?.error?.message ?? undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  };

  const detail = fromBody() ?? (typeof err?.message === "string" ? err.message : "Unknown agent error.");
  return typeof err?.statusCode === "number" ? `[${err.statusCode}] ${detail}` : detail;
};

export const newMessage = (role: AgentMessage["role"], content: string): AgentMessage => ({
  id: createId(),
  role,
  content,
  createdAt: new Date().toISOString()
});
