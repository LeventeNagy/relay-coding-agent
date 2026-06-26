import type { ProviderInfo, ProviderModels } from "./types";

/**
 * Catalog of Mastra model-router providers Relay can route through.
 * `variable` is the env var the router reads the API key from; "Local server"
 * marks a keyless local provider (Ollama).
 */
export const providerCatalog: ProviderInfo[] = [
  {
    name: "DeepSeek",
    variable: "DEEPSEEK_API_KEY",
    model: "deepseek/deepseek-chat",
    note: "Direct DeepSeek models through Mastra.",
    plans: ["direct"]
  },
  {
    name: "Alibaba / Qwen",
    variable: "DASHSCOPE_API_KEY",
    model: "alibaba-cn/qwen3-coder-plus",
    note: "DashScope route for Qwen, DeepSeek, Kimi, GLM, and coding models.",
    plans: ["china", "direct"]
  },
  {
    name: "Alibaba Coding Plan",
    variable: "ALIBABA_CODING_PLAN_API_KEY",
    model: "alibaba-coding-plan-cn/qwen3-coder-plus",
    note: "Coding-plan route for Qwen Coder, GLM, Kimi, and MiniMax models.",
    plans: ["coding plan", "china"]
  },
  {
    name: "Alibaba Token Plan",
    variable: "ALIBABA_TOKEN_PLAN_API_KEY",
    model: "alibaba-token-plan-cn/kimi-k2.7-code",
    note: "Token-plan route for DeepSeek, Kimi code, Qwen, GLM, image, and Wan models.",
    plans: ["token plan", "china"]
  },
  {
    name: "Moonshot / Kimi",
    variable: "MOONSHOT_API_KEY",
    model: "moonshotai-cn/kimi-k2-thinking",
    note: "Kimi models, including China endpoint variants.",
    plans: ["china", "direct"]
  },
  {
    name: "MiniMax",
    variable: "MINIMAX_API_KEY",
    model: "minimax/MiniMax-M2",
    note: "MiniMax M-series chat and coding-capable models.",
    plans: ["direct"]
  },
  {
    name: "MiniMax Token Plan",
    variable: "MINIMAX_API_KEY",
    model: "minimax-cn-coding-plan/MiniMax-M2.5",
    note: "MiniMax token/coding-plan route for high-context M-series models.",
    plans: ["token plan", "coding plan", "china"]
  },
  {
    name: "SiliconFlow China",
    variable: "SILICONFLOW_CN_API_KEY",
    model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
    note: "Aggregator route for DeepSeek, Qwen, Kimi, GLM, Tencent, and more.",
    plans: ["china", "aggregator"]
  },
  {
    name: "Tencent Coding Plan",
    variable: "TENCENT_CODING_PLAN_API_KEY",
    model: "tencent-coding-plan/tc-code-latest",
    note: "Tencent coding-plan route for Hunyuan, GLM, Kimi, MiniMax, and TC code models.",
    plans: ["coding plan", "china"]
  },
  {
    name: "Xiaomi Token Plan",
    variable: "XIAOMI_API_KEY",
    model: "xiaomi-token-plan-cn/mimo-v2.5-pro",
    note: "Xiaomi token-plan route with China, Europe, and Singapore Mastra provider variants.",
    plans: ["token plan", "china", "europe", "singapore"]
  },
  {
    name: "Z.AI / Zhipu",
    variable: "ZHIPU_API_KEY",
    model: "zai/glm-4.6",
    note: "GLM / Zhipu family via Mastra provider routing.",
    plans: ["direct"]
  },
  {
    name: "Z.AI Coding Plan",
    variable: "ZHIPU_API_KEY",
    model: "zai-coding-plan/glm-4.5-air",
    note: "Coding-plan route for GLM coding and reasoning models.",
    plans: ["coding plan"]
  },
  {
    name: "OpenRouter",
    variable: "OPENROUTER_API_KEY",
    model: "openrouter/deepseek/deepseek-chat-v3.1",
    note: "Gateway route for hundreds of hosted open, Chinese, and frontier models.",
    plans: ["gateway"]
  },
  {
    name: "Ollama Cloud",
    variable: "OLLAMA_API_KEY",
    model: "ollama-cloud/deepseek-v3.2",
    note: "Ollama-hosted open models (DeepSeek, GLM, Qwen, gpt-oss, Kimi) over the cloud endpoint.",
    plans: ["cloud", "open source"]
  }
];

/** Env-var sentinel for keyless local providers (Ollama). */
export const LOCAL_PROVIDER_VARIABLE = "Local server";

/** A provider is usable when it needs no key, or its key env var is configured. */
export const isProviderReady = (provider: ProviderInfo, configuredKeys: string[]): boolean => {
  return provider.variable === LOCAL_PROVIDER_VARIABLE || configuredKeys.includes(provider.variable);
};

