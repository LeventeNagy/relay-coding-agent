import { useCallback, useEffect, useMemo, useState } from "react";
import type { Pet, PetImagePick, PetInput } from "../../shared/pets/types";
import { builtinPets, defaultPet } from "../pets/builtins";

const ACTIVE_KEY = "relay:activePetId";

export interface PetsController {
  /** Built-in pets followed by the user's imported ones. */
  pets: Pet[];
  userPets: Pet[];
  /** The pet currently shown as the companion (falls back to the default). */
  activePet: Pet;
  activePetId: string;
  setActivePet: (id: string) => void;
  /** Save (import) a pet and make it active. */
  importPet: (input: PetInput) => Promise<void>;
  removePet: (id: string) => Promise<void>;
  pickImage: () => Promise<PetImagePick | null>;
}

/** Loads user pets from the main process and merges them with the built-ins. */
export const usePets = (): PetsController => {
  const [userPets, setUserPets] = useState<Pet[]>([]);
  const [activePetId, setActivePetId] = useState<string>(
    () => localStorage.getItem(ACTIVE_KEY) ?? defaultPet.id
  );

  useEffect(() => {
    let active = true;
    window.pets
      .list()
      .then((list) => {
        if (active) setUserPets(list);
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("pets.list failed:", error);
      });
    return () => {
      active = false;
    };
  }, []);

  const pets = useMemo(() => [...builtinPets, ...userPets], [userPets]);
  const activePet = pets.find((p) => p.id === activePetId) ?? defaultPet;

  const setActivePet = useCallback((id: string) => {
    setActivePetId(id);
    localStorage.setItem(ACTIVE_KEY, id);
  }, []);

  const importPet = useCallback(
    async (input: PetInput) => {
      const list = await window.pets.save(input);
      setUserPets(list);
      if (list[0]) {
        setActivePet(list[0].id);
      }
    },
    [setActivePet]
  );

  const removePet = useCallback(async (id: string) => {
    const list = await window.pets.remove(id);
    setUserPets(list);
    setActivePetId((current) => {
      if (current === id) {
        localStorage.setItem(ACTIVE_KEY, defaultPet.id);
        return defaultPet.id;
      }
      return current;
    });
  }, []);

  const pickImage = useCallback(() => window.pets.pickImage(), []);

  return { pets, userPets, activePet, activePetId, setActivePet, importPet, removePet, pickImage };
};
