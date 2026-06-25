import { useCallback, useEffect, useState } from "react";
import type { Skill, SkillInput } from "../../shared/skills/types";

export interface SkillsController {
  skills: Skill[];
  ready: boolean;
  save: (input: SkillInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/** Loads user skills once and exposes mutators that keep the list in sync. */
export const useSkills = (): SkillsController => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    window.skills
      .list()
      .then((list) => {
        if (active) {
          setSkills(list);
          setReady(true);
        }
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("skills.list failed:", error);
        if (active) {
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async (input: SkillInput) => {
    try {
      setSkills(await window.skills.save(input));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("skills.save failed:", error);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      setSkills(await window.skills.delete(id));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("skills.delete failed:", error);
    }
  }, []);

  return { skills, ready, save, remove };
};
