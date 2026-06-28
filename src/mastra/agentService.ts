import { Agent } from "@mastra/core/agent";
import type { AgentMessage, AgentStreamEvent, WebMode, WorkspaceMode } from "../shared/agent/types";

const createId = (): string => {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const instructionsFor = (mode: WorkspaceMode): string => {
  const base =
    "You are Relay, an open-source coding agent. Be concise, technical, and action-oriented. " +
    "Prefer concrete steps, file paths, and code over prose. " +
    "Format every response in GitHub-Flavored Markdown. Put ALL code, files, or terminal output " +
    "in fenced code blocks with a language tag (```ts, ```html, ```bash, ```markdown); never paste " +
    "raw HTML or code outside a fenced block. Use headings, bold, and lists to keep answers structured.";
  switch (mode) {
    case "code":
      return `${base} You are in CODE mode: focus on implementation, edits, and verification steps.`;
    default:
      return `${base} You are in CHAT mode: help the user think through their product and engineering questions.`;
  }
};

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mimeType: string };

/** Build a user turn's content: text + image parts + inlined document text. */
const userContent = (message: AgentMessage): string | ContentPart[] => {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) {
    return message.content;
  }
  const parts: ContentPart[] = [];
  if (message.content) {
    parts.push({ type: "text", text: message.content });
  }
  for (const att of attachments) {
    if (att.kind === "image" && att.imageBase64) {
      // Pass raw base64 + an explicit mime; a full data URI makes the AI SDK
      // mis-sniff the media type, which strict vision endpoints reject.
      parts.push({ type: "image", image: att.imageBase64, mimeType: att.mimeType });
    } else if (att.kind === "document" && att.text) {
      parts.push({ type: "text", text: `Attached document "${att.name}":\n\n${att.text}` });
    }
  }
  return parts.length > 0 ? parts : message.content;
};

const toModelMessages = (messages: AgentMessage[]) => {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) =>
      message.role === "assistant"
        ? { role: "assistant" as const, content: message.content }
        : { role: "user" as const, content: userContent(message) }
    );
};

export interface StreamArgs {
  runId: string;
  model: string;
  activeTab: WorkspaceMode;
  messages: AgentMessage[];
  /** Namespaced MCP toolsets to inject for this run (from mcpManager). */
  toolsets?: Record<string, Record<string, unknown>>;
  /** Relay's own always-on tools (install_skill, fetch_url, …). */
  tools?: Record<string, unknown>;
  /** Reasoning controls for capable models (Z.AI / GLM). */
  thinking?: { enabled: boolean; effort?: string };
  /** Skills referenced this turn; appended to the system instructions. */
  skills?: Array<{ name: string; instructions: string }>;
  /** Web augmentation for this turn: quick search or deep research. */
  webMode?: WebMode;
  /** Aborts the run when the user hits Stop; partial text is kept. */
  abortSignal?: AbortSignal;
  onEvent: (event: AgentStreamEvent) => void;
}

/** Collect the flat list of tool names across all namespaced toolsets. */
const toolNamesFromToolsets = (
  toolsets?: Record<string, Record<string, unknown>>
): string[] => {
  if (!toolsets) {
    return [];
  }
  return Object.values(toolsets).flatMap((tools) => Object.keys(tools));
};

/** Human-readable current date, so the model anchors "latest/now" to the present. */
const currentDateString = (): string =>
  new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

/** Web-augmentation brief appended to the system prompt for search/research runs. */
const webModeBrief = (webMode: WebMode): string => {
  const recency =
    `Today is ${currentDateString()}. Treat this as the present. Prioritize the most ` +
    "recent information: when freshness matters, put the CURRENT year in your search queries " +
    "(not an older year from memory), prefer sources from the last several months, and never " +
    "present older data as if it were current. If sources conflict on recency, trust the newest.";
  if (webMode === "research") {
    return (
      "\n\n## Research mode\n" +
      `${recency}\n\n` +
      "The user wants a thorough, well-researched answer. Work like a research analyst:\n" +
      "1. Break the question into sub-topics.\n" +
      "2. Use `web_search` several times with varied, specific queries (use depth 'advanced').\n" +
      "3. Open the most relevant results with `fetch_url` and read them; cross-check claims " +
      "across multiple independent sources.\n" +
      "4. Then write a clear, well-structured report (headings, lists where useful) that " +
      "synthesizes the findings — not a list of links.\n" +
      "Cite sources inline as [1], [2]… and end with a `## Sources` section listing each as " +
      "a `[Title](url)` markdown link. Prefer primary/authoritative sources and note any " +
      "disagreement or uncertainty."
    );
  }
  return (
    "\n\n## Web search mode\n" +
    `${recency}\n\n` +
    "Answer using current information from the web. Use `web_search` (and `fetch_url` to read " +
    "the best result when the snippet isn't enough), then give a concise, direct answer. Cite " +
    "sources inline as [1], [2]… and end with a short `## Sources` list of `[Title](url)` links."
  );
};

