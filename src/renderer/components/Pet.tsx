import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import type { Pet as PetData, PetState } from "../../shared/pets/types";

interface PetProps {
  pet: PetData;
  state: PetState;
  /** Rendered width in px; height scales to keep the frame aspect. Defaults to frameWidth. */
  size?: number;
  title?: string;
}

/**
 * Renders one frame of a sprite sheet and steps through the active state's frame
 * range at the manifest's fps. Frames are indexed row-major (index = row*columns
 * + col), so a state range may span rows. No animation library: we just move
 * `background-position` on an interval, which stays crisp with `image-rendering`.
 */
export const Pet = ({ pet, state, size, title }: PetProps): ReactElement => {
  const { manifest, sheetUrl } = pet;
  const { frameWidth, frameHeight, columns, fps } = manifest;
  const [start, end] = manifest.states[state] ?? manifest.states.idle;

  const [frame, setFrame] = useState(start);
  const frameRef = useRef(start);

  useEffect(() => {
    frameRef.current = start;
    setFrame(start);
    const span = Math.max(1, end - start + 1);
    if (span <= 1) {
      return;
    }
    const id = window.setInterval(() => {
      const next = frameRef.current >= end ? start : frameRef.current + 1;
      frameRef.current = next;
      setFrame(next);
    }, 1000 / Math.max(1, fps));
    return () => window.clearInterval(id);
  }, [state, start, end, fps]);

  const col = frame % columns;
  const row = Math.floor(frame / columns);
  const scale = (size ?? frameWidth) / frameWidth;

  // Scale via background-size (not transform) so the element's layout box equals
  // the rendered size and corner docking stays exact. Sheet height is left `auto`
  // so the aspect — and therefore the row offset — stays correct without needing
  // the row count in the manifest.
  const style: CSSProperties = {
    width: frameWidth * scale,
    height: frameHeight * scale,
    backgroundImage: `url(${sheetUrl})`,
    backgroundSize: `${columns * frameWidth * scale}px auto`,
    backgroundPosition: `-${col * frameWidth * scale}px -${row * frameHeight * scale}px`
  };

  return (
    <div
      className="relay-pet"
      style={style}
      role="img"
      aria-label={title ?? `${manifest.name}: ${state}`}
      title={title}
    />
  );
};
