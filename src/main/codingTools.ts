import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { AccessMode } from "../shared/projects/types";
import type { AgentAnswer, AgentQuestion } from "../shared/agent/types";

/**
 * Builds the code-mode tool set for a single run, scoped to one project folder.
 * Created fresh per run so the tools can close over the project root, the
 * permission mode, and the approval channel (the per-run Agent is built the same
 * way in agentService). File paths are resolved against — and confined to — the
 * project root unless the user granted Full access. Writes and commands are
 * gated through `requestApproval` according to the access mode.
 */

export interface ApprovalRequest {
  tool: string;
  summary: string;
  detail?: string;
}

export interface CodingContext {
  projectRoot: string;
  accessMode: AccessMode;
  /** Plan mode: expose only read-only tools (no writes/edits/commands). */
  planMode?: boolean;
  /** Ask the user to approve a risky action; resolves true (allow) / false (deny). */
  requestApproval: (req: ApprovalRequest) => Promise<boolean>;
  /** Ask the user clickable clarifying questions; resolves with their answers. */
  requestUserInput: (questions: AgentQuestion[]) => Promise<AgentAnswer[]>;
}

const execAsync = promisify(exec);
const MAX_READ_CHARS = 100_000;
const MAX_OUTPUT_CHARS = 20_000;
// Generous: create-next-app + npm install + builds can take minutes.
const COMMAND_TIMEOUT_MS = 300_000;

const cap = (text: string, max = MAX_OUTPUT_CHARS): string =>
  text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;

