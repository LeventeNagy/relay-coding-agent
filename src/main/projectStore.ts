import { app } from "electron";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Project } from "../shared/projects/types";

/**
 * Persists coding projects (name + on-disk folder) to a single JSON file under
 * userData, mirroring sessionStore. Default project folders are created under
 * the user's Documents/Relay so they're easy to open in an editor; an existing
 * folder can also be linked. Removing a project only forgets the record — files
 * on disk are never deleted.
 */

interface PersistedShape {
  projects: Record<string, Project>;
}

let cache: PersistedShape | null = null;

const filePath = (): string => join(app.getPath("userData"), "relay-projects.json");

/** Root folder all default projects are created under. */
const projectsHome = (): string => join(app.getPath("documents"), "Relay");

const load = (): PersistedShape => {
  if (cache) {
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath(), "utf8")) as Partial<PersistedShape>;
    cache = { projects: parsed.projects ?? {} };
  } catch {
    cache = { projects: {} };
  }
  return cache;
};

const persist = (state: PersistedShape): void => {
  cache = state;
  const path = filePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
};

const createId = (): string =>
  `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** Filesystem-safe folder name from a display name. */
const slugify = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "project";

/** A folder under Documents/Relay that doesn't collide with an existing one. */
const uniqueFolder = (name: string): string => {
  const base = slugify(name);
  let candidate = join(projectsHome(), base);
  let n = 2;
  while (existsSync(candidate)) {
    candidate = join(projectsHome(), `${base}-${n}`);
    n += 1;
  }
  return candidate;
};

export const listProjects = (): Project[] =>
  Object.values(load().projects).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const getProject = (id: string): Project | null => load().projects[id] ?? null;

const upsert = (project: Project): Project => {
  const state = load();
  persist({ projects: { ...state.projects, [project.id]: project } });
  return project;
};

/** Create a brand-new project folder under Documents/Relay/<slug>. */
export const createProject = (name: string): Project => {
  const root = uniqueFolder(name);
  mkdirSync(root, { recursive: true });
  const now = new Date().toISOString();
  return upsert({ id: createId(), name: name.trim() || "Untitled", root, createdAt: now, updatedAt: now });
};

/** Register an existing folder on disk as a project. */
export const linkProject = (root: string, name?: string): Project => {
  const now = new Date().toISOString();
  const display = name?.trim() || root.split(/[\\/]/).filter(Boolean).pop() || "Project";
  return upsert({ id: createId(), name: display, root, createdAt: now, updatedAt: now });
};

/** Bump a project's updatedAt (e.g. when one of its chats is used). */
export const touchProject = (id: string): void => {
  const project = getProject(id);
  if (project) {
    upsert({ ...project, updatedAt: new Date().toISOString() });
  }
};

/** Forget a project record. Does NOT delete its folder on disk. */
export const removeProject = (id: string): void => {
  const state = load();
  if (!state.projects[id]) {
    return;
  }
  const next = { ...state.projects };
  delete next[id];
  persist({ projects: next });
};
