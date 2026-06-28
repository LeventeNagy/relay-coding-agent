import { ReactElement, useEffect, useMemo, useRef, useState } from "react";
import {
  Blocks,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderPlus,
  Globe,
  Paperclip,
  Plus,
  ScanSearch,
  Search,
  SendHorizontal,
  Sparkles,
  Square,
  X
} from "lucide-react";
import { buildProviderGroups, reasoningCapsFor, supportsVision } from "../../shared/agent/providers";
import type { Attachment, ThinkingOptions, WebMode } from "../../shared/agent/types";
import type { PluginSummary } from "../../shared/plugins/types";
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
  /** Chat-eligible plugins (code-only ones are excluded) for the "+" menu toggles. */
  chatPlugins: PluginSummary[];
  /** Default active set (connected chat-plugins) when the chat hasn't chosen. */
  defaultPluginIds: string[];
  /** "+" menu → Skills → Add skill (opens the new-skill form). */
  onAddSkill: () => void;
  /** "+" menu → Skills → Manage skills (opens the skills panel). */
  onManageSkills: () => void;
  /** "+" menu → Add plugins (opens the plugins panel). */
  onOpenPlugins: () => void;
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

/** A file staged in the composer before the message is sent. */
interface PendingAttachment {
  localId: string;
  name: string;
  mimeType: string;
  kind: "image" | "document";
  /** Base64 of the raw bytes (no data-URL prefix) — sent to attachments:ingest. */
  data: string;
  /** Object/data URL for an instant image preview. */
  previewUrl?: string;
}

const ACCEPT_ATTACHMENTS = "image/*,.pdf,.docx,.txt,.md,.markdown,.csv,.json,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.rb,.php,.c,.cpp,.h,.css,.html,.yml,.yaml,.toml,.sh";

