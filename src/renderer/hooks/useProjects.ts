import { useCallback, useEffect, useState } from "react";
import type { Project, ProjectFramework, Source } from "../../shared/projects/types";

export interface ProjectsController {
  projects: Project[];
  ready: boolean;
  /** Create a new project folder under Documents/Relay (default Next.js+shadcn). */
  create: (name: string, framework?: ProjectFramework) => Promise<Project | null>;
  /** Open the native picker and link an existing folder. */
  link: () => Promise<Project | null>;
  remove: (id: string) => Promise<void>;
  addSource: (
    projectId: string,
    input: { title?: string; url: string; note?: string; kind?: Source["kind"] }
  ) => Promise<void>;
  removeSource: (projectId: string, srcId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/** Loads the coding projects and exposes create/link/remove. */
export const useProjects = (): ProjectsController => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setProjects(await window.projects.list());
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("projects.list failed:", error);
    }
  }, []);

  useEffect(() => {
    let active = true;
    window.projects
      .list()
      .then((list) => {
        if (active) {
          setProjects(list);
          setReady(true);
        }
      })
      .catch(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, []);

  // Refresh when main captures links from chat into a project's sources.
  useEffect(() => window.projects.onChanged(() => void refresh()), [refresh]);

  const create = useCallback(
    async (name: string, framework?: ProjectFramework): Promise<Project | null> => {
      try {
        const project = await window.projects.create(name, framework);
        setProjects(await window.projects.list());
        return project;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("projects.create failed:", error);
        return null;
      }
    },
    []
  );

  const addSource = useCallback(
    async (
      projectId: string,
      input: { title?: string; url: string; note?: string; kind?: Source["kind"] }
    ): Promise<void> => {
      try {
        setProjects(await window.projects.addSource(projectId, input));
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("projects.addSource failed:", error);
      }
    },
    []
  );

  const removeSource = useCallback(async (projectId: string, srcId: string): Promise<void> => {
    try {
      setProjects(await window.projects.removeSource(projectId, srcId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("projects.removeSource failed:", error);
    }
  }, []);

  const link = useCallback(async (): Promise<Project | null> => {
    try {
      const project = await window.projects.link();
      if (project) {
        setProjects(await window.projects.list());
      }
      return project;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("projects.link failed:", error);
      return null;
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      setProjects(await window.projects.remove(id));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("projects.remove failed:", error);
    }
  }, []);

  return { projects, ready, create, link, remove, addSource, removeSource, refresh };
};
