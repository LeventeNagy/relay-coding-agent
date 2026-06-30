import type { Pet, PetManifest } from "../../shared/pets/types";
import sprocketSheet from "../assets/pets/sprocket/sheet.png";

// Mirrors src/renderer/assets/pets/sprocket/pet.json (regenerate the sheet with
// `node scripts/generate-builtin-pet.mjs`). Kept inline so the frame ranges keep
// their tuple types — a JSON import would widen them to number[].
const sprocketManifest: PetManifest = {
  name: "Sprocket",
  frameWidth: 48,
  frameHeight: 48,
  columns: 6,
  fps: 8,
  states: {
    idle: [0, 5],
    working: [6, 11],
    needsInput: [12, 17],
    done: [18, 23],
    error: [24, 29]
  }
};

/** Pets that ship with Relay. Users add their own (Phase 2) alongside these. */
export const builtinPets: Pet[] = [
  { id: "sprocket", name: "Sprocket", manifest: sprocketManifest, sheetUrl: sprocketSheet }
];

export const defaultPet: Pet = builtinPets[0];
