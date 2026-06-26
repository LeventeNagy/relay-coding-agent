import { ReactElement, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Mic,
  Plus,
  Search,
  SendHorizontal,
  SlidersHorizontal,
  Sparkles
} from "lucide-react";
import { buildProviderGroups, reasoningCapsFor } from "../../shared/agent/providers";
import type { ThinkingOptions } from "../../shared/agent/types";
import { Conversation, ConversationContent } from "../components/ai-elements/conversation";
import { Message, MessageContent } from "../components/ai-elements/message";
import { Response } from "../components/ai-elements/response";
import { useProviderModels } from "../hooks/useProviderModels";
import type { SessionsController } from "../hooks/useSessions";
import type { SettingsController } from "../hooks/useSettings";
import type { SkillsController } from "../hooks/useSkills";
import type { Skill, SkillRef } from "../../shared/skills/types";
import type { WorkspaceMode } from "../../shared/agent/types";

interface ChatViewProps {
  chat: SessionsController;
  settings: SettingsController;
  skills: SkillsController;
  mode: WorkspaceMode;
  modeLabel: string;
}

const MODEL_RESULT_LIMIT = 60;
const SLASH_RESULT_LIMIT = 8;

const labelForModel = (model: string | null): string => {
  if (!model) {
    return "Select model";
  }
  const tail = model.split("/").slice(1).join("/");
  return tail || model;
};

/** Find the `/token` the caret is currently inside, if any. */
const findSlashToken = (value: string, caret: number): { start: number; query: string } | null => {
  let i = caret;
  while (i > 0 && !/\s/.test(value[i - 1])) {
    i -= 1;
  }
  const token = value.slice(i, caret);
  if (token.startsWith("/")) {
    return { start: i, query: token.slice(1) };
  }
  return null;
};

/** Resolve every `/slug` in the message to a unique skill reference. */
const resolveSkillRefs = (value: string, skills: Skill[]): SkillRef[] => {
  const found = new Map<string, SkillRef>();
  const regex = /(?:^|\s)\/([a-z0-9-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    const slug = match[1].toLowerCase();
    const skill = skills.find((s) => s.slug === slug);
    if (skill) {
      found.set(skill.id, { name: skill.name, instructions: skill.instructions });
    }
  }
  return [...found.values()];
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Render composer text as HTML for the highlight mirror: known `/slug` tokens
 * are wrapped in a colored span. Token markup must not change glyph width (no
 * padding / bold) so the mirror stays pixel-aligned with the textarea caret.
 */
const buildHighlightHTML = (value: string, slugs: Set<string>): string => {
  const html = escapeHtml(value).replace(/(^|\s)\/([a-z0-9-]+)/gi, (whole, pre, slug) =>
    slugs.has((slug as string).toLowerCase())
      ? `${pre}<span class="skill-token">/${slug}</span>`
      : whole
  );
  // Keep a trailing newline visible so the mirror height matches the textarea.
  return html.endsWith("\n") ? `${html}​` : html;
};

const THINKING_WORDS = ["Thinking", "Working", "Reasoning"];

/** Animated status shown while the model streams but hasn't produced text yet. */
const ThinkingIndicator = (): ReactElement => {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((value) => (value + 1) % THINKING_WORDS.length);
    }, 2200);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="thinking-indicator">
      <span className="message-cursor">▍</span>
      {THINKING_WORDS[index]}
      <span className="thinking-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
};

