import { useEffect, useState } from "react";
import type { ProviderModels } from "../../shared/agent/types";

/** Loads the per-provider model catalog from Mastra's registry once. */
export const useProviderModels = (): ProviderModels => {
  const [models, setModels] = useState<ProviderModels>({});

  useEffect(() => {
    let active = true;
    window.providers
      .getModels()
      .then((next) => {
        if (active) {
          setModels(next);
        }
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("providers.getModels failed:", error);
      });
    return () => {
      active = false;
    };
  }, []);

  return models;
};
