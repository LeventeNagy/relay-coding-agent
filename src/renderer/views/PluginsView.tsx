import { ReactElement, useMemo, useState } from "react";
import { Blocks, Check, ChevronDown, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import type { PluginsController } from "../hooks/usePlugins";
import type { SkillsController } from "../hooks/useSkills";
import { SkillsPanel } from "./SkillsPanel";
import type { PluginCatalogEntry, PluginInput, PluginSummary } from "../../shared/plugins/types";

type PluginsTab = "plugins" | "skills";

interface PluginsViewProps {
  plugins: PluginsController;
  skills: SkillsController;
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
}

const ALL = "All";

const draftFromCatalog = (entry: PluginCatalogEntry): Draft => ({
  catalogId: entry.id,
  custom: false,
  name: entry.name,
  command: entry.command,
  baseArgs: entry.args,
  argsText: "",
  argHints: entry.argHints ?? [],
  argValues: (entry.argHints ?? []).map(() => ""),
  envFields: (entry.envHints ?? []).map((h) => ({ ...h })),
  envValues: {}
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
  return { id: draft.editingId, catalogId: draft.catalogId, name: draft.name.trim() || "Untitled server", command: draft.command.trim(), args, env };
};

const StatusDot = ({ plugin }: { plugin: PluginSummary }): ReactElement => {
  const label =
    plugin.status === "connected"
      ? `${plugin.toolCount} tool${plugin.toolCount === 1 ? "" : "s"}`
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

export const PluginsView = ({ plugins, skills }: PluginsViewProps): ReactElement => {
  const { catalog, installed, add, probe, toggle, remove } = plugins;
  const [tab, setTab] = useState<PluginsTab>("plugins");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [probeMsg, setProbeMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
      return (
        <span className="plugin-added-tag">
          <Check size={13} /> Added
        </span>
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

      {tab === "skills" && <SkillsPanel skills={skills} />}

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
                </div>
                <div className="plugin-actions">
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
              <button className="plugin-secondary" type="button" disabled={busy} onClick={runProbe}>
                {busy ? <Loader2 size={14} className="spin" /> : null}
                Test connection
              </button>
              <button className="plugin-primary" type="button" disabled={busy} onClick={saveDraft}>
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
