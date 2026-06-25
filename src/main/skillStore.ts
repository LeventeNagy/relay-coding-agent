import { app } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { slugify, type Skill, type SkillInput } from "../shared/skills/types";

/**
 * Persists user-defined skills as plain JSON (`relay-skills.json` in userData).
 * Skills hold no secrets, so unlike provider keys / plugin env they are not
 * encrypted. Slugs are kept unique so `/<slug>` references resolve to one skill.
 */

let cache: Skill[] | null = null;

const filePath = (): string => join(app.getPath("userData"), "relay-skills.json");

const load = (): Skill[] => {
  if (cache) {
    return cache;
  }
  try {
    const raw = readFileSync(filePath(), "utf8");
    const parsed = JSON.parse(raw) as Skill[];
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
};

const persist = (skills: Skill[]): void => {
  cache = skills;
  const path = filePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(skills, null, 2), "utf8");
};

const createId = (): string => `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** Make a slug unique against the other skills (suffixing -2, -3, … on clash). */
const uniqueSlug = (base: string, skills: Skill[], ignoreId?: string): string => {
  let slug = base;
  let n = 2;
  while (skills.some((s) => s.slug === slug && s.id !== ignoreId)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
};

export const listSkills = (): Skill[] => [...load()];

export const getSkill = (id: string): Skill | undefined => load().find((s) => s.id === id);

/** Create or update a skill; returns the full list. */
export const saveSkill = (input: SkillInput): Skill[] => {
  const skills = load();
  const now = new Date().toISOString();
  const base = slugify(input.name);

  if (input.id) {
    const next = skills.map((skill) =>
      skill.id === input.id
        ? {
            ...skill,
            name: input.name,
            description: input.description,
            instructions: input.instructions,
            slug: uniqueSlug(base, skills, skill.id),
            updatedAt: now
          }
        : skill
    );
    persist(next);
    return [...next];
  }

  const skill: Skill = {
    id: createId(),
    slug: uniqueSlug(base, skills),
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    createdAt: now,
    updatedAt: now
  };
  const next = [...skills, skill];
  persist(next);
  return next;
};

export const deleteSkill = (id: string): Skill[] => {
  const next = load().filter((s) => s.id !== id);
  persist(next);
  return next;
};