/** Read a File into a pending attachment (base64 payload + preview for images). */
const readFile = (file: File): Promise<PendingAttachment> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      const data = comma >= 0 ? result.slice(comma + 1) : result;
      const kind = file.type.startsWith("image/") ? "image" : "document";
      resolve({
        localId: `pa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        mimeType: file.type,
        kind,
        data,
        previewUrl: kind === "image" ? result : undefined
      });
    };
    reader.readAsDataURL(file);
  });

/** Image thumbnail that lazily loads its data URL from the store by id. */
const AttachmentImage = ({ id, name }: { id: string; name: string }): ReactElement => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void window.attachments.read(id).then((url) => {
      if (active) {
        setSrc(url);
      }
    });
    return () => {
      active = false;
    };
  }, [id]);
  if (!src) {
    return <span className="attachment-image attachment-image-loading" aria-label={name} />;
  }
  return <img className="attachment-image" src={src} alt={name} />;
};

/** Attachments rendered inside a sent message bubble. */
const MessageAttachments = ({ attachments }: { attachments: Attachment[] }): ReactElement => (
  <div className="message-attachments">
    {attachments.map((att) =>
      att.kind === "image" ? (
        <AttachmentImage key={att.id} id={att.id} name={att.name} />
      ) : (
        <span key={att.id} className="attachment-chip" title={att.name}>
          <FileText size={13} />
          {att.name}
        </span>
      )
    )}
  </div>
);

export const ChatView = ({
  chat,
  settings,
  skills,
  mode,
  modeLabel,
  chatPlugins,
  defaultPluginIds,
  onAddSkill,
  onManageSkills,
  onOpenPlugins
}: ChatViewProps): ReactElement => {
  const { state, setModel } = settings;
  const skillList = skills.skills;
  const registryModels = useProviderModels();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const plusMenuRef = useRef<HTMLDivElement | null>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  // One-shot web augmentation for the next message (cleared after send).
  const [webMode, setWebMode] = useState<WebMode | null>(null);

  // Close the "+" menu on outside click or Escape.
  useEffect(() => {
    if (!plusOpen) {
      return;
    }
    const onDown = (event: globalThis.MouseEvent): void => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) {
        setPlusOpen(false);
      }
    };
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        setPlusOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [plusOpen]);
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

  const addFiles = (files: FileList | File[]): void => {
    const list = Array.from(files);
    if (list.length === 0) {
      return;
    }
    void Promise.all(list.map(readFile))
      .then((read) => setPending((current) => [...current, ...read]))
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("attachment read failed:", error);
      });
  };

  const removePending = (localId: string): void => {
    setPending((current) => current.filter((item) => item.localId !== localId));
  };

  const openFilePicker = (): void => {
    fileInputRef.current?.click();
  };

  /** Run a "+" menu action and close the menu. */
  const runPlusAction = (action: () => void): void => {
    setPlusOpen(false);
    action();
  };

  // Plugins active in THIS conversation. `null` selection means "use the
  // connected-chat default"; toggling materialises an explicit set.
  const effectivePluginIds = chat.activePluginIds ?? defaultPluginIds;
  const togglePlugin = (id: string): void => {
    const next = effectivePluginIds.includes(id)
      ? effectivePluginIds.filter((pid) => pid !== id)
      : [...effectivePluginIds, id];
    chat.setActivePluginIds(next);
  };

  const submit = (): void => {
    const composer = composerRef.current;
    if (!composer || chat.isStreaming) {
      return;
    }
    const text = composer.value;
    const staged = pending;
    if (!text.trim() && staged.length === 0) {
      return;
    }
    const refs = resolveSkillRefs(text, skillList);

    const mode = webMode ?? undefined;
    const dispatch = (attachments?: Attachment[]): void => {
      chat.send(text, refs, thinkingPayload, attachments, mode);
    };

    if (staged.length > 0) {
      void window.attachments
        .ingest(staged.map(({ name, mimeType, data }) => ({ name, mimeType, data })))
        .then((attachments) => dispatch(attachments))
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.error("attachments.ingest failed:", error);
          dispatch();
        });
    } else {
      dispatch();
    }

    composer.value = "";
    setPending([]);
    setWebMode(null);
    setSlashOpen(false);
    growComposer();
    renderHighlight();
  };

  const visionWarning =
    pending.some((item) => item.kind === "image") && !supportsVision(state.activeModel);

  const composer = (
    <form
      className={dragOver ? "chat-composer drag-over" : "chat-composer"}
      aria-label="Chat composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setDragOver(false);
        }
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length > 0) {
          event.preventDefault();
          addFiles(event.dataTransfer.files);
        }
        setDragOver(false);
      }}
    >
      <label className="sr-only" htmlFor="relay-chat-input">
        Message Relay
      </label>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTACHMENTS}
        className="sr-only"
        onChange={(event) => {
          if (event.currentTarget.files) {
            addFiles(event.currentTarget.files);
          }
          event.currentTarget.value = "";
        }}
      />
      {pending.length > 0 && (
        <div className="composer-attachments">
          {pending.map((item) => (
            <div
              key={item.localId}
              className={item.kind === "image" ? "pending-attachment pending-image" : "pending-attachment"}
            >
              {item.kind === "image" && item.previewUrl ? (
                <img src={item.previewUrl} alt={item.name} />
              ) : (
                <span className="pending-doc">
                  <FileText size={14} />
                  <span className="pending-name">{item.name}</span>
                </span>
              )}
              <button
                type="button"
                className="pending-remove"
                aria-label={`Remove ${item.name}`}
                onClick={() => removePending(item.localId)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {webMode && (
        <div className="composer-mode-chip">
          {webMode === "research" ? <ScanSearch size={13} /> : <Globe size={13} />}
          <span>{webMode === "research" ? "Research" : "Web search"}</span>
          <button type="button" aria-label="Clear web mode" onClick={() => setWebMode(null)}>
            <X size={12} />
          </button>
        </div>
      )}
      {visionWarning && (
        <p className="composer-hint">This model may not be able to read images. Pick a vision model for image questions.</p>
      )}
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
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "u") {
            event.preventDefault();
            openFilePicker();
            return;
          }
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
        <div className="plus-menu-wrap" ref={plusMenuRef}>
          <button
            className="composer-icon-button"
            type="button"
            aria-label="Add attachment or context"
            aria-haspopup="menu"
            aria-expanded={plusOpen}
            onClick={() => setPlusOpen((open) => !open)}
          >
            <Plus size={18} />
          </button>
          {plusOpen && (
            <ul className="plus-menu" role="menu" aria-label="Add to chat">
              <li role="none">
                <button role="menuitem" type="button" onClick={() => runPlusAction(openFilePicker)}>
                  <Paperclip size={15} />
                  <span className="plus-label">Add files or photos</span>
                  <kbd className="plus-shortcut">Ctrl+U</kbd>
                </button>
              </li>

              <li className="plus-sub" role="none">
                <button role="menuitem" type="button" aria-haspopup="menu" disabled>
                  <FolderPlus size={15} />
                  <span className="plus-label">Add to project</span>
                  <span className="plus-soon">Soon</span>
                  <ChevronRight size={14} className="plus-caret" />
                </button>
                <ul className="plus-submenu" role="menu" aria-label="Add to project">
                  <li role="none">
                    <button role="menuitem" type="button" disabled>
                      Create project
                    </button>
                  </li>
                  <li role="none">
                    <button role="menuitem" type="button" disabled>
                      Add to existing project
                    </button>
                  </li>
                </ul>
              </li>

              <li className="plus-divider" role="separator" />

              <li className="plus-sub" role="none">
                <button role="menuitem" type="button" aria-haspopup="menu">
                  <Sparkles size={15} />
                  <span className="plus-label">Skills</span>
                  <ChevronRight size={14} className="plus-caret" />
                </button>
                <ul className="plus-submenu" role="menu" aria-label="Skills">
                  <li role="none">
                    <button role="menuitem" type="button" onClick={() => runPlusAction(onAddSkill)}>
                      Add skill
                    </button>
                  </li>
                  <li role="none">
                    <button role="menuitem" type="button" onClick={() => runPlusAction(onManageSkills)}>
                      Manage skills
                    </button>
                  </li>
                </ul>
              </li>

              <li className="plus-section-label" role="presentation">
                <Blocks size={13} />
                <span>Plugins</span>
                <span className="plus-section-hint">active in this chat</span>
              </li>
              {chatPlugins.length === 0 ? (
                <li role="none">
                  <button role="menuitem" type="button" onClick={() => runPlusAction(onOpenPlugins)}>
                    <span className="plus-label plus-label-muted">Connect a plugin…</span>
                  </button>
                </li>
              ) : (
                chatPlugins.map((plugin) => {
                  const active = effectivePluginIds.includes(plugin.id);
                  const connected = plugin.status === "connected";
                  return (
                    <li role="none" key={plugin.id}>
                      <button
                        role="menuitemcheckbox"
                        type="button"
                        aria-checked={active}
                        className="plus-plugin"
                        onClick={() => togglePlugin(plugin.id)}
                      >
                        <span className={active ? "plus-check on" : "plus-check"}>
                          {active && <Check size={13} />}
                        </span>
                        <span className="plus-label">{plugin.name}</span>
                        <span
                          className={connected ? "plus-plugin-dot connected" : "plus-plugin-dot"}
                          title={connected ? "Connected" : "Not connected"}
                        />
                      </button>
                    </li>
                  );
                })
              )}
              <li role="none">
                <button role="menuitem" type="button" onClick={() => runPlusAction(onOpenPlugins)}>
                  <span className="plus-label plus-label-muted">Manage plugins…</span>
                </button>
              </li>

              <li className="plus-divider" role="separator" />

              <li role="none">
                <button
                  role="menuitemcheckbox"
                  type="button"
                  aria-checked={webMode === "search"}
                  onClick={() => runPlusAction(() => setWebMode((m) => (m === "search" ? null : "search")))}
                >
                  <Globe size={15} />
                  <span className="plus-label">Web search</span>
                  {webMode === "search" && <Check size={14} />}
                </button>
              </li>
              <li role="none">
                <button
                  role="menuitemcheckbox"
                  type="button"
                  aria-checked={webMode === "research"}
                  onClick={() => runPlusAction(() => setWebMode((m) => (m === "research" ? null : "research")))}
                >
                  <ScanSearch size={15} />
                  <span className="plus-label">Research</span>
                  {webMode === "research" && <Check size={14} />}
                </button>
              </li>
            </ul>
          )}
        </div>
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
          {chat.isStreaming ? (
            <button
              className="composer-submit composer-stop"
              type="button"
              aria-label="Stop generating"
              onClick={() => chat.stop()}
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              className="composer-submit"
              type="submit"
              aria-label="Submit message"
              disabled={!hasModel}
            >
              <SendHorizontal size={16} />
            </button>
          )}
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
                {message.attachments && message.attachments.length > 0 && (
                  <MessageAttachments attachments={message.attachments} />
                )}
                {message.progress && message.progress.length > 0 && (
                  <details className="reasoning-panel research-progress" open={!message.content}>
                    <summary>
                      <ChevronRight size={13} className="reasoning-caret" />
                      <ScanSearch size={13} />
                      Researched the web · {message.progress.length} step
                      {message.progress.length === 1 ? "" : "s"}
                    </summary>
                    <div className="reasoning-text">
                      {message.progress.map((line, index) => (
                        <div key={index} className="research-step">
                          {line}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
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
                    ? message.reasoning || (message.progress && message.progress.length > 0)
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
