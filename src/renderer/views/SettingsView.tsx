import { ReactElement, useMemo, useState } from "react";
import { Check, ExternalLink, Eye, EyeOff, Globe, Plus, Search, Trash2 } from "lucide-react";
import { credentialList } from "../../shared/agent/providers";
import type { SettingsController } from "../hooks/useSettings";
import type { PetsController } from "../hooks/usePets";
import { Pet } from "../components/Pet";
import { PetImport } from "../components/PetImport";

interface SettingsViewProps {
  settings: SettingsController;
  pets: PetsController;
  petEnabled: boolean;
  onPetEnabledChange: (next: boolean) => void;
  petFloat: boolean;
  onPetFloatChange: (next: boolean) => void;
}

type SettingsTab = "providers" | "search" | "appearance";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; eyebrow: string; title: string }> = [
  { id: "providers", label: "Model providers", eyebrow: "Mastra providers", title: "Connect model keys" },
  { id: "search", label: "Web search", eyebrow: "Web search", title: "Search provider keys" },
  { id: "appearance", label: "Appearance", eyebrow: "Appearance", title: "Status pet" }
];

/**
 * Optional search-provider keys. Web search works keyless (DuckDuckGo); adding
 * one of these upgrades quality. Stored in the same encrypted key store as model
 * keys (applyKeysToEnv exposes them to the web_search tool via process.env).
 */
const SEARCH_KEYS = [
  {
    variable: "TAVILY_API_KEY",
    name: "Tavily",
    note: "AI-research-grade search — returns page content and a draft answer. Free tier ~1000/mo.",
    url: "https://app.tavily.com/"
  },
  {
    variable: "BRAVE_API_KEY",
    name: "Brave Search",
    note: "General web search, privacy-friendly. Free tier ~2000/mo.",
    url: "https://api-dashboard.search.brave.com/app/keys"
  }
] as const;

