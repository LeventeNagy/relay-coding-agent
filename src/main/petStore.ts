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
 * Persists user pets under `userData/pets/<id>/` — each with `sheet.png` (the
 * picture, whether a sprite sheet or a single image) and `meta.json` describing
 * its kind/name/manifest. Sheets are handed to the renderer as base64 data URLs
 * (the renderer has no filesystem access); pet sheets are small enough that this
 * is fine. Built-in pets ship with the app and are merged in renderer-side.
 */

interface PetMeta {
  kind: "sheet" | "image";
  name: string;
  manifest?: PetManifest;
}

const petsDir = (): string => join(app.getPath("userData"), "pets");

const createId = (): string =>
  `pet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

const toDataUrl = (bytes: Buffer): string => `data:image/png;base64,${bytes.toString("base64")}`;

/** Decode a `data:image/png;base64,…` URL to raw bytes (throws on a non-PNG URL). */
const fromDataUrl = (dataUrl: string): Buffer => {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:image/png") || comma === -1) {
    throw new Error("Pet image must be a PNG data URL");
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

/** Resolve a pet folder's metadata (meta.json, or a legacy manifest.json sheet). */
const readMeta = (base: string): PetMeta | null => {
  try {
    const metaPath = join(base, "meta.json");
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Partial<PetMeta>;
      if (meta.kind === "image") {
        return { kind: "image", name: meta.name ?? "" };
      }
      if (meta.kind === "sheet" && isManifest(meta.manifest)) {
        return { kind: "sheet", name: meta.name ?? meta.manifest.name, manifest: meta.manifest };
      }
    }
    // Legacy pets (sprite-sheet only) stored just manifest.json.
    const legacy = join(base, "manifest.json");
    if (existsSync(legacy)) {
      const manifest = JSON.parse(readFileSync(legacy, "utf8")) as unknown;
      if (isManifest(manifest)) {
        return { kind: "sheet", name: manifest.name, manifest };
      }
    }
  } catch {
    /* malformed — skip */
  }
  return null;
};

/** All user pets, newest first, with images resolved to data URLs. */
export const listPets = (): Pet[] => {
  const dir = petsDir();
  if (!existsSync(dir)) {
    return [];
  }
  const out: Array<{ pet: Pet; mtime: number }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const base = join(dir, entry.name);
    const meta = readMeta(base);
    if (!meta) continue;
    try {
      const url = toDataUrl(readFileSync(join(base, "sheet.png")));
      const common = { id: entry.name, name: meta.name || entry.name, custom: true as const };
      const pet: Pet =
        meta.kind === "sheet" && meta.manifest
          ? { ...common, kind: "sheet", manifest: meta.manifest, sheetUrl: url }
          : { ...common, kind: "image", imageUrl: url };
      out.push({ pet, mtime: Number(entry.name.split("_")[1] ?? 0) });
    } catch {
      // Skip a pet whose image is missing/unreadable rather than failing the list.
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime).map((p) => p.pet);
};

/** Create or overwrite a user pet, returning the refreshed list. */
export const savePet = (input: PetInput): Pet[] => {
  if (input.kind === "sheet" && !isManifest(input.manifest)) {
    throw new Error("Invalid pet manifest");
  }
  const bytes = fromDataUrl(input.dataUrl);
  const id = input.id ?? createId();
  const base = join(petsDir(), id);
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, "sheet.png"), bytes);
  const name = input.name.trim() || (input.kind === "sheet" ? input.manifest.name : "My pet");
  const meta: PetMeta =
    input.kind === "sheet"
      ? { kind: "sheet", name, manifest: { ...input.manifest, name } }
      : { kind: "image", name };
  writeFileSync(join(base, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
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

/** Open the native PNG picker; returns the chosen image + its dimensions, or null. */
export const pickPetImage = async (): Promise<PetImagePick | null> => {
  const result = await dialog.showOpenDialog({
    title: "Choose a pet image (PNG)",
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