export const buildCodingTools = (ctx: CodingContext): Record<string, unknown> => {
  const { projectRoot, accessMode, requestApproval, requestUserInput } = ctx;

  const askUser = createTool({
    id: "ask_user",
    description:
      "Ask the user one or more clarifying questions and get their answers. Prefer CLICKABLE " +
      "options (radio/checkbox) over listing '(A)/(B)/(C)' in prose — the user picks with the " +
      "mouse. For open-ended answers (e.g. a project NAME, a tagline) OMIT `options` entirely and " +
      "the user gets a free-text box. Every question also has a free-text 'Other' field. Group " +
      "related questions into one call (up to ~4); put a recommended default option first.",
    inputSchema: z.object({
      questions: z
        .array(
          z.object({
            question: z.string().describe("The question to ask."),
            header: z.string().optional().describe("Short category label (≤12 chars)."),
            multiSelect: z.boolean().optional().describe("Allow choosing multiple options."),
            options: z
              .array(z.object({ label: z.string(), description: z.string().optional() }))
              .optional()
              .describe("Choices for a multiple-choice question; OMIT for a free-text answer.")
          })
        )
        .describe("The questions to present (usually 1-4).")
    }),
    outputSchema: z.object({
      answers: z.array(z.object({ question: z.string(), selected: z.array(z.string()) }))
    }),
    execute: async ({ questions }) => {
      // Normalize so every question has an options array (free-text → []).
      const normalized: AgentQuestion[] = (questions ?? []).map((q) => ({
        question: q.question,
        header: q.header,
        multiSelect: q.multiSelect,
        options: q.options ?? []
      }));
      const answers = await requestUserInput(normalized);
      return { answers };
    }
  });

  /** Resolve a relative path inside the project; block escapes unless Full access. */
  const resolveInRoot = (rel: string): { ok: true; target: string } | { ok: false; error: string } => {
    const target = resolve(projectRoot, rel);
    const within = target === projectRoot || target.startsWith(projectRoot + sep);
    if (!within && accessMode !== "full") {
      return { ok: false, error: `Path "${rel}" is outside the project folder. Switch to Full access to allow this.` };
    }
    return { ok: true, target };
  };

  /** Approve gate. `risky` actions (commands) are asked even in "auto" mode. */
  const allowed = (req: ApprovalRequest, risky: boolean): Promise<boolean> => {
    if (accessMode === "full") {
      return Promise.resolve(true);
    }
    if (accessMode === "auto" && !risky) {
      return Promise.resolve(true);
    }
    return requestApproval(req);
  };

  const listDir = createTool({
    id: "list_dir",
    description: "List the files and folders at a path inside the project (defaults to the project root).",
    inputSchema: z.object({ path: z.string().optional().describe("Relative path; defaults to '.'.") }),
    outputSchema: z.object({
      ok: z.boolean(),
      entries: z.array(z.object({ name: z.string(), kind: z.enum(["file", "dir"]) })).optional(),
      error: z.string().optional()
    }),
    execute: async ({ path: rel }) => {
      const r = resolveInRoot(rel ?? ".");
      if (!r.ok) {
        return { ok: false, error: r.error };
      }
      try {
        const names = await readdir(r.target);
        const entries = await Promise.all(
          names.map(async (name) => {
            const info = await stat(resolve(r.target, name)).catch(() => null);
            return { name, kind: (info?.isDirectory() ? "dir" : "file") as "file" | "dir" };
          })
        );
        return { ok: true, entries };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  const readFileTool = createTool({
    id: "read_file",
    description: "Read a text file inside the project and return its contents.",
    inputSchema: z.object({ path: z.string().describe("Relative path to the file.") }),
    outputSchema: z.object({ ok: z.boolean(), content: z.string().optional(), error: z.string().optional() }),
    execute: async ({ path: rel }) => {
      const r = resolveInRoot(rel);
      if (!r.ok) {
        return { ok: false, error: r.error };
      }
      try {
        const content = await readFile(r.target, "utf8");
        return { ok: true, content: cap(content, MAX_READ_CHARS) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  const writeFileTool = createTool({
    id: "write_file",
    description: "Create or overwrite a text file inside the project. Creates parent folders as needed.",
    inputSchema: z.object({
      path: z.string().describe("Relative path to the file."),
      content: z.string().describe("Full new file contents.")
    }),
    outputSchema: z.object({ ok: z.boolean(), error: z.string().optional() }),
    execute: async ({ path: rel, content }) => {
      const r = resolveInRoot(rel);
      if (!r.ok) {
        return { ok: false, error: r.error };
      }
      if (!(await allowed({ tool: "write_file", summary: `Write ${rel}`, detail: `${content.length} chars` }, false))) {
        return { ok: false, error: "Denied by user — skipped." };
      }
      try {
        await mkdir(dirname(r.target), { recursive: true });
        await writeFile(r.target, content, "utf8");
        console.log(`[relay] write_file ${rel} (${content.length} chars)`);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  const editFileTool = createTool({
    id: "edit_file",
    description:
      "Edit a file by replacing an exact unique snippet with new text. `old_string` must match exactly and appear exactly once.",
    inputSchema: z.object({
      path: z.string().describe("Relative path to the file."),
      old_string: z.string().describe("Exact text to replace (must be unique in the file)."),
      new_string: z.string().describe("Replacement text.")
    }),
    outputSchema: z.object({ ok: z.boolean(), error: z.string().optional() }),
    execute: async ({ path: rel, old_string, new_string }) => {
      const r = resolveInRoot(rel);
      if (!r.ok) {
        return { ok: false, error: r.error };
      }
      if (!(await allowed({ tool: "edit_file", summary: `Edit ${rel}` }, false))) {
        return { ok: false, error: "Denied by user — skipped." };
      }
      try {
        const current = await readFile(r.target, "utf8");
        const count = current.split(old_string).length - 1;
        if (count === 0) {
          return { ok: false, error: "old_string not found in the file." };
        }
        if (count > 1) {
          return { ok: false, error: `old_string is not unique (${count} matches). Add more context.` };
        }
        await writeFile(r.target, current.replace(old_string, new_string), "utf8");
        console.log(`[relay] edit_file ${rel}`);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  const runCommandTool = createTool({
    id: "run_command",
    description:
      "Run a shell command in the project folder (e.g. npm install, build, run tests, start a dev server). Use to set up and VERIFY your work.",
    inputSchema: z.object({ command: z.string().describe("The shell command to run.") }),
    outputSchema: z.object({
      ok: z.boolean(),
      stdout: z.string().optional(),
      stderr: z.string().optional(),
      error: z.string().optional()
    }),
    execute: async ({ command }) => {
      if (!(await allowed({ tool: "run_command", summary: `Run: ${command}` }, true))) {
        return { ok: false, error: "Denied by user — skipped." };
      }
      console.log(`[relay] run_command (${projectRoot}): ${command}`);
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: projectRoot,
          timeout: COMMAND_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true
        });
        return { ok: true, stdout: cap(stdout), stderr: cap(stderr) };
      } catch (error) {
        const e = error as { message?: string; stdout?: string; stderr?: string };
        return {
          ok: false,
          error: e.message ?? String(error),
          stdout: cap(e.stdout ?? ""),
          stderr: cap(e.stderr ?? "")
        };
      }
    }
  });

  // Plan mode: read-only exploration + ask the user (no writes/edits/commands).
  if (ctx.planMode) {
    return { list_dir: listDir, read_file: readFileTool, ask_user: askUser };
  }

  return {
    list_dir: listDir,
    read_file: readFileTool,
    write_file: writeFileTool,
    edit_file: editFileTool,
    run_command: runCommandTool,
    ask_user: askUser
  };
};
