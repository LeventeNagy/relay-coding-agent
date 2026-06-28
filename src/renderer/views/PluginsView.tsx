import { ReactElement, useMemo, useState } from "react";
import {
  Blocks,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X
} from "lucide-react";
import type { PluginsController } from "../hooks/usePlugins";
import type { SkillsController } from "../hooks/useSkills";
import { SkillsPanel } from "./SkillsPanel";
import type { PluginCatalogEntry, PluginInput, PluginScope, PluginSummary } from "../../shared/plugins/types";

type PluginsTab = "plugins" | "skills";

interface PluginsViewProps {
  plugins: PluginsController;
  skills: SkillsController;
  /** Tab to open on (when navigated to from the composer "+" menu). */
  initialTab?: PluginsTab;
  /** Pop the new-skill form on open (from "+" → Skills → Add skill). */
  skillsAutoNew?: boolean;
}

/** A draft being configured in the Add panel (from a catalog entry or custom). */
interface Draft {
  editingId?: string;
  catalogId?: string;
  custom: boolean;
  name: string;
  command: string;
  /** Fixed base args from the catalog entry (shown read-only). */
  baseArgs: string[];
  /** Free-text args for a custom server. */
  argsText: string;
  argHints: Array<{ label: string; placeholder?: string }>;
  argValues: string[];
  envFields: Array<{ key: string; label: string; required: boolean; placeholder?: string }>;
  envValues: Record<string, string>;
  /** Deep-link to the provider's "create API key" page, if any. */
  keyUrl?: string;
  /** Which workspace mode(s) this plugin is offered in (carried from the catalog). */
  scope?: PluginScope;
}

const ALL = "All";

const draftFromCatalog = (entry: PluginCatalogEntry): Draft => ({
  catalogId: entry.id,
  custom: false,
  name: entry.name,
  command: entry.command ?? "npx",
  baseArgs: entry.args ?? [],
  argsText: "",
  argHints: entry.argHints ?? [],
  argValues: (entry.argHints ?? []).map(() => ""),
  envFields: (entry.envHints ?? []).map((h) => ({ ...h })),
  envValues: {},
  keyUrl: entry.keyUrl,
  scope: entry.scope
});

/** Build the add payload for a one-click OAuth catalog entry (no modal). */
const oauthInput = (entry: PluginCatalogEntry): PluginInput => ({
  catalogId: entry.id,
  name: entry.name,
  transport: "http",
  auth: "oauth",
  url: entry.url,
  scope: entry.scope,
  command: "",
  args: [],
  env: {}
});

const blankCustomDraft = (): Draft => ({
  custom: true,
  name: "",
  command: "npx",
  baseArgs: [],
  argsText: "",
  argHints: [],
  argValues: [],
  envFields: [],
  envValues: {}
});

const draftToInput = (draft: Draft): PluginInput => {
  const args = draft.custom
    ? draft.argsText.trim().split(/\s+/).filter(Boolean)
    : [...draft.baseArgs, ...draft.argValues.map((v) => v.trim()).filter(Boolean)];
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft.envValues)) {
    if (value.trim()) {
      env[key] = value.trim();
    }
  }
  return { id: draft.editingId, catalogId: draft.catalogId, name: draft.name.trim() || "Untitled server", command: draft.command.trim(), args, env, scope: draft.scope };
};

const StatusDot = ({ plugin }: { plugin: PluginSummary }): ReactElement => {
  const label =
    plugin.status === "connected"
      ? plugin.toolCount > 0
        ? `${plugin.toolCount} tool${plugin.toolCount === 1 ? "" : "s"}`
        : "Connected"
      : plugin.status === "error"
        ? "Error"
        : "Not connected";
  return (
    <span className={`plugin-status ${plugin.status}`} title={plugin.error ?? label}>
      <span className="status-pip" />
      {label}
    </span>
  );
};

