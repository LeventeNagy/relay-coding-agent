/**
 * A Skill is a reusable instruction the agent can apply on demand. Users add
 * them in the Skills tab and reference them in chat with `/<slug>`; the referenced
 * skill's `instructions` are injected into that run's system prompt.
 */
export interface Skill {
  id: string;
  /** Kebab-case handle used for `/<slug>` references (unique). */
  slug: string;
  name: string;
  description: string;
  /** The instruction body handed to the agent when the skill is applied. */
  instructions: string;
  createdAt: string;
  updatedAt: string;
}

/** Payload the renderer sends to create/update a skill. */
export interface SkillInput {
  id?: string;
  name: string;
  description: string;
  instructions: string;
}

/** Compact skill reference passed to the agent for a single run. */
export interface SkillRef {
  name: string;
  instructions: string;
}

/** Derive a kebab-case slug from a skill name. */
export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "skill";
