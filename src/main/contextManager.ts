import { Agent } from "@mastra/core/agent";
import type { AgentMessage } from "../shared/agent/types";
import { contextWindowFor } from "../shared/agent/contextWindows";
import { estimateConversationTokens } from "../shared/agent/tokens";
import { getCompaction, setCompaction } from "./contextStore";

/**
 * Keeps a conversation within the active model's context window. When the
 * history is too large it folds the oldest turns into a running summary (one
 * model call, cached per session), keeps the recent tail verbatim, and — only as
 * a last resort — truncates an oversized single message. The summary is returned
 * separately so the caller can inject it into the system instructions.
 */

/** Messages at the end we never compact (the immediate thread stays verbatim). */
const KEEP_TAIL = 6;

export interface PreparedContext {
  /** Recent messages to send to the model (oldest turns folded into `summary`). */
  recentMessages: AgentMessage[];
  /** Running summary of everything before `recentMessages`, or "" if none. */
  summary: string;
  /** Estimated tokens of what will be sent (summary + recent). */
  used: number;
  /** The model's context window. */
  window: number;
  /** True when any history was folded into the summary (or trimmed). */
  compacted: boolean;
}

/** Render a slice of messages as a plain transcript for the summarizer. */
const transcript = (messages: AgentMessage[]): string =>
  messages
    .map((m) => {
      const docs = (m.attachments ?? [])
        .map((a) => (a.kind === "document" && a.text ? `\n[document ${a.name}]: ${a.text}` : a.kind === "image" ? "\n[image attachment]" : ""))
        .join("");
      return `${m.role.toUpperCase()}: ${m.content}${docs}`;
    })
    .join("\n\n");

/** Merge the prior summary + a chunk of older messages into one concise summary. */
const summarizeChunk = async (
  model: string,
  priorSummary: string,
  chunk: AgentMessage[]
): Promise<string> => {
  const agent = new Agent({
    id: "relay-compactor",
    name: "relay-compactor",
    instructions:
      "You compress conversation history faithfully and concisely. Preserve facts, " +
      "decisions, names, identifiers, file/code references, numbers, and any open questions " +
      "or TODOs. Use compact bullet points. Do not add commentary or invent details.",
    model
  });
  const prompt =
    "Merge the EXISTING SUMMARY and the NEW MESSAGES into a single updated summary of the " +
    "conversation so far. Keep it concise but complete enough that the assistant can continue " +
    "seamlessly.\n\n" +
    `EXISTING SUMMARY:\n${priorSummary || "(none yet)"}\n\n` +
    `NEW MESSAGES:\n${transcript(chunk)}`;
  const result = (await agent.generate(prompt)) as { text?: string };
  return (result.text ?? priorSummary).trim();
};

/** Truncate message text from the oldest first until the budget fits (last resort). */
const hardTrim = (messages: AgentMessage[], summary: string, usable: number): AgentMessage[] => {
  const out = messages.map((m) => ({ ...m }));
  let used = estimateConversationTokens(out, summary);
  for (const message of out) {
    if (used <= usable) {
      break;
    }
    const overflowChars = (used - usable) * 4; // ~4 chars/token
    if (message.content.length > 200) {
      const keep = Math.max(200, message.content.length - overflowChars);
      if (keep < message.content.length) {
        message.content = `${message.content.slice(0, keep)}\n…[truncated to fit the context window]`;
        // Drop heavy document text too once we're trimming this message.
        message.attachments = message.attachments?.map((a) =>
          a.kind === "document" ? { ...a, text: undefined } : a
        );
        used = estimateConversationTokens(out, summary);
      }
    }
  }
  return out;
};

/**
 * Prepare the history to send for one run, compacting if needed. Never throws —
 * on a summarizer failure it falls back to dropping the oldest turns so the run
 * still succeeds.
 */
export const prepareHistory = async (args: {
  sessionId?: string;
  model: string;
  messages: AgentMessage[];
  onProgress?: (label: string) => void;
}): Promise<PreparedContext> => {
  const { sessionId, model, messages, onProgress } = args;
  const window = contextWindowFor(model);
  const reserve = Math.max(2048, Math.floor(window * 0.1));
  const usable = Math.floor(window * 0.85) - reserve;

  const stored = sessionId ? getCompaction(sessionId) : undefined;
  let summary = stored?.summary ?? "";
  // Clamp a stale pointer so we always keep the recent tail.
  let compactedCount = Math.min(stored?.compactedCount ?? 0, Math.max(0, messages.length - KEEP_TAIL));

  let active = messages.slice(compactedCount);
  let used = estimateConversationTokens(active, summary);

  // Fast path: it already fits.
  if (used <= usable) {
    return { recentMessages: active, summary, used, window, compacted: compactedCount > 0 };
  }

  let changed = false;
  let announced = false;
  while (used > usable && active.length > KEEP_TAIL) {
    const compactable = active.length - KEEP_TAIL;
    const chunkSize = Math.max(2, Math.ceil(compactable / 2));
    const chunk = active.slice(0, chunkSize);
    if (!announced) {
      onProgress?.("Compacting earlier context to fit the model's window…");
      announced = true;
    }
    try {
      summary = await summarizeChunk(model, summary, chunk);
    } catch (error) {
      // Summarizer failed — drop the chunk instead so the run still succeeds.
      console.error("[relay] context compaction failed; trimming instead:", error);
    }
    compactedCount += chunkSize;
    changed = true;
    active = messages.slice(compactedCount);
    used = estimateConversationTokens(active, summary);
  }

  // Last resort: even summary + tail is too big (one giant message) → truncate.
  if (used > usable) {
    active = hardTrim(active, summary, usable);
    used = estimateConversationTokens(active, summary);
    changed = true;
  }

  if (changed && sessionId) {
    setCompaction(sessionId, { summary, compactedCount });
  }

  return { recentMessages: active, summary, used, window, compacted: true };
};
