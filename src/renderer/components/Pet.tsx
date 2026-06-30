import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import {
  PET_STATUS_LABEL,
  type Pet as PetData,
  type PetState,
  type SheetPet
} from "../../shared/pets/types";

interface PetProps {
  pet: PetData;
  state: PetState;
  /** Rendered width in px (height matches for images). Defaults to a sensible size. */
  size?: number;
  title?: string;
  /** Show a speech bubble with the current status (hidden when idle). */
  bubble?: boolean;
}

/**
 * Steps through a sprite sheet's active state range at the manifest fps. Frames
 * are indexed row-major (index = row*columns + col), so a range may span rows.
 */
const SheetView = ({ pet, state, size }: { pet: SheetPet; state: PetState; size?: number }): ReactElement => {
  const { manifest, sheetUrl } = pet;
  const { frameWidth, frameHeight, columns, fps } = manifest;
  const [start, end] = manifest.states[state] ?? manifest.states.idle;

  const [frame, setFrame] = useState(start);
  const frameRef = useRef(start);

  useEffect(() => {
    frameRef.current = start;
    setFrame(start);
    if (end - start + 1 <= 1) {
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

  // Scale via background-size (not transform) so the layout box equals the
  // rendered size; sheet height is `auto` so the row offset stays correct.
  const style: CSSProperties = {
    width: frameWidth * scale,
    height: frameHeight * scale,
    backgroundImage: `url(${sheetUrl})`,
    backgroundSize: `${columns * frameWidth * scale}px auto`,
    backgroundPosition: `-${col * frameWidth * scale}px -${row * frameHeight * scale}px`
  };
  return <div className="relay-pet" style={style} />;
};

/** A single image, given life with a per-mood CSS animation. */
const ImageView = ({
  url,
  state,
  size
}: {
  url: string;
  state: PetState;
  size: number;
}): ReactElement => (
  <img
    className={`relay-pet-img pet-anim-${state}`}
    src={url}
    width={size}
    height={size}
    alt=""
    draggable={false}
  />
);

/** Renders a pet (sprite sheet or single image) plus an optional status bubble. */
export const Pet = ({ pet, state, size, title, bubble }: PetProps): ReactElement => {
  const label = bubble ? PET_STATUS_LABEL[state] : null;
  return (
    <div className="relay-pet-wrap" role="img" aria-label={title ?? `${pet.name}: ${state}`} title={title}>
      {label && <div className={`relay-pet-bubble bubble-${state}`}>{label}</div>}
      {pet.kind === "sheet" ? (
        <SheetView pet={pet} state={state} size={size} />
      ) : (
        <ImageView url={pet.imageUrl} state={state} size={size ?? 72} />
      )}
    </div>
  );
};
