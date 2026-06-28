/** Default tech stack a project is built with (drives scaffolding + conventions). */
export type ProjectFramework = "nextjs-shadcn" | "blank";

/**
 * A persistent project reference injected into the agent's context on every code
 * turn so it never loses track. `doc` = framework documentation, `design` = a
 * design spec (often a markdown file), `link` = any other reference.
 */
export interface Source {
  id: string;
  title: string;
  url: string;
  note?: string;
  kind: "doc" | "design" | "link";
}

/**
 * A coding project: a named folder on disk that code-mode chats operate inside.
 * The agent's file/command tools are scoped to `root`.
 */
export interface Project {
  id: string;
  name: string;
  /** Absolute path to the project folder on disk. */
  root: string;
  /** Default stack; "nextjs-shadcn" seeds doc sources + scaffolding conventions. */
  framework: ProjectFramework;
  /** Persistent references injected into every code run (design docs, framework docs). */
  sources: Source[];
  createdAt: string;
  updatedAt: string;
}

/** How the agent's risky actions (writes, commands, external access) are gated. */
export type AccessMode = "ask" | "auto" | "full";
