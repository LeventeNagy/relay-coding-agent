import { useCallback, useEffect, useState } from "react";
import type {
  PluginCatalogEntry,
  PluginInput,
  PluginProbeResult,
  PluginSummary
} from "../../shared/plugins/types";

export interface PluginsController {
  catalog: PluginCatalogEntry[];
  installed: PluginSummary[];
  ready: boolean;
  add: (input: PluginInput) => Promise<void>;
  probe: (input: PluginInput) => Promise<PluginProbeResult>;
  /** Run (or re-run) the OAuth browser flow; returns the attempt result. */
  connect: (id: string) => Promise<PluginProbeResult>;
  toggle: (id: string, enabled: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  openExternal: (url: string) => void;
  refresh: () => Promise<void>;
}

/** Loads the plugin catalog + installed servers and exposes mutators. */
export const usePlugins = (): PluginsController => {
  const [catalog, setCatalog] = useState<PluginCatalogEntry[]>([]);
  const [installed, setInstalled] = useState<PluginSummary[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setInstalled(await window.plugins.list());
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("plugins.list failed:", error);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([window.plugins.catalog(), window.plugins.list()])
      .then(([cat, list]) => {
        if (active) {
          setCatalog(cat);
          setInstalled(list);
          setReady(true);
        }
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("plugins load failed:", error);
        if (active) {
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Refresh when main pushes a change (e.g. startup status hydration).
  useEffect(() => window.plugins.onChanged(() => void refresh()), [refresh]);

  const add = useCallback(async (input: PluginInput) => {
    try {
      setInstalled(await window.plugins.add(input));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("plugins.add failed:", error);
    }
  }, []);

  const probe = useCallback(
    (input: PluginInput): Promise<PluginProbeResult> =>
      window.plugins.probe(input).catch((error) => ({
        ok: false,
        tools: [],
        error: error instanceof Error ? error.message : String(error)
      })),
    []
  );

  const connect = useCallback(async (id: string): Promise<PluginProbeResult> => {
    try {
      const { result, plugins } = await window.plugins.connect(id);
      setInstalled(plugins);
      return result;
    } catch (error) {
      return { ok: false, tools: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, []);

  const openExternal = useCallback((url: string): void => {
    void window.plugins.openExternal(url);
  }, []);

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    try {
      setInstalled(await window.plugins.toggle(id, enabled));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("plugins.toggle failed:", error);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      setInstalled(await window.plugins.remove(id));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("plugins.remove failed:", error);
    }
  }, []);

  return { catalog, installed, ready, add, probe, connect, openExternal, toggle, remove, refresh };
};
