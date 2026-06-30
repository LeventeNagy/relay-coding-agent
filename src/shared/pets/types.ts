/**
 * Status "pets": a small animated companion that mirrors the agent's state. The
 * art is a sprite sheet (one PNG, a grid of frames) so users can *generate* their
 * own with AI tools (PixelLab, Musely, …) and drop them in — the only contract is
 * this manifest describing the grid and which frame range plays for each state.
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

/** A ready-to-render pet: its manifest plus a resolved sheet image URL. */
export interface Pet {
  id: string;
  name: string;
  manifest: PetManifest;
  /** Resolved URL of the sprite sheet (bundled asset URL or a `file://`/data URL). */
  sheetUrl: string;
  /** True for user-imported pets (removable); absent/false for built-ins. */
  custom?: boolean;
}

/** Payload the renderer sends to save (import) a user pet. */
export interface PetInput {
  /** Provide to overwrite an existing user pet; omit to create a new one. */
  id?: string;
  name: string;
  manifest: PetManifest;
  /** The sprite sheet as a `data:image/png;base64,…` URL. */
  dataUrl: string;
}

/** Result of the native PNG picker: the chosen sheet plus its pixel dimensions. */
export interface PetImagePick {
  dataUrl: string;
  width: number;
  height: number;
  fileName: string;
}

/** Snapshot pushed to the floating-overlay window: which pet + its current mood. */
export interface OverlayUpdate {
  name: string;
  manifest: PetManifest;
  sheetUrl: string;
  state: PetState;
}
