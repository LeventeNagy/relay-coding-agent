import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { providerCatalog, providerSlug } from "../shared/agent/providers";
import type { ProviderModels } from "../shared/agent/types";

/**
 * Reads Mastra's bundled `provider-registry.json` (no network) and returns the
 * full model list for each provider slug Relay's catalog uses. Cached after the
 * first read. Returns {} if the registry can't be located, in which case the
 * renderer falls back to each provider's default model.
 */

let cache: ProviderModels | null = null;

const locateRegistry = (): string => {
  const require = createRequire(import.meta.url);
  // The "." export resolves into @mastra/core/dist; the registry sits beside it.
  const entry = require.resolve("@mastra/core");
  return join(dirname(entry), "provider-registry.json");
};

export const getProviderModels = (): ProviderModels => {
  if (cache) {
    return cache;
  }
  const result: ProviderModels = {};
  try {
    const registry = JSON.parse(readFileSync(locateRegistry(), "utf8")) as {
      providers?: Record<string, { models?: string[] | Record<string, unknown> }>;
    };
    const providers = registry.providers ?? {};
    const slugs = new Set(providerCatalog.map(providerSlug));
    for (const slug of slugs) {
      const provider = providers[slug];
      if (!provider) {
        continue;
      }
      const models = Array.isArray(provider.models) ? provider.models : Object.keys(provider.models ?? {});
      result[slug] = models;
    }
  } catch (error) {
     
    console.error("Failed to read Mastra provider registry:", error);
  }
  cache = result;
  return cache;
};

/**
 * Maps each catalog provider slug to the env var Mastra's registry reads its API
 * key from (`apiKeyEnvVar`). The source of truth for verifying Relay's catalog
 * mapping (see providerCheck). Slugs missing from the registry are omitted.
 */
export const getProviderEnvVars = (): Record<string, string> => {
  const result: Record<string, string> = {};
  try {
    const registry = JSON.parse(readFileSync(locateRegistry(), "utf8")) as {
      providers?: Record<string, { apiKeyEnvVar?: string }>;
    };
    const providers = registry.providers ?? {};
    for (const slug of new Set(providerCatalog.map(providerSlug))) {
      const envVar = providers[slug]?.apiKeyEnvVar;
      if (envVar) {
        result[slug] = envVar;
      }
    }
  } catch (error) {
     
    console.error("Failed to read provider env vars from registry:", error);
  }
  return result;
};
