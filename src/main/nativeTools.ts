import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listSkills, saveSkill } from "./skillStore";
import { searchWeb } from "./webSearch";
import type { WorkspaceMode } from "../shared/agent/types";

/**
 * Relay's own (non-MCP) tools, always available to the agent. They run in the
 * main process, so `execute` can call the skill store directly and use Node's
 * global `fetch`. Wired into the agent via the constructor `tools` (see
 * agentService) so they coexist with per-run MCP toolsets.
 */

/** Cap fetched bodies so a huge page can't blow the model's context window. */
const MAX_FETCH_CHARS = 100_000;

const fetchUrl = createTool({
  id: "fetch_url",
  description:
    "Fetch the text content at a URL (HTML, Markdown, JSON, etc.). Use this to read a " +
    "skill definition or docs the user links before installing or summarizing it.",
  inputSchema: z.object({
    url: z.string().url().describe("The absolute URL to fetch.")
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    status: z.number().optional(),
    content: z.string().optional(),
    error: z.string().optional()
  }),
  execute: async ({ url }) => {
    console.log(`[relay] tool fetch_url url=${url}`);
    try {
      // Abort hung connections so a dead URL can't stall the whole agent run.
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        content: text.slice(0, MAX_FETCH_CHARS)
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
});

const webSearch = createTool({
  id: "web_search",
  description:
    "Search the web for current, factual, or recent information. Returns ranked results " +
    "(title, url, snippet — and extracted content when available). Use this whenever the " +
    "answer depends on up-to-date or external facts, then call fetch_url on the most " +
    "relevant result to read it in full. Always cite the sources you used.",
  inputSchema: z.object({
    query: z.string().min(1).describe("The search query."),
    depth: z
      .enum(["basic", "advanced"])
      .optional()
      .describe("'advanced' for deeper research (more results + page content); defaults to 'basic'.")
  }),
  outputSchema: z.object({
    provider: z.string(),
    answer: z.string().optional(),
    results: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
        content: z.string().optional()
      })
    ),
    error: z.string().optional()
  }),
  execute: async ({ query, depth }) => {
    const { results, answer, provider, error } = await searchWeb(query, { depth });
    return { provider, answer, results, error };
  }
});

const installSkill = createTool({
  id: "install_skill",
  description:
    "Save a reusable skill the user can invoke in chat with /<slug>. ONLY call this when the user " +
    "EXPLICITLY asks to install/save/add a skill (e.g. 'install this skill', 'save this as a skill'). " +
    "Do NOT install a skill as a side effect of another task such as writing code or a landing page. " +
    "If a skill with the same name already exists it is updated in place (no duplicate). Provide a " +
    "short name, a one-line description, and the full instruction body; optionally restrict it to the " +
    "'chat' and/or 'code' workspace (omit for both).",
  inputSchema: z.object({
    name: z.string().min(1).describe("Short skill name, e.g. 'Frontend Design'."),
    description: z.string().describe("One-line summary of what the skill does."),
    instructions: z.string().min(1).describe("The full instruction body applied when the skill runs."),
    modes: z
      .array(z.enum(["chat", "code"]))
      .optional()
      .describe("Workspaces to offer the skill in. Omit for both.")
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    slug: z.string().optional(),
    updated: z.boolean(),
    message: z.string()
  }),
  execute: async ({ name, description, instructions, modes }) => {
    // Upsert by name (case-insensitive) so re-installing replaces rather than
    // creating a "-2" duplicate.
    const existing = listSkills().find((skill) => skill.name.toLowerCase() === name.toLowerCase());
    console.log(`[relay] tool install_skill name=${name} ${existing ? "(update)" : "(new)"}`);
    const list = saveSkill({
      id: existing?.id,
      name,
      description,
      instructions,
      modes: modes as WorkspaceMode[] | undefined
    });
    const saved = list.find((skill) => skill.id === existing?.id) ??
      [...list].reverse().find((skill) => skill.name === name);
    return {
      ok: true,
      slug: saved?.slug,
      updated: Boolean(existing),
      message: saved
        ? `${existing ? "Updated" : "Installed"} skill "${name}". Reference it with /${saved.slug}.`
        : `${existing ? "Updated" : "Installed"} skill "${name}".`
    };
  }
});

export const nativeTools = {
  fetch_url: fetchUrl,
  web_search: webSearch,
  install_skill: installSkill
};
