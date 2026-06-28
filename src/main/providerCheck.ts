import {
  LOCAL_PROVIDER_VARIABLE,
  providerCatalog,
  providerSlug
} from "../shared/agent/providers";
import { getProviderEnvVars } from "./modelRegistry";

/**
 * Guard against catalog drift. Relay hand-maintains each provider's API-key env
 * var in `providerCatalog`, but the real routing key comes from Mastra's
 * registry (`apiKeyEnvVar`). If the two ever diverge, a user's stored key would
 * be injected under the wrong name and silently fail to authenticate. This
 * compares the two and returns human-readable mismatches; run at startup so any
 * divergence is loud and immediate rather than a mystery auth failure.
 */
export const verifyProviderMappings = (): string[] => {
  const registryEnv = getProviderEnvVars();
  const problems: string[] = [];

  for (const provider of providerCatalog) {
    if (provider.variable === LOCAL_PROVIDER_VARIABLE) {
      continue; // keyless local provider; nothing to verify
    }
    const slug = providerSlug(provider);
    const expected = registryEnv[slug];
    if (!expected) {
      // No registry entry to compare against (registry missing the slug, or it
      // couldn't be read). Not necessarily wrong, but worth surfacing.
      problems.push(`${provider.name} (${slug}): no apiKeyEnvVar in Mastra registry to verify against`);
      continue;
    }
    if (expected !== provider.variable) {
      problems.push(
        `${provider.name} (${slug}): catalog uses ${provider.variable} but Mastra expects ${expected}`
      );
    }
  }
  return problems;
};

/** Run the mapping check and log the result (called once at startup). */
export const logProviderMappingCheck = (): void => {
  const total = providerCatalog.filter((p) => p.variable !== LOCAL_PROVIDER_VARIABLE).length;
  const problems = verifyProviderMappings();
  if (problems.length === 0) {
    console.log(`[relay] provider mapping check: ${total}/${total} OK`);
    return;
  }
  console.error(
    `[relay] provider mapping check: ${total - problems.length}/${total} OK — ${problems.length} issue(s):`
  );
  for (const problem of problems) {
    console.error(`[relay]   ✗ ${problem}`);
  }
};
