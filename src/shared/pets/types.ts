/**
 * Status "pets": a small animated companion that mirrors the agent's state.
 *
 * Two flavours, so creating one is easy:
 *  - **image**: just a single picture (any PNG/emoji). Relay adds motion per
 *    mood with CSS and shows a speech bubble — no sprite sheet needed.
 *  - **sheet**: an animated sprite sheet (a grid of frames) for pixel-art pets,
 *    described by a `PetManifest`. The advanced/power-user path.
 */

/** The moods a pet can show, mapped from the agent's live status. */
export type PetState = "idle" | "working" | "needsInput" | "done" | "error";

/** Inclusive `[firstFrame, lastFrame]` index range within the sheet (row-major). */
export type FrameRange = [number, number];

/**
 * Describes a sprite sheet so the renderer can step frames. Frames are indexed
 * row-major: index = row * columns + column. A state's range may span rows.
 * `idle` is required as the fallback when a sheet omits a state.
 */
export interface PetManifest {
  name: string;
  /** Pixel size of a single frame cell. */
  frameWidth: number;
  frameHeight: number;
  /** Number of frame columns in the sheet (drives the row-major index math). */
  columns: number;
  /** Animation speed in frames per second. */
  fps: number;
  states: { idle: FrameRange } & Partial<Record<PetState, FrameRange>>;
}

interface PetBase {
  id: string;
  name: string;
  /** True for user-imported pets (removable); absent/false for built-ins. */
  custom?: boolean;
}

/** An animated sprite-sheet pet (a grid of frames described by the manifest). */
export interface SheetPet extends PetBase {
  kind: "sheet";
  manifest: PetManifest;
  /** Resolved URL of the sprite sheet (bundled asset URL or a data URL). */
  sheetUrl: string;
}

/** A single-image pet: one picture, animated by CSS per mood. */
export interface ImagePet extends PetBase {
  kind: "image";
  /** Resolved URL of the picture (bundled asset URL or a data URL). */
  imageUrl: string;
}

/** A ready-to-render pet. */
export type Pet = SheetPet | ImagePet;

/** Payload the renderer sends to save (import) a user pet. `dataUrl` is a PNG. */
export type PetInput =
  | { id?: string; kind: "sheet"; name: string; manifest: PetManifest; dataUrl: string }
  | { id?: string; kind: "image"; name: string; dataUrl: string };

/** Result of the native PNG picker: the chosen image plus its pixel dimensions. */
export interface PetImagePick {
  dataUrl: string;
  width: number;
  height: number;
  fileName: string;
}

/** Snapshot pushed to the floating-overlay window: which pet + its current mood. */
export interface OverlayUpdate {
  pet: Pet;
  state: PetState;
}

/** Short text shown in the pet's speech bubble per mood (null = no bubble). */
export const PET_STATUS_LABEL: Record<PetState, string | null> = {
  idle: null,
  working: "Working…",
  needsInput: "Needs you!",
  done: "Done ✓",
  error: "Hit a snag"
};
