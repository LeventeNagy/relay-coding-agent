import { ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Mic, Plus, Search, SendHorizontal, SlidersHorizontal } from "lucide-react";
import { buildModelOptions } from "../../shared/agent/providers";
import { Conversation, ConversationContent } from "../components/ai-elements/conversation";
import { Message, MessageContent } from "../components/ai-elements/message";
import { useProviderModels } from "../hooks/useProviderModels";
import type { SessionsController } from "../hooks/useSessions";
import type { SettingsController } from "../hooks/useSettings";

interface ChatViewProps {
  chat: SessionsController;
  settings: SettingsController;
  modeLabel: string;
}

const MODEL_RESULT_LIMIT = 60;

const labelForModel = (model: string | null): string => {
  if (!model) {
    return "Select model";
  }
  const tail = model.split("/").slice(1).join("/");
  return tail || model;
};

export const ChatView = ({ chat, settings, modeLabel }: ChatViewProps): ReactElement => {
  const { state, setModel } = settings;
  const registryModels = useProviderModels();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");

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

  const submit = (): void => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }
    chat.send(composer.value);
    composer.value = "";
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
      <textarea
        id="relay-chat-input"
        placeholder={hasModel ? "How can I help you today?" : "Add a provider key in Settings to start chatting"}
        rows={2}
        ref={composerRef}
        disabled={!hasModel}
        onInput={growComposer}
        onKeyDown={(event) => {
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
