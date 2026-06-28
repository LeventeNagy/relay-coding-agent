import { useCallback, useEffect, useState } from "react";
import type { Project } from "../../shared/projects/types";

export interface ProjectsController {
  projects: Project[];
  ready: boolean;
  /** Create a new project folder under Documents/Relay. */
  create: (name: string) => Promise<Project | null>;
  /** Open the native picker and link an existing folder. */
  link: () => Promise<Project | null>;
  remove: (id: string) => Promise<void>;
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

  const create = useCallback(async (name: string): Promise<Project | null> => {
    try {
      const project = await window.projects.create(name);
      setProjects(await window.projects.list());
      return project;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("projects.create failed:", error);
      return null;
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

  return { projects, ready, create, link, remove, refresh };
};