export const PluginsView = ({
  plugins,
  skills,
  initialTab = "plugins",
  skillsAutoNew = false
}: PluginsViewProps): ReactElement => {
  const { catalog, installed, add, probe, connect, openExternal, toggle, remove } = plugins;
  const [tab, setTab] = useState<PluginsTab>(initialTab);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [probeMsg, setProbeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Id of the catalog entry / server currently running its OAuth browser flow.
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<{ id: string; text: string } | null>(null);

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const entry of catalog) {
      if (!seen.includes(entry.category)) {
        seen.push(entry.category);
      }
    }
    return [ALL, ...seen];
  }, [catalog]);

  const installedByCatalogId = useMemo(() => {
    const map = new Map<string, PluginSummary>();
    for (const plugin of installed) {
      if (plugin.catalogId) {
        map.set(plugin.catalogId, plugin);
      }
    }
    return map;
  }, [installed]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((entry) => {
      const inCategory = category === ALL || entry.category === category;
      const inQuery = !q || `${entry.name} ${entry.description}`.toLowerCase().includes(q);
      return inCategory && inQuery;
    });
  }, [catalog, query, category]);

  const featured = useMemo(() => filtered.filter((e) => e.featured), [filtered]);

  const byCategory = useMemo(() => {
    const groups = new Map<string, PluginCatalogEntry[]>();
    for (const entry of filtered) {
      const list = groups.get(entry.category) ?? [];
      list.push(entry);
      groups.set(entry.category, list);
    }
    return [...groups.entries()];
  }, [filtered]);

  const openCatalog = (entry: PluginCatalogEntry): void => {
    setProbeMsg(null);
    setDraft(draftFromCatalog(entry));
  };

  /** One-click OAuth: add the server and run the browser flow (catalog → installed). */
  const connectCatalog = async (entry: PluginCatalogEntry): Promise<void> => {
    setConnectError(null);
    setConnectingId(entry.id);
    await add(oauthInput(entry));
    setConnectingId(null);
  };

  /** Re-run the OAuth flow for an installed server (e.g. after token expiry). */
  const reconnect = async (id: string): Promise<void> => {
    setConnectError(null);
    setConnectingId(id);
    const result = await connect(id);
    setConnectingId(null);
    if (!result.ok && result.error) {
      setConnectError({ id, text: result.error });
    }
  };

  /** A required env field is still empty (blocks Add/Test for key servers). */
  const requiredMissing = (d: Draft): boolean =>
    !d.custom && d.envFields.some((f) => f.required && !(d.envValues[f.key] ?? "").trim());

  const closeDraft = (): void => {
    setDraft(null);
    setProbeMsg(null);
    setBusy(false);
  };

  const runProbe = async (): Promise<void> => {
    if (!draft) {
      return;
    }
    setBusy(true);
    setProbeMsg(null);
    const result = await probe(draftToInput(draft));
    setBusy(false);
    setProbeMsg(
      result.ok
        ? { ok: true, text: `Connected · ${result.tools.length} tool${result.tools.length === 1 ? "" : "s"}` }
        : { ok: false, text: result.error ?? "Could not connect." }
    );
  };

  const saveDraft = async (): Promise<void> => {
    if (!draft) {
      return;
    }
    setBusy(true);
    await add(draftToInput(draft));
    closeDraft();
  };

  const renderAddButton = (entry: PluginCatalogEntry): ReactElement => {
    const existing = installedByCatalogId.get(entry.id);
    if (existing) {
      const connected = existing.status === "connected";
      return (
        <span className={connected ? "plugin-added-tag" : "plugin-added-tag pending"}>
          <Check size={13} /> {connected ? "Connected" : "Added"}
        </span>
      );
    }
    if (entry.auth === "oauth") {
      const connecting = connectingId === entry.id;
      return (
        <button
          className="plugin-add"
          type="button"
          disabled={connecting}
          onClick={() => void connectCatalog(entry)}
        >
          {connecting ? <Loader2 size={13} className="spin" /> : null}
          {connecting ? "Authorize…" : "Connect"}
        </button>
      );
    }
    return (
      <button className="plugin-add" type="button" onClick={() => openCatalog(entry)}>
        Add
      </button>
    );
  };

  return (
    <section className="plugins-view" aria-label="Plugins">
      <header className="plugins-header">
        <div>
          <h2>{tab === "plugins" ? "Plugins" : "Skills"}</h2>
          <p>
            {tab === "plugins"
              ? "Give Relay tools across your favorite MCP servers."
              : "Reusable instructions you can apply in chat with “/”."}
          </p>
        </div>
        <div className="plugins-tabs" role="tablist" aria-label="Plugins and skills">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "plugins"}
            className={tab === "plugins" ? "active" : ""}
            onClick={() => setTab("plugins")}
          >
            Plugins
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "skills"}
            className={tab === "skills" ? "active" : ""}
            onClick={() => setTab("skills")}
          >
            Skills
          </button>
        </div>
      </header>

      {tab === "skills" && <SkillsPanel skills={skills} autoNew={skillsAutoNew} />}

      {tab === "plugins" && (
        <>
          <div className="plugins-toolbar">
        <label className="plugins-search">
          <Search size={15} />
          <input
            placeholder="Search plugins and skills"
            value={query}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setQuery(value);
            }}
          />
        </label>
        <div className="plugins-filter">
          <button type="button" className="plugins-filter-button" onClick={() => setFilterOpen((o) => !o)}>
            {category}
            <ChevronDown size={14} />
          </button>
          {filterOpen && (
            <ul className="plugins-filter-menu" role="listbox" aria-label="Filter by category">
              {categories.map((c) => (
                <li key={c}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={category === c}
                    onClick={() => {
                      setCategory(c);
                      setFilterOpen(false);
                    }}
                  >
                    {c}
                    {category === c && <Check size={14} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="plugins-custom" type="button" onClick={() => setDraft(blankCustomDraft())}>
          <Plus size={15} />
          Add custom server
        </button>
      </div>

      {installed.length > 0 && (
        <section className="plugins-section">
          <h3>Added</h3>
          <div className="plugins-grid">
            {installed.map((plugin) => (
              <article className="plugin-card installed" key={plugin.id}>
                <div className="plugin-icon">
                  <Blocks size={18} />
                </div>
                <div className="plugin-body">
                  <strong>{plugin.name}</strong>
                  <StatusDot plugin={plugin} />
                  {connectError?.id === plugin.id && (
                    <p className="plugin-probe err">{connectError.text}</p>
                  )}
                </div>
                <div className="plugin-actions">
                  {plugin.status !== "connected" && (
                    <button
                      className="plugin-add"
                      type="button"
                      disabled={connectingId === plugin.id}
                      onClick={() => void reconnect(plugin.id)}
                    >
                      {connectingId === plugin.id ? (
                        <Loader2 size={13} className="spin" />
                      ) : (
                        <RefreshCw size={13} />
                      )}
                      {connectingId === plugin.id
                        ? plugin.auth === "oauth"
                          ? "Authorize…"
                          : "Connecting…"
                        : "Reconnect"}
                    </button>
                  )}
                  <label className="plugin-switch" title={plugin.enabled ? "Enabled" : "Disabled"}>
                    <input
                      type="checkbox"
                      checked={plugin.enabled}
                      onChange={(event) => toggle(plugin.id, event.currentTarget.checked)}
                    />
                    <span className="plugin-switch-track" />
                  </label>
                  <button
                    className="plugin-remove"
                    type="button"
                    aria-label={`Remove ${plugin.name}`}
                    onClick={() => remove(plugin.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {featured.length > 0 && (
        <section className="plugins-section">
          <h3>Featured</h3>
          <div className="plugins-grid">
            {featured.map((entry) => (
              <article className="plugin-card" key={entry.id}>
                <div className="plugin-icon">
                  <Blocks size={18} />
                </div>
                <div className="plugin-body">
                  <strong>{entry.name}</strong>
                  <p>{entry.description}</p>
                </div>
                {renderAddButton(entry)}
              </article>
            ))}
          </div>
        </section>
      )}

      {byCategory.map(([cat, entries]) => (
        <section className="plugins-section" key={cat}>
          <h3>{cat}</h3>
          <div className="plugins-grid">
            {entries.map((entry) => (
              <article className="plugin-card" key={entry.id}>
                <div className="plugin-icon">
                  <Blocks size={18} />
                </div>
                <div className="plugin-body">
                  <strong>{entry.name}</strong>
                  <p>{entry.description}</p>
                </div>
                {renderAddButton(entry)}
              </article>
            ))}
          </div>
        </section>
      ))}

      {filtered.length === 0 && <p className="plugins-empty">No plugins match your search.</p>}

      {draft && (
        <div className="plugin-modal" role="dialog" aria-label="Configure plugin" onClick={closeDraft}>
          <div className="plugin-modal-card" onClick={(event) => event.stopPropagation()}>
            <header className="plugin-modal-head">
              <h3>{draft.custom ? "Add custom MCP server" : `Add ${draft.name}`}</h3>
              <button className="icon-button" type="button" aria-label="Close" onClick={closeDraft}>
                <X size={16} />
              </button>
            </header>

            <div className="plugin-modal-body">
              {draft.keyUrl && (
                <button
                  className="plugin-getkey"
                  type="button"
                  onClick={() => openExternal(draft.keyUrl as string)}
                >
                  Get your key
                  <ExternalLink size={13} />
                </button>
              )}
              {draft.custom && (
                <label className="plugin-field">
                  <span>Name</span>
                  <input
                    value={draft.name}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setDraft((d) => (d ? { ...d, name: value } : d));
                    }}
                    placeholder="My MCP server"
                  />
                </label>
              )}

              {draft.custom ? (
                <>
                  <label className="plugin-field">
                    <span>Command</span>
                    <input
                      value={draft.command}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setDraft((d) => (d ? { ...d, command: value } : d));
                      }}
                      placeholder="npx"
                    />
                  </label>
                  <label className="plugin-field">
                    <span>Arguments</span>
                    <input
                      value={draft.argsText}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setDraft((d) => (d ? { ...d, argsText: value } : d));
                      }}
                      placeholder="-y @scope/server-name /path"
                    />
                  </label>
                </>
              ) : (
                <div className="plugin-command-preview">
                  <span>Command</span>
                  <code>
                    {draft.command} {draft.baseArgs.join(" ")}
                  </code>
                </div>
              )}

              {draft.argHints.map((hint, index) => (
                <label className="plugin-field" key={`${hint.label}-${index}`}>
                  <span>{hint.label}</span>
                  <input
                    value={draft.argValues[index] ?? ""}
                    placeholder={hint.placeholder}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setDraft((d) => {
                        if (!d) {
                          return d;
                        }
                        const argValues = [...d.argValues];
                        argValues[index] = value;
                        return { ...d, argValues };
                      });
                    }}
                  />
                </label>
              ))}

              {draft.envFields.map((field) => (
                <label className="plugin-field" key={field.key}>
                  <span>
                    {field.label}
                    {field.required && <em className="req">required</em>}
                  </span>
                  <input
                    type="password"
                    value={draft.envValues[field.key] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setDraft((d) =>
                        d ? { ...d, envValues: { ...d.envValues, [field.key]: value } } : d
                      );
                    }}
                  />
                </label>
              ))}

              {probeMsg && (
                <p className={`plugin-probe ${probeMsg.ok ? "ok" : "err"}`}>{probeMsg.text}</p>
              )}
            </div>

            <footer className="plugin-modal-foot">
              <button
                className="plugin-secondary"
                type="button"
                disabled={busy || requiredMissing(draft)}
                onClick={runProbe}
              >
                {busy ? <Loader2 size={14} className="spin" /> : null}
                Test connection
              </button>
              <button
                className="plugin-primary"
                type="button"
                disabled={busy || requiredMissing(draft)}
                onClick={saveDraft}
              >
                Add plugin
              </button>
            </footer>
          </div>
        </div>
      )}
        </>
      )}
    </section>
  );
};
