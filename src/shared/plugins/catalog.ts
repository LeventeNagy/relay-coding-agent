import type { PluginCatalogEntry } from "./types";

/**
 * Curated set of known, local (stdio) MCP servers Relay can install. These are
 * the official `@modelcontextprotocol/*` reference servers plus a couple of
 * popular community ones, all launchable via `npx -y`. Adding one prefills the
 * Add form with the exact command/args and any required env or arg hints.
 *
 * Ground truth for package names: https://github.com/modelcontextprotocol/servers
 */
export const pluginCatalog: PluginCatalogEntry[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read, write, and search files in a directory you choose.",
    category: "Developer Tools",
    featured: true,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    argHints: [{ label: "Allowed directory", placeholder: "C:\\\\projects\\\\my-app" }]
  },
  {
    id: "git",
    name: "Git",
    description: "Inspect a local Git repository — status, diffs, logs, and history.",
    category: "Developer Tools",
    featured: true,
    command: "npx",
    args: ["-y", "mcp-server-git", "--repository"],
    argHints: [{ label: "Repository path", placeholder: "C:\\\\projects\\\\my-app" }]
  },
  {
    id: "github",
    name: "GitHub",
    description: "Search repos, read issues and PRs, and manage GitHub from chat.",
    category: "Developer Tools",
    featured: true,
    // GitHub's MCP server doesn't support OAuth dynamic client registration, so
    // it uses a personal access token (one paste, with a deep-link to create it).
    auth: "key",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    keyUrl: "https://github.com/settings/tokens",
    envHints: [
      {
        key: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "GitHub personal access token",
        required: true,
        placeholder: "ghp_…"
      }
    ]
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search, read, and edit your Notion pages and databases.",
    category: "Productivity",
    featured: true,
    transport: "http",
    auth: "oauth",
    url: "https://mcp.notion.com/mcp"
  },
  {
    id: "linear",
    name: "Linear",
    description: "Create and update Linear issues, projects, and cycles from chat.",
    category: "Productivity",
    featured: true,
    transport: "http",
    auth: "oauth",
    url: "https://mcp.linear.app/mcp"
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Fetch a URL and convert the page to clean markdown for the model.",
    category: "Data & Research",
    featured: true,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"]
  },
  {
    id: "memory",
    name: "Memory",
    description: "A persistent knowledge graph the agent can write to and recall.",
    category: "Productivity",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"]
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "A structured step-by-step reasoning scratchpad tool.",
    category: "Productivity",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"]
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Query and explore a local SQLite database file.",
    category: "Data & Research",
    command: "npx",
    args: ["-y", "mcp-server-sqlite-npx"],
    argHints: [{ label: "Database file", placeholder: "C:\\\\data\\\\app.db" }]
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Web and local search powered by the Brave Search API.",
    category: "Data & Research",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    keyUrl: "https://api-dashboard.search.brave.com/app/keys",
    envHints: [
      { key: "BRAVE_API_KEY", label: "Brave Search API key", required: true, placeholder: "BSA…" }
    ]
  },
  {
    id: "slack",
    name: "Slack",
    description: "Read channels and post messages to a Slack workspace.",
    category: "Communication",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    keyUrl: "https://api.slack.com/apps",
    envHints: [
      { key: "SLACK_BOT_TOKEN", label: "Slack bot token", required: true, placeholder: "xoxb-…" },
      { key: "SLACK_TEAM_ID", label: "Slack team ID", required: true, placeholder: "T…" }
    ]
  },
  {
    id: "postgres",
    name: "Postgres",
    description: "Run read-only SQL against a PostgreSQL database.",
    category: "Data & Research",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    argHints: [
      { label: "Connection string", placeholder: "postgresql://user:pass@host:5432/db" }
    ]
  }
];

/** Distinct category names in catalog order (for the marketplace sections + filter). */
export const catalogCategories = (): string[] => {
  const seen: string[] = [];
  for (const entry of pluginCatalog) {
    if (!seen.includes(entry.category)) {
      seen.push(entry.category);
    }
  }
  return seen;
};

export const featuredCatalog = (): PluginCatalogEntry[] => pluginCatalog.filter((e) => e.featured);

export const catalogById = (id: string): PluginCatalogEntry | undefined =>
  pluginCatalog.find((entry) => entry.id === id);
