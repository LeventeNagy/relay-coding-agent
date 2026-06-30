import { app, dialog } from "electron";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync
} from "node:fs";
import { join } from "node:path";
import type { Pet, PetImagePick, PetInput, PetManifest } from "../shared/pets/types";

/**
 * Persists user-imported status pets under `userData/pets/<id>/` — each holding
 * `sheet.png` (the sprite sheet) and `manifest.json`. Sheets are handed to the
 * renderer as base64 data URLs (the renderer has no filesystem access), which is
 * fine given how small a pet sheet is. Built-in pets ship with the app and are
 * merged in on the renderer side; this store only owns the user's own pets.
 */

const petsDir = (): string => join(app.getPath("userData"), "pets");

const createId = (): string =>
  `pet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

const toDataUrl = (bytes: Buffer): string => `data:image/png;base64,${bytes.toString("base64")}`;

/** Decode a `data:image/png;base64,…` URL to raw bytes (throws on a non-PNG URL). */
const fromDataUrl = (dataUrl: string): Buffer => {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:image/png") || comma === -1) {
    throw new Error("Pet sheet must be a PNG data URL");
  }
  return Buffer.from(dataUrl.slice(comma + 1), "base64");
};

/** Read a PNG's width/height from its IHDR chunk (bytes 16–24). */
const pngDimensions = (bytes: Buffer): { width: number; height: number } => {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const ok = sig.every((b, i) => bytes[i] === b);
  if (!ok || bytes.length < 24) {
    throw new Error("Not a valid PNG");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

const isManifest = (value: unknown): value is PetManifest => {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.frameWidth === "number" &&
    typeof m.frameHeight === "number" &&
    typeof m.columns === "number" &&
    typeof m.fps === "number" &&
    !!m.states &&
    typeof m.states === "object" &&
    Array.isArray((m.states as Record<string, unknown>).idle)
  );
};

/** All user pets, newest first, with sheets resolved to data URLs. */
export const listPets = (): Pet[] => {
  const dir = petsDir();
  if (!existsSync(dir)) {
    return [];
  }
  const pets: Array<{ pet: Pet; mtime: number }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const base = join(dir, entry.name);
    const sheetPath = join(base, "sheet.png");
    const manifestPath = join(base, "manifest.json");
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
      if (!isManifest(manifest)) continue;
      const bytes = readFileSync(sheetPath);
      pets.push({
        pet: {
          id: entry.name,
          name: manifest.name || entry.name,
          manifest,
          sheetUrl: toDataUrl(bytes),
          custom: true
        },
        mtime: Number(entry.name.split("_")[1] ?? 0)
      });
    } catch {
      // Skip malformed pet folders rather than failing the whole list.
    }
  }
  return pets.sort((a, b) => b.mtime - a.mtime).map((p) => p.pet);
};

/** Create or overwrite a user pet, returning the refreshed list. */
export const savePet = (input: PetInput): Pet[] => {
  if (!isManifest(input.manifest)) {
    throw new Error("Invalid pet manifest");
  }
  const bytes = fromDataUrl(input.dataUrl);
  const id = input.id ?? createId();
  const base = join(petsDir(), id);
  mkdirSync(base, { recursive: true });
  const manifest: PetManifest = { ...input.manifest, name: input.name.trim() || input.manifest.name };
  writeFileSync(join(base, "sheet.png"), bytes);
  writeFileSync(join(base, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return listPets();
};

/** Forget (and delete the files of) a user pet, returning the refreshed list. */
export const removePet = (id: string): Pet[] => {
  // Guard against path tricks: only ever touch a direct child of petsDir.
  if (id.includes("/") || id.includes("\\") || id.includes("..")) {
    return listPets();
  }
  const base = join(petsDir(), id);
  if (existsSync(base)) {
    rmSync(base, { recursive: true, force: true });
  }
  return listPets();
};

/** Open the native PNG picker; returns the chosen sheet + its dimensions, or null. */
export const pickPetImage = async (): Promise<PetImagePick | null> => {
  const result = await dialog.showOpenDialog({
    title: "Choose a pet sprite sheet (PNG)",
    properties: ["openFile"],
    filters: [{ name: "PNG image", extensions: ["png"] }]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const path = result.filePaths[0];
  const bytes = readFileSync(path);
  const { width, height } = pngDimensions(bytes);
  const fileName = path.split(/[\\/]/).filter(Boolean).pop() ?? "pet.png";
  return { dataUrl: toDataUrl(bytes), width, height, fileName };
};