/** Compose mode instructions with referenced skills, plugin tools, and web mode. */
const composeInstructions = (
  mode: WorkspaceMode,
  skills?: Array<{ name: string; instructions: string }>,
  toolNames?: string[],
  webMode?: WebMode
): string => {
  let out = instructionsFor(mode);
  // The model has no clock; without this it anchors "latest/current" to its
  // training cutoff and surfaces stale (e.g. 2024/2025) info as if it were now.
  out += `\n\nThe current date is ${currentDateString()}. Use it as the present when judging what is current or "latest"; your own training data may be out of date.`;
  // Tell the model which plugin tools it actually has, so it calls them instead
  // of guessing. Weaker tool-callers ignore tools they're not told about.
  if (toolNames && toolNames.length > 0) {
    out +=
      `\n\nYou have these connected plugin tools available: ${toolNames.join(", ")}. ` +
      "When the user's request needs one (e.g. searching Notion, creating a Linear issue), " +
      "call the tool instead of guessing or saying you can't.";
  }
  if (webMode) {
    out += webModeBrief(webMode);
  }
  if (skills && skills.length > 0) {
    const blocks = skills
      .map((skill) => `## Skill: ${skill.name}\n${skill.instructions}`)
      .join("\n\n");
    out += `\n\nThe user invoked the following skill(s) for this request. Follow their guidance:\n\n${blocks}`;
  }
  return out;
};

/**
 * Streams a Mastra agent reply for a single run, emitting delta/done/error
 * events. API keys are expected to already be present in process.env (the
 * settings store injects them) so the Mastra model router can authenticate.
 */