export const ChatView = ({ chat, settings, skills, mode, modeLabel }: ChatViewProps): ReactElement => {
  const { state, setModel } = settings;
  const skillList = skills.skills;
  const registryModels = useProviderModels();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const skillSlugs = useMemo(() => new Set(skillList.map((skill) => skill.slug)), [skillList]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [activeGroupSlug, setActiveGroupSlug] = useState<string | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashStart, setSlashStart] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);

  const groups = useMemo(
    () => buildProviderGroups(state.configuredKeys, registryModels),
    [state.configuredKeys, registryModels]
  );
  const allModels = useMemo(() => groups.flatMap((group) => group.models), [groups]);
  const activeGroup = useMemo(
    () => groups.find((group) => group.slug === activeGroupSlug) ?? null,
    [groups, activeGroupSlug]
  );

  const filteredGroupModels = useMemo(() => {
    if (!activeGroup) {
      return [];
    }
    const query = modelQuery.trim().toLowerCase();
    if (!query) {
      return activeGroup.models;
    }
    return activeGroup.models.filter((option) => option.model.toLowerCase().includes(query));
  }, [activeGroup, modelQuery]);

  const activeSlug = state.activeModel ? state.activeModel.split("/")[0] : null;

  const openMenu = (): void => {
    setMenuOpen((open) => {
      const next = !open;
      if (next) {
        // Always open on the provider list (level 1).
        setActiveGroupSlug(null);
        setModelQuery("");
      }
      return next;
    });
  };

  // Reasoning ("deep thinking") controls — shown only for capable models (Z.AI/GLM).
  const caps = useMemo(() => reasoningCapsFor(state.activeModel), [state.activeModel]);
  const [thinkingOn, setThinkingOn] = useState(true);
  const [effort, setEffort] = useState("max");
  const thinkingPayload: ThinkingOptions | undefined = caps
    ? {
        enabled: thinkingOn,
        effort:
          thinkingOn && caps.effortValues.length
            ? caps.effortValues.includes(effort)
              ? effort
              : caps.defaultEffort
            : undefined
      }
    : undefined;

  const slashMatches = useMemo(() => {
    if (!slashOpen) {
      return [];
    }
    const query = slashQuery.toLowerCase();
    // Suggest only skills offered in this workspace; an explicitly typed /slug is
    // still resolved by resolveSkillRefs regardless of mode.
    return skillList
      .filter((skill) => skill.modes.includes(mode))
      .filter((skill) => `${skill.slug} ${skill.name}`.toLowerCase().includes(query))
      .slice(0, SLASH_RESULT_LIMIT);
  }, [slashOpen, slashQuery, skillList, mode]);

  const hasMessages = chat.messages.length > 0;
  const hasModel = Boolean(state.activeModel) && allModels.some((option) => option.model === state.activeModel);

  useEffect(() => {
    // The whole canvas scrolls now, so follow the stream by scrolling that page.
    const node = scrollRef.current;
    const scroller = node?.closest(".preview-canvas") as HTMLElement | null;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [chat.messages]);

  /** Re-render the highlight mirror to match the current textarea value. */
  const renderHighlight = (): void => {
    const composer = composerRef.current;
    const layer = highlightRef.current;
    if (!composer || !layer) {
      return;
    }
    layer.innerHTML = buildHighlightHTML(composer.value, skillSlugs);
    layer.scrollTop = composer.scrollTop;
  };

  // Refresh highlighting when the skill set changes (slug may now be known).
  useEffect(() => {
    renderHighlight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillSlugs]);

  const growComposer = (): void => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 180)}px`;
  };

  const refreshSlash = (): void => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }
    const token = findSlashToken(composer.value, composer.selectionStart ?? composer.value.length);
    if (token && skillList.length > 0) {
      setSlashStart(token.start);
      setSlashQuery(token.query);
      setSlashOpen(true);
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
  };

  const applySkill = (skill: Skill): void => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }
    const value = composer.value;
    const caret = composer.selectionStart ?? value.length;
    const before = value.slice(0, slashStart);
    const after = value.slice(caret);
    const insert = `/${skill.slug} `;
    composer.value = `${before}${insert}${after}`;
    const newCaret = before.length + insert.length;
    composer.setSelectionRange(newCaret, newCaret);
    setSlashOpen(false);
    composer.focus();
    growComposer();
    renderHighlight();
  };

  const submit = (): void => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }
    const refs = resolveSkillRefs(composer.value, skillList);
    chat.send(composer.value, refs, thinkingPayload);
    composer.value = "";
    setSlashOpen(false);
    growComposer();
    renderHighlight();
  };

  const composer = (
    <form
      className="chat-composer"
      aria-label="Chat composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="sr-only" htmlFor="relay-chat-input">
        Message Relay
      </label>
      {slashOpen && slashMatches.length > 0 && (
        <ul className="slash-menu" role="listbox" aria-label="Skills">
          {slashMatches.map((skill, index) => (
            <li key={skill.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === slashIndex}
                className={index === slashIndex ? "active" : ""}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySkill(skill);
                }}
              >
                <Sparkles size={13} />
                <span className="slash-name">/{skill.slug}</span>
                <span className="slash-desc">{skill.description || skill.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer-input">
        <div className="composer-highlight" ref={highlightRef} aria-hidden="true" />
        <textarea
        id="relay-chat-input"
        placeholder={
          hasModel
            ? "How can I help you today?  Type / for skills"
            : "Add a provider key in Settings to start chatting"
        }
        rows={2}
        ref={composerRef}
        disabled={!hasModel}
        onInput={() => {
          growComposer();
          refreshSlash();
          renderHighlight();
        }}
        onScroll={() => {
          if (highlightRef.current && composerRef.current) {
            highlightRef.current.scrollTop = composerRef.current.scrollTop;
          }
        }}
        onClick={refreshSlash}
        onKeyDown={(event) => {
          if (slashOpen && slashMatches.length > 0) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSlashIndex((i) => (i + 1) % slashMatches.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              applySkill(slashMatches[slashIndex]);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setSlashOpen(false);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        />
      </div>
      <div className="composer-footer">
        <button className="composer-icon-button" type="button" aria-label="Add attachment or context">
          <Plus size={18} />
        </button>
        <div className="composer-actions">
          {caps && (
            <div className="thinking-control">
              <button
                type="button"
                className={thinkingOn ? "thinking-toggle active" : "thinking-toggle"}
                aria-pressed={thinkingOn}
                aria-label="Toggle deep thinking"
                onClick={() => setThinkingOn((on) => !on)}
              >
                <Brain size={14} />
                <span>Thinking</span>
              </button>
              {thinkingOn && caps.effortValues.length > 0 && (
                <div className="thinking-effort" role="group" aria-label="Reasoning effort">
                  {caps.effortValues.map((value) => {
                    const isActive = (caps.effortValues.includes(effort) ? effort : caps.defaultEffort) === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        className={isActive ? "active" : ""}
                        aria-pressed={isActive}
                        onClick={() => setEffort(value)}
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="model-picker">
            <button
              className="model-button"
              type="button"
              aria-label="Select model"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              disabled={groups.length === 0}
              onClick={openMenu}
            >
              {groups.length === 0 ? "No models" : labelForModel(state.activeModel)}
              <ChevronDown size={14} />
            </button>
            {menuOpen && groups.length > 0 && (
              <div className="model-menu" role="dialog" aria-label="Select a model">
                {!activeGroup ? (
                  // Level 1 — pick a provider
                  <ul className="model-providers" aria-label="Providers">
                    {groups.map((group) => (
                      <li key={group.slug}>
                        <button
                          type="button"
                          className={group.slug === activeSlug ? "active" : ""}
                          onClick={() => {
                            setActiveGroupSlug(group.slug);
                            setModelQuery("");
                          }}
                        >
                          <span className="model-provider-main">
                            <strong>{group.name}</strong>
                            <span className="model-provider-meta">
                              {group.models.length} model{group.models.length === 1 ? "" : "s"}
                            </span>
                          </span>
                          {group.slug === activeSlug && <Check size={14} />}
                          <ChevronRight size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  // Level 2 — search that provider's models
                  <>
                    <div className="model-menu-head">
                      <button
                        type="button"
                        className="model-back"
                        aria-label="Back to providers"
                        onClick={() => {
                          setActiveGroupSlug(null);
                          setModelQuery("");
                        }}
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <span>{activeGroup.name}</span>
                    </div>
                    <label className="model-search">
                      <Search size={13} />
                      <input
                        autoFocus
                        value={modelQuery}
                        onChange={(event) => setModelQuery(event.currentTarget.value)}
                        placeholder={`Search ${activeGroup.models.length} models...`}
                      />
                    </label>
                    <ul role="listbox" aria-label={`${activeGroup.name} models`}>
                      {filteredGroupModels.slice(0, MODEL_RESULT_LIMIT).map((option) => (
                        <li key={option.model}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={state.activeModel === option.model}
                            onClick={() => {
                              void setModel(option.model);
                              setMenuOpen(false);
                              setModelQuery("");
                              setActiveGroupSlug(null);
                            }}
                          >
                            <span>
                              <strong>{option.label}</strong>
                            </span>
                            {state.activeModel === option.model && <Check size={14} />}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {filteredGroupModels.length > MODEL_RESULT_LIMIT && (
                      <p className="model-more">
                        +{filteredGroupModels.length - MODEL_RESULT_LIMIT} more — refine your search
                      </p>
                    )}
                    {filteredGroupModels.length === 0 && <p className="model-more">No models match.</p>}
                  </>
                )}
              </div>
            )}
          </div>
          <button className="composer-icon-button" type="button" aria-label="Voice input">
            <Mic size={16} />
          </button>
          <button className="composer-icon-button" type="button" aria-label="Audio settings">
            <SlidersHorizontal size={16} />
          </button>
          <button
            className="composer-submit"
            type="submit"
            aria-label="Submit message"
            disabled={!hasModel || chat.isStreaming}
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
    </form>
  );

  if (!hasMessages) {
    return (
      <section className="chat-start">
        <p className="chat-start-greeting">Relay · {modeLabel}</p>
        {composer}
      </section>
    );
  }

  return (
    <section className="chat-session" aria-label={`${modeLabel} conversation`}>
      <Conversation>
        <ConversationContent ref={scrollRef}>
          {chat.messages.map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent>
                {message.reasoning && (
                  <details className="reasoning-panel" open={!message.content}>
                    <summary>
                      <ChevronRight size={13} className="reasoning-caret" />
                      <Brain size={13} />
                      Thinking
                    </summary>
                    <div className="reasoning-text">{message.reasoning}</div>
                  </details>
                )}
                {message.content
                  ? message.role === "assistant"
                    ? <Response>{message.content}</Response>
                    : message.content
                  : chat.isStreaming
                    ? message.reasoning
                      ? null
                      : <ThinkingIndicator />
                    : ""}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
      </Conversation>
      <div className="chat-session-composer">{composer}</div>
    </section>
  );
};
