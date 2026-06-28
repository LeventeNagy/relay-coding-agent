/**
 * A coding project: a named folder on disk that code-mode chats operate inside.
 * The agent's file/command tools are scoped to `root`.
 */
export interface Project {
  id: string;
  name: string;
  /** Absolute path to the project folder on disk. */
  root: string;
  createdAt: string;
  updatedAt: string;
}

/** How the agent's risky actions (writes, commands, external access) are gated. */
export type AccessMode = "ask" | "auto" | "full";