export const SettingsView = ({
  settings,
  pets,
  petEnabled,
  onPetEnabledChange,
  petFloat,
  onPetFloatChange
}: SettingsViewProps): ReactElement => {
  const { state, setKey, deleteKey } = settings;
  const credentials = useMemo(() => credentialList(), []);
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("providers");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return credentials;
    }
    return credentials.filter((credential) =>
      [credential.name, credential.variable, credential.note, ...credential.models, ...credential.plans].some((value) =>
        value.toLowerCase().includes(query)
      )
    );
  }, [search, credentials]);

  const saveKey = (envVar: string): void => {
    const draft = drafts[envVar];
    if (draft && draft.trim()) {
      void setKey(envVar, draft.trim());
      setDrafts((current) => ({ ...current, [envVar]: "" }));
      setVisibleKeys((current) => ({ ...current, [envVar]: false }));
    }
  };

  const activeMeta = SETTINGS_TABS.find((t) => t.id === tab) ?? SETTINGS_TABS[0];

  return (
    <section className="settings-view" aria-label="Settings">
      <header className="settings-header">
        <div className="settings-tabs plugins-tabs" role="tablist" aria-label="Settings sections">
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p>{activeMeta.eyebrow}</p>
        <h2>{activeMeta.title}</h2>
        {tab !== "appearance" && (
          <span>
            {state.secureStorageAvailable
              ? "Keys are encrypted with your OS keychain and injected into the agent at runtime."
              : "OS keychain unavailable — keys are stored locally without encryption on this machine."}
          </span>
        )}
      </header>

      {tab === "appearance" && (
      <section className="appearance-settings" aria-label="Appearance">
        <div className="appearance-row">
          <div className="appearance-copy">
            <h3>Status pet</h3>
            <p>
              A little companion in the corner of the workspace that reacts to what the agent is
              doing — idle, working, or done. Purely cosmetic.
            </p>
          </div>
          <label className="pet-toggle">
            <input
              type="checkbox"
              checked={petEnabled}
              onChange={(event) => onPetEnabledChange(event.currentTarget.checked)}
            />
            <span>{petEnabled ? "On" : "Off"}</span>
          </label>
        </div>
        {petEnabled && (
          <>
            <label className="pet-float-row">
              <input
                type="checkbox"
                checked={petFloat}
                onChange={(event) => onPetFloatChange(event.currentTarget.checked)}
              />
              <span>
                Float over other windows
                <small>Keep the pet visible on top of your editor/browser while runs stream.</small>
              </span>
            </label>

            <div className="pet-picker" aria-label="Choose a pet">
              {pets.pets.map((pet) => (
                <div
                  key={pet.id}
                  className={pet.id === pets.activePetId ? "pet-card active" : "pet-card"}
                >
                  <button
                    type="button"
                    className="pet-card-pick"
                    aria-pressed={pet.id === pets.activePetId}
                    onClick={() => pets.setActivePet(pet.id)}
                  >
                    <Pet pet={pet} state="idle" size={56} />
                    <span>{pet.name}</span>
                  </button>
                  {pet.custom && (
                    <button
                      type="button"
                      className="pet-card-remove"
                      aria-label={`Remove ${pet.name}`}
                      onClick={() => void pets.removePet(pet.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {importing ? (
              <PetImport
                pickImage={pets.pickImage}
                onImport={async (input) => {
                  await pets.importPet(input);
                  setImporting(false);
                }}
                onCancel={() => setImporting(false)}
              />
            ) : (
              <button type="button" className="pet-add-btn" onClick={() => setImporting(true)}>
                <Plus size={14} /> Import a pet
              </button>
            )}
            <p className="pet-help">
              Generate your own with an AI sprite-sheet tool (PixelLab, Musely, …) — see{" "}
              <button
                type="button"
                className="pet-help-link"
                onClick={() =>
                  void window.plugins.openExternal(
                    "https://github.com/LeventeNagy/relay-coding-agent/blob/main/docs/make-your-own-pet.md"
                  )
                }
              >
                Make your own pet
              </button>
              .
            </p>
          </>
        )}
      </section>
      )}

      {tab === "search" && (
      <section className="search-keys" aria-label="Web search">
        <div className="search-keys-head">
          <Globe size={15} />
          <div>
            <h3>Web search</h3>
            <p>
              Web search &amp; research work with no key (DuckDuckGo). Add a key below for
              higher-quality results and deeper research.
            </p>
          </div>
        </div>
        <div className="search-keys-grid">
          {SEARCH_KEYS.map((entry) => {
            const isConfigured = state.configuredKeys.includes(entry.variable);
            const isVisible = visibleKeys[entry.variable] ?? false;
            const draft = drafts[entry.variable] ?? "";
            return (
              <article className="provider-card" key={entry.variable}>
                <div className="provider-card-header">
                  <div className="provider-card-title">
                    <h3>{entry.name}</h3>
                    {isConfigured && (
                      <span className="provider-status">
                        <Check size={11} /> Connected
                      </span>
                    )}
                  </div>
                  <p>{entry.note}</p>
                  <button
                    type="button"
                    className="search-getkey"
                    onClick={() => void window.plugins.openExternal(entry.url)}
                  >
                    Get your key
                    <ExternalLink size={12} />
                  </button>
                </div>
                <label>
                  <span>{entry.variable}</span>
                  <div className="key-input-row">
                    <input
                      type={isVisible ? "text" : "password"}
                      value={draft}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setDrafts((current) => ({ ...current, [entry.variable]: value }));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveKey(entry.variable);
                        }
                      }}
                      onBlur={() => saveKey(entry.variable)}
                      placeholder={isConfigured ? "•••••••• stored — paste to replace" : "Paste API key (optional)"}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      aria-label={isVisible ? `Hide ${entry.name} key` : `Show ${entry.name} key`}
                      onClick={() =>
                        setVisibleKeys((current) => ({ ...current, [entry.variable]: !isVisible }))
                      }
                    >
                      {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  {isConfigured && (
                    <button
                      type="button"
                      className="provider-remove"
                      onClick={() => void deleteKey(entry.variable)}
                    >
                      <Trash2 size={12} /> Remove key
                    </button>
                  )}
                </label>
              </article>
            );
          })}
        </div>
      </section>
      )}

      {tab === "providers" && (
      <>
      <label className="provider-search">
        <Search size={14} />
        <input
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search providers, models, or env vars..."
        />
      </label>

      <div className="provider-grid">
        {filtered.map((credential) => {
          const isConfigured = state.configuredKeys.includes(credential.variable);
          const isVisible = visibleKeys[credential.variable] ?? false;
          const draft = drafts[credential.variable] ?? "";

          return (
            <article className="provider-card" key={credential.variable}>
              <div className="provider-card-header">
                <div className="provider-card-title">
                  <h3>{credential.name}</h3>
                  {isConfigured && (
                    <span className="provider-status">
                      <Check size={11} /> Connected
                    </span>
                  )}
                </div>
                <p>{credential.note}</p>
                <div className="provider-models" aria-label={`${credential.name} model routes`}>
                  {credential.models.map((model) => (
                    <code key={model}>{model}</code>
                  ))}
                </div>
                <div className="provider-plan-list" aria-label={`${credential.name} plan types`}>
                  {credential.plans.map((plan) => (
                    <span key={plan}>{plan}</span>
                  ))}
                </div>
                {new Set(credential.models.map((m) => m.split("/")[0])).size > 1 && (
                  <p className="provider-multiroute">
                    One key, multiple endpoints — coding-plan and region routes only work if your
                    account holds that plan or subscription.
                  </p>
                )}
              </div>
              <label>
                <span>{credential.variable}</span>
                <div className="key-input-row">
                  <input
                    type={isVisible ? "text" : "password"}
                    value={draft}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setDrafts((current) => ({ ...current, [credential.variable]: value }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        saveKey(credential.variable);
                      }
                    }}
                    onBlur={() => saveKey(credential.variable)}
                    placeholder={isConfigured ? "•••••••• stored — paste to replace" : "Paste API key"}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    aria-label={isVisible ? `Hide ${credential.name} key` : `Show ${credential.name} key`}
                    onClick={() =>
                      setVisibleKeys((current) => ({ ...current, [credential.variable]: !isVisible }))
                    }
                  >
                    {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {isConfigured && (
                  <button
                    type="button"
                    className="provider-remove"
                    onClick={() => void deleteKey(credential.variable)}
                  >
                    <Trash2 size={12} /> Remove key
                  </button>
                )}
              </label>
            </article>
          );
        })}
        {filtered.length === 0 && <div className="empty-provider-search">No providers match that search.</div>}
      </div>
      </>
      )}
    </section>
  );
};
