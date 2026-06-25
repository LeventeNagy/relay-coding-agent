import { ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Mic, Plus, Search, SendHorizontal, SlidersHorizontal, Sparkles } from "lucide-react";
import { buildModelOptions } from "../../shared/agent/providers";
import { Conversation, ConversationContent } from "../components/ai-elements/conversation";
import { Message, MessageContent } from "../components/ai-elements/message";
import { useProviderModels } from "../hooks/useProviderModels";
import type { SessionsController } from "../hooks/useSessions";
import type { SettingsController } from "../hooks/useSettings";
import type { SkillsController } from "../hooks/useSkills";
import type { Skill, SkillRef } from "../../shared/skills/types";

interface ChatViewProps {
  chat: SessionsController;
  settings: SettingsController;
  skills: SkillsController;
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

export const ChatView = ({ chat, settings, skills, modeLabel }: ChatViewProps): ReactElement => {
  const { state, setModel } = settings;
  const skillList = skills.skills;
  const registryModels = useProviderModels();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashStart, setSlashStart] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);

  const options = useMemo(
    () => buildModelOptions(state.configuredKeys, registryModels),
    [state.configuredKeys, registryModels]
  );

  const filteredOptions = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    if (!query) {
      return options;
    }
    return options.filter((option) =>
      `${option.providerName} ${option.model}`.toLowerCase().includes(query)
    );
  }, [options, modelQuery]);

  const slashMatches = useMemo(() => {
    if (!slashOpen) {
      return [];
    }
    const query = slashQuery.toLowerCase();
    return skillList
      .filter((skill) => `${skill.slug} ${skill.name}`.toLowerCase().includes(query))
      .slice(0, SLASH_RESULT_LIMIT);
  }, [slashOpen, slashQuery, skillList]);

  const hasMessages = chat.messages.length > 0;
  const hasModel = Boolean(state.activeModel) && options.some((option) => option.model === state.activeModel);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat.messages]);

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
  };

  const submit = (): void => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }
    const refs = resolveSkillRefs(composer.value, skillList);
    chat.send(composer.value, refs);
    composer.value = "";
    setSlashOpen(false);
    growComposer();
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
      <div className="composer-footer">
        <button className="composer-icon-button" type="button" aria-label="Add attachment or context">
          <Plus size={18} />
        </button>
        <div className="composer-actions">
          <div className="model-picker">
            <button
              className="model-button"
              type="button"
              aria-label="Select model"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              disabled={options.length === 0}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {options.length === 0 ? "No models" : labelForModel(state.activeModel)}
              <ChevronDown size={14} />
            </button>
            {menuOpen && options.length > 0 && (
              <div className="model-menu" role="dialog" aria-label="Select a model">
                <label className="model-search">
                  <Search size={13} />
                  <input
                    autoFocus
                    value={modelQuery}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setModelQuery(value);
                    }}
                    placeholder={`Search ${options.length} models...`}
                  />
                </label>
                <ul role="listbox" aria-label="Available models">
                  {filteredOptions.slice(0, MODEL_RESULT_LIMIT).map((option) => (
                    <li key={option.model}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={state.activeModel === option.model}
                        onClick={() => {
                          void setModel(option.model);
                          setMenuOpen(false);
                          setModelQuery("");
                        }}
                      >
                        <span>
                          <strong>{option.label}</strong>
                          <code>{option.providerName}</code>
                        </span>
                        {state.activeModel === option.model && <Check size={14} />}
                      </button>
                    </li>
                  ))}
                </ul>
                {filteredOptions.length > MODEL_RESULT_LIMIT && (
                  <p className="model-more">
                    +{filteredOptions.length - MODEL_RESULT_LIMIT} more — refine your search
                  </p>
                )}
                {filteredOptions.length === 0 && <p className="model-more">No models match.</p>}
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
                {message.content || (chat.isStreaming ? <span className="message-cursor">▍</span> : "")}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
      </Conversation>
      <div className="chat-session-composer">{composer}</div>
    </section>
  );
};
