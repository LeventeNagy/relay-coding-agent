import { app } from "electron";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Project, ProjectFramework, Source } from "../shared/projects/types";

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
    const projects = parsed.projects ?? {};
    // Backfill fields for projects created before framework/sources existed.
    for (const project of Object.values(projects)) {
      project.framework ??= "blank";
      project.sources ??= [];
    }
    cache = { projects };
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

const sourceId = (): string =>
  `src_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** Doc sources auto-seeded for a Next.js + shadcn project (stable homepages). */
const seedSources = (framework: ProjectFramework): Source[] => {
  if (framework !== "nextjs-shadcn") {
    return [];
  }
  return [
    {
      id: sourceId(),
      title: "Next.js docs",
      url: "https://nextjs.org/docs",
      note: "App Router; fetch for the latest APIs",
      kind: "doc"
    },
    {
      id: sourceId(),
      title: "shadcn/ui docs",
      url: "https://ui.shadcn.com/docs",
      note: "components, install & usage",
      kind: "doc"
    }
  ];
};

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
export const createProject = (name: string, framework: ProjectFramework = "nextjs-shadcn"): Project => {
  const root = uniqueFolder(name);
  mkdirSync(root, { recursive: true });
  const now = new Date().toISOString();
  return upsert({
    id: createId(),
    name: name.trim() || "Untitled",
    root,
    framework,
    sources: seedSources(framework),
    createdAt: now,
    updatedAt: now
  });
};

/** Register an existing folder on disk as a project (defaults to a blank stack). */
export const linkProject = (root: string, name?: string): Project => {
  const now = new Date().toISOString();
  const display = name?.trim() || root.split(/[\\/]/).filter(Boolean).pop() || "Project";
  return upsert({
    id: createId(),
    name: display,
    root,
    framework: "blank",
    sources: [],
    createdAt: now,
    updatedAt: now
  });
};

/** Add a reference source to a project. Returns the updated project (or null). */
export const addSource = (
  projectId: string,
  input: { title?: string; url: string; note?: string; kind?: Source["kind"] }
): Project | null => {
  const project = getProject(projectId);
  if (!project) {
    return null;
  }
  const url = input.url.trim();
  if (!url) {
    return project;
  }
  const title = input.title?.trim() || (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  })();
  const kind = input.kind ?? (/\.mdx?($|[?#])/i.test(url) ? "design" : "link");
  const source: Source = { id: sourceId(), title, url, note: input.note?.trim() || undefined, kind };
  return upsert({ ...project, sources: [...project.sources, source], updatedAt: new Date().toISOString() });
};

/** Remove a source from a project. Returns the updated project (or null). */
export const removeSource = (projectId: string, srcId: string): Project | null => {
  const project = getProject(projectId);
  if (!project) {
    return null;
  }
  return upsert({
    ...project,
    sources: project.sources.filter((s) => s.id !== srcId),
    updatedAt: new Date().toISOString()
  });
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