/** Providers the user can actually run given which keys are configured. */
export const availableModels = (configuredKeys: string[]): ProviderInfo[] => {
  return providerCatalog.filter((provider) => isProviderReady(provider, configuredKeys));
};

/** The router slug for a catalog entry (the part before the first "/"). */
export const providerSlug = (provider: ProviderInfo): string => provider.model.split("/")[0];

/** Reasoning ("deep thinking") capabilities for a model that supports them. */
export interface ReasoningCaps {
  /** providerOptions namespace = the model's provider slug. */
  ns: string;
  /** Allowed reasoning_effort values; empty = toggle only (no effort selector). */
  effortValues: string[];
  defaultEffort?: string;
}

/**
 * Returns reasoning controls for a model, or null if it has none. Z.AI / GLM
 * first; structured so other reasoning providers can be added later.
 */
export const reasoningCapsFor = (model: string | null): ReasoningCaps | null => {
  if (!model) {
    return null;
  }
  const slug = model.split("/")[0];
  if (slug === "zai" || slug === "zai-coding-plan") {
    const id = model.split("/").slice(1).join("/");
    // GLM-5.x exposes reasoning_effort high|max (max is the default); older GLM
    // models get the on/off toggle only.
    const effortValues = /glm-5/i.test(id) ? ["high", "max"] : [];
    return { ns: slug, effortValues, defaultEffort: effortValues.length ? "max" : undefined };
  }
  return null;
};

/** One selectable model in the chat picker. */
export interface ModelOption {
  /** Full Mastra router id, e.g. "openrouter/deepseek/deepseek-chat-v3.1". */
  model: string;
  /** Human label (the model id without the provider slug). */
  label: string;
  providerName: string;
  slug: string;
}

/**
 * Expands every configured provider into its full model list from the registry.
 * Falls back to the catalog's default model when the registry has no entry
 * (e.g. before the registry has loaded), so first-run selection still works.
 */
export const buildModelOptions = (
  configuredKeys: string[],
  registryModels: ProviderModels
): ModelOption[] => {
  const options: ModelOption[] = [];
  const seen = new Set<string>();
  for (const provider of availableModels(configuredKeys)) {
    const slug = providerSlug(provider);
    const ids = registryModels[slug]?.length ? registryModels[slug] : [provider.model.slice(slug.length + 1)];
    for (const id of ids) {
      const model = `${slug}/${id}`;
      if (seen.has(model)) {
        continue;
      }
      seen.add(model);
      options.push({ model, label: id, providerName: provider.name, slug });
    }
  }
  return options;
};

/** A configured provider plus its expanded model list, for the picker's level 1. */
export interface ProviderGroup {
  slug: string;
  name: string;
  variable: string;
  plans: string[];
  models: ModelOption[];
}

/**
 * Groups every configured provider with its full model list (registry, or the
 * catalog default as a fallback). Powers the two-level model picker: pick a
 * provider, then search that provider's models — instead of one flat mega-list.
 */
export const buildProviderGroups = (
  configuredKeys: string[],
  registryModels: ProviderModels
): ProviderGroup[] => {
  const groups: ProviderGroup[] = [];
  for (const provider of availableModels(configuredKeys)) {
    const slug = providerSlug(provider);
    const ids = registryModels[slug]?.length ? registryModels[slug] : [provider.model.slice(slug.length + 1)];
    const seen = new Set<string>();
    const models: ModelOption[] = [];
    for (const id of ids) {
      const model = `${slug}/${id}`;
      if (seen.has(model)) {
        continue;
      }
      seen.add(model);
      models.push({ model, label: id, providerName: provider.name, slug });
    }
    groups.push({ slug, name: provider.name, variable: provider.variable, plans: provider.plans, models });
  }
  return groups;
};

/**
 * One API key can unlock several model routes (e.g. MINIMAX_API_KEY serves both
 * `minimax/*` and `minimax-cn-coding-plan/*`). A credential collapses those into
 * a single settings entry so the user enters each key only once.
 */
export interface ProviderCredential {
  variable: string;
  name: string;
  note: string;
  plans: string[];
  /** Model-router ids unlocked by this key. */
  models: string[];
}

/** Settings-facing list: one entry per unique API key, deduplicated. */
export const credentialList = (): ProviderCredential[] => {
  const byVar = new Map<string, ProviderCredential>();
  for (const provider of providerCatalog) {
    if (provider.variable === LOCAL_PROVIDER_VARIABLE) {
      continue;
    }
    const existing = byVar.get(provider.variable);
    if (existing) {
      existing.models.push(provider.model);
      for (const plan of provider.plans) {
        if (!existing.plans.includes(plan)) {
          existing.plans.push(plan);
        }
      }
    } else {
      byVar.set(provider.variable, {
        variable: provider.variable,
        name: provider.name,
        note: provider.note,
        plans: [...provider.plans],
        models: [provider.model]
      });
    }
  }
  return [...byVar.values()];
};
