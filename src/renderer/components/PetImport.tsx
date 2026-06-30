import { useMemo, useState, type ReactElement } from "react";
import { ImagePlus, Wand2 } from "lucide-react";
import { Pet } from "./Pet";
import type {
  FrameRange,
  Pet as PetData,
  PetImagePick,
  PetInput,
  PetManifest,
  PetState
} from "../../shared/pets/types";

interface PetImportProps {
  pickImage: () => Promise<PetImagePick | null>;
  onImport: (input: PetInput) => Promise<void>;
  onCancel: () => void;
}

type ImportMode = "image" | "sheet";

const STATES: PetState[] = ["idle", "working", "needsInput", "done", "error"];

/** One row per state, clamped to the rows the sheet actually has (extras reuse idle's row). */
const autoMapRows = (columns: number, rows: number): Record<PetState, FrameRange> => {
  const out = {} as Record<PetState, FrameRange>;
  STATES.forEach((state, i) => {
    const row = rows > 0 ? Math.min(i, rows - 1) : 0;
    out[state] = [row * columns, row * columns + Math.max(0, columns - 1)];
  });
  return out;
};

/**
 * Import a user pet. Two modes:
 *  - **Simple image** (default): pick any PNG; Relay animates it + shows a status
 *    bubble. No grid, no manifest — the easy path.
 *  - **Sprite sheet** (advanced): describe the grid (frame size, fps) and map the
 *    five moods to frame ranges for frame-by-frame pixel art.
 */
export const PetImport = ({ pickImage, onImport, onCancel }: PetImportProps): ReactElement => {
  const [mode, setMode] = useState<ImportMode>("image");
  const [pick, setPick] = useState<PetImagePick | null>(null);
  const [name, setName] = useState("");
  const [frameWidth, setFrameWidth] = useState(64);
  const [frameHeight, setFrameHeight] = useState(64);
  const [fps, setFps] = useState(8);
  const [ranges, setRanges] = useState<Record<PetState, FrameRange>>(() => autoMapRows(1, 1));
  const [previewState, setPreviewState] = useState<PetState>("working");
  const [saving, setSaving] = useState(false);

  const columns = pick ? Math.max(1, Math.floor(pick.width / Math.max(1, frameWidth))) : 1;
  const rows = pick ? Math.max(1, Math.floor(pick.height / Math.max(1, frameHeight))) : 1;
  const totalFrames = columns * rows;
  const petName = name.trim() || pick?.fileName?.replace(/\.png$/i, "") || "My pet";

  const manifest: PetManifest = useMemo(
    () => ({ name: petName, frameWidth, frameHeight, columns, fps, states: ranges }),
    [petName, frameWidth, frameHeight, columns, fps, ranges]
  );

  const previewPet: PetData | null = !pick
    ? null
    : mode === "sheet"
      ? { id: "preview", name: petName, kind: "sheet", manifest, sheetUrl: pick.dataUrl }
      : { id: "preview", name: petName, kind: "image", imageUrl: pick.dataUrl };

  const choose = async (): Promise<void> => {
    const result = await pickImage();
    if (!result) {
      return;
    }
    setPick(result);
    setName(result.fileName.replace(/\.png$/i, ""));
    const cols = Math.max(1, Math.floor(result.width / Math.max(1, frameWidth)));
    const rws = Math.max(1, Math.floor(result.height / Math.max(1, frameHeight)));
    setRanges(autoMapRows(cols, rws));
  };

  const setRange = (state: PetState, idx: 0 | 1, value: number): void => {
    setRanges((current) => {
      const next = [...current[state]] as FrameRange;
      next[idx] = Math.max(0, Math.min(value, totalFrames - 1));
      return { ...current, [state]: next };
    });
  };

  const save = async (): Promise<void> => {
    if (!pick) {
      return;
    }
    setSaving(true);
    try {
      await onImport(
        mode === "sheet"
          ? { kind: "sheet", name: petName, manifest, dataUrl: pick.dataUrl }
          : { kind: "image", name: petName, dataUrl: pick.dataUrl }
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pet-import" aria-label="Import a pet">
      <div className="pet-import-mode" role="tablist" aria-label="Pet type">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "image"}
          className={mode === "image" ? "active" : ""}
          onClick={() => setMode("image")}
        >
          Simple image
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "sheet"}
          className={mode === "sheet" ? "active" : ""}
          onClick={() => setMode("sheet")}
        >
          Sprite sheet
        </button>
      </div>

      {!pick ? (
        <>
          <button type="button" className="pet-pick-btn" onClick={() => void choose()}>
            <ImagePlus size={15} /> Choose a PNG
          </button>
          <p className="pet-import-hint">
            {mode === "image"
              ? "Any picture works — a character, a logo, even an emoji exported as PNG. Relay adds the motion and a status bubble."
              : "An animated sprite sheet: a grid of equal-size frames. You'll set the frame size and map each mood to a frame range."}
          </p>
        </>
      ) : (
        <div className="pet-import-body">
          <div className="pet-import-preview">
            {previewPet && <Pet pet={previewPet} state={previewState} size={96} bubble />}
            <div className="pet-import-states">
              {STATES.map((state) => (
                <button
                  key={state}
                  type="button"
                  className={state === previewState ? "active" : ""}
                  onClick={() => setPreviewState(state)}
                >
                  {state}
                </button>
              ))}
            </div>
            {mode === "sheet" && (
              <p className="pet-import-meta">
                {pick.width}×{pick.height}px · {columns}×{rows} grid · {totalFrames} frames
              </p>
            )}
          </div>

          <div className="pet-import-fields">
            <label>
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="My pet" />
            </label>

            {mode === "sheet" && (
              <>
                <div className="pet-import-grid3">
                  <label>
                    <span>Frame width</span>
                    <input
                      type="number"
                      min={1}
                      value={frameWidth}
                      onChange={(e) => setFrameWidth(Number(e.currentTarget.value) || 1)}
                    />
                  </label>
                  <label>
                    <span>Frame height</span>
                    <input
                      type="number"
                      min={1}
                      value={frameHeight}
                      onChange={(e) => setFrameHeight(Number(e.currentTarget.value) || 1)}
                    />
                  </label>
                  <label>
                    <span>FPS</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={fps}
                      onChange={(e) => setFps(Number(e.currentTarget.value) || 1)}
                    />
                  </label>
                </div>

                <div className="pet-import-ranges">
                  <div className="pet-import-ranges-head">
                    <span>Frame range per state</span>
                    <button
                      type="button"
                      className="pet-remap"
                      onClick={() => setRanges(autoMapRows(columns, rows))}
                    >
                      <Wand2 size={12} /> Auto-map rows
                    </button>
                  </div>
                  {STATES.map((state) => (
                    <div className="pet-range-row" key={state}>
                      <label>{state}</label>
                      <input
                        type="number"
                        min={0}
                        max={totalFrames - 1}
                        value={ranges[state][0]}
                        onChange={(e) => setRange(state, 0, Number(e.currentTarget.value) || 0)}
                      />
                      <span>→</span>
                      <input
                        type="number"
                        min={0}
                        max={totalFrames - 1}
                        value={ranges[state][1]}
                        onChange={(e) => setRange(state, 1, Number(e.currentTarget.value) || 0)}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {mode === "image" && (
              <p className="pet-import-hint">
                Use the buttons under the preview to see how it reacts to each status.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="pet-import-actions">
        <button type="button" className="pet-cancel" onClick={onCancel}>
          Cancel
        </button>
        {pick && (
          <button type="button" className="pet-save" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save pet"}
          </button>
        )}
      </div>
    </div>
  );
};
