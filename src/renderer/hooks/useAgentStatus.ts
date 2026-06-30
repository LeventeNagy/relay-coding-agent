import { useEffect, useRef, useState } from "react";
import type { PetState } from "../../shared/pets/types";

/**
 * Maps the agent's live activity to a pet mood: `working` while any run is
 * streaming, a brief celebratory `done` when the last run finishes, then back to
 * `idle`. (`needsInput`/`error` are wired in a later phase once the controller
 * surfaces a pending-permission/error signal.)
 */
export const useAgentStatus = (busy: boolean, doneMs = 2600): PetState => {
  const [state, setState] = useState<PetState>("idle");
  const wasBusy = useRef(false);

  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      setState("working");
      return;
    }
    if (wasBusy.current) {
      wasBusy.current = false;
      setState("done");
      const timer = window.setTimeout(() => setState("idle"), doneMs);
      return () => window.clearTimeout(timer);
    }
    setState("idle");
  }, [busy, doneMs]);

  return state;
};
