import { useEffect, useState, type ReactElement } from "react";
import { Pet } from "./components/Pet";
import type { OverlayUpdate } from "../shared/pets/types";

/**
 * The renderer for the always-on-top floating-pet window. It owns no app state —
 * the main window pushes which pet to show and its current mood via the main
 * process (see `window.overlayClient.onUpdate`). Renders nothing until the first
 * snapshot arrives, so the transparent window stays empty if data is missing.
 */
export const OverlayApp = (): ReactElement | null => {
  const [update, setUpdate] = useState<OverlayUpdate | null>(null);

  useEffect(() => window.overlayClient.onUpdate(setUpdate), []);

  if (!update) {
    return null;
  }

  return (
    <Pet
      pet={{ id: "overlay", name: update.name, manifest: update.manifest, sheetUrl: update.sheetUrl }}
      state={update.state}
      size={84}
      title={`${update.name}: ${update.state}`}
    />
  );
};
