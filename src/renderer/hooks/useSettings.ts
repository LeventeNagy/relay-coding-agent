import { useCallback, useEffect, useState } from "react";
import type { SettingsState } from "../../shared/agent/types";

const initialState: SettingsState = {
  configuredKeys: [],
  activeModel: null,
  secureStorageAvailable: false
};

export interface SettingsController {
  state: SettingsState;
  ready: boolean;
  setKey: (envVar: string, key: string) => Promise<void>;
  deleteKey: (envVar: string) => Promise<void>;
  setModel: (model: string | null) => Promise<void>;
}

/** Loads persisted settings once and exposes mutators that keep state in sync. */
export const useSettings = (): SettingsController => {
  const [state, setState] = useState<SettingsState>(initialState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    window.settings
      .get()
      .then((next) => {
        if (active) {
          setState(next);
          setReady(true);
        }
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("settings.get failed:", error);
        if (active) {
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const setKey = useCallback(async (envVar: string, key: string) => {
    try {
      setState(await window.settings.setKey(envVar, key));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("settings.setKey failed:", error);
    }
  }, []);

  const deleteKey = useCallback(async (envVar: string) => {
    try {
      setState(await window.settings.deleteKey(envVar));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("settings.deleteKey failed:", error);
    }
  }, []);

  const setModel = useCallback(async (model: string | null) => {
    try {
      setState(await window.settings.setModel(model));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("settings.setModel failed:", error);
    }
  }, []);

  return { state, ready, setKey, deleteKey, setModel };
};