export const streamMessage = async ({
  runId,
  model,
  activeTab,
  messages,
  toolsets,
  tools,
  thinking,
  skills,
  webMode,
  abortSignal,
  onEvent
}: StreamArgs): Promise<void> => {
  const toolNames = tools ? Object.keys(tools) : [];

  // Idle watchdog: reasoning models (e.g. glm-5.2) emit "thinking" tokens before
  // any text and can take >60s to first text. We read the *full* stream and reset
  // this timer on EVERY chunk (reasoning, tool-call, text), so it only fires on
  // genuine silence — never mid-thought — and we don't discard a late answer.
  const IDLE_MS = 120_000;
  let settled = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const emit = (streamEvent: AgentStreamEvent): void => {
    if (!settled) {
      onEvent(streamEvent);
    }
  };
  const fail = (message: string): void => {
    if (!settled) {
      settled = true;
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      onEvent({ type: "error", runId, message });
    }
  };
  const armIdle = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      console.error(`[relay] watchdog fired — no stream activity in ${IDLE_MS / 1000}s`);
      fail(
        `The model produced no output for ${IDLE_MS / 1000}s and was given up on. ` +
          "It may be overloaded or unreachable — try again or pick another model."
      );
    }, IDLE_MS);
  };

  type FullChunk = {
    type: string;
    payload?: {
      text?: string;
      error?: unknown;
      // tool-call chunks: name + args (shape varies across AI SDK / Mastra versions).
      toolName?: string;
      args?: Record<string, unknown>;
      input?: Record<string, unknown>;
    };
  };

  /** Turn a web_search/fetch_url tool-call into a human "Searching…/Reading…" line. */
  const progressLabel = (chunk: FullChunk): string | null => {
    const name = chunk.payload?.toolName;
    const args = chunk.payload?.args ?? chunk.payload?.input ?? {};
    if (name === "web_search") {
      const query = typeof args.query === "string" ? args.query : "";
      return query ? `Searching "${query}"` : "Searching the web…";
    }
    if (name === "fetch_url") {
      const url = typeof args.url === "string" ? args.url : "";
      try {
        return url ? `Reading ${new URL(url).hostname}` : "Reading a page…";
      } catch {
        return "Reading a page…";
      }
    }
    // A tool-call we couldn't identify (older chunk shape) — still show activity
    // during a web run so the user sees something is happening.
    return name ? `Running ${name}…` : webMode ? "Searching the web…" : null;
  };

  // Hoisted so the catch can flush partial text when the run is aborted (Stop).
  let full = "";

  try {
    const pluginToolNames = toolNamesFromToolsets(toolsets);
    const agent = new Agent({
      id: "relay",
      name: "relay",
      instructions: composeInstructions(activeTab, skills, pluginToolNames, webMode),
      model,
      ...(tools ? { tools: tools as never } : {})
    });

    const hasToolsets = Boolean(toolsets && Object.keys(toolsets).length > 0);
    const modelMessages = toModelMessages(messages);

    // Bound the agentic loop so a misbehaving model can't spin tool calls forever.
    // Research/search runs need more room for repeated search → read → synthesize.
    const maxSteps = webMode === "research" ? 18 : webMode === "search" ? 12 : 8;
    const streamOptions: Record<string, unknown> = { maxSteps };
    if (hasToolsets) {
      streamOptions.toolsets = toolsets;
    }
    // Let the Stop button cancel the upstream request, not just our reading.
    if (abortSignal) {
      streamOptions.abortSignal = abortSignal;
    }

    // Pass reasoning controls as provider options, namespaced by the model's
    // provider slug. Mastra's OpenAI-compatible model maps `reasoningEffort` to
    // `reasoning_effort` and spreads `thinking` verbatim into the request body.
    if (thinking) {
      const slug = model.split("/")[0];
      streamOptions.providerOptions = {
        [slug]: {
          thinking: { type: thinking.enabled ? "enabled" : "disabled" },
          ...(thinking.enabled && thinking.effort ? { reasoningEffort: thinking.effort } : {})
        }
      };
    }

    console.log(
      `[relay] stream start model=${model} nativeTools=[${toolNames.join(",")}] toolsets=${hasToolsets}`
    );
    const result = await agent.stream(modelMessages, streamOptions as never);
    armIdle();

    let firstText = true;
    let reasoningChars = 0;
    const fullStream = (result as { fullStream: AsyncIterable<FullChunk> }).fullStream;
    for await (const chunk of fullStream) {
      armIdle(); // any activity (incl. reasoning) keeps the run alive
      if (settled) {
        break;
      }
      if (abortSignal?.aborted) {
        // User hit Stop: leave the loop and flush whatever we have as "done".
        break;
      }
      switch (chunk.type) {
        case "text-delta": {
          const text = chunk.payload?.text ?? "";
          if (text) {
            if (firstText) {
              console.log(`[relay] first text delta (after ${reasoningChars} reasoning chars)`);
              firstText = false;
            }
            full += text;
            emit({ type: "delta", runId, text });
          }
          break;
        }
        case "reasoning-delta": {
          // Stream reasoning to the UI's Thinking panel (also keeps the run alive).
          const text = chunk.payload?.text ?? "";
          if (text) {
            reasoningChars += text.length;
            emit({ type: "reasoning", runId, text });
          }
          break;
        }
        case "tool-call": {
          console.log("[relay] tool-call chunk");
          // Surface live "Searching…/Reading…" steps only during web/research runs.
          if (webMode) {
            const label = progressLabel(chunk);
            if (label) {
              emit({ type: "progress", runId, label });
            }
          }
          break;
        }
        case "error": {
          const errText =
            chunk.payload?.error instanceof Error
              ? chunk.payload.error.message
              : String(chunk.payload?.error ?? "stream error");
          fail(errText);
          break;
        }
        default:
          break;
      }
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
    }

    if (settled) {
      return;
    }

    if (!full && !abortSignal?.aborted) {
      // No text streamed (e.g. tool-only turn); fall back to the resolved text.
      console.log("[relay] no text streamed; awaiting result.text");
      full = await result.text;
      if (full) {
        emit({ type: "delta", runId, text: full });
      }
    }

    console.log(`[relay] stream done chars=${full.length} reasoning=${reasoningChars}`);
    emit({ type: "done", runId, text: full });
    settled = true;
  } catch (error) {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    // An abort (Stop button) surfaces here as a thrown AbortError — that's a
    // clean stop, not a failure: flush the partial text as "done".
    if (abortSignal?.aborted) {
      if (!settled) {
        console.log(`[relay] stream stopped by user chars=${full.length}`);
        emit({ type: "done", runId, text: full });
        settled = true;
      }
      return;
    }
    console.error("[relay] stream error:", error);
    fail(describeAgentError(error));
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
