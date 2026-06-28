/**
 * Best-effort per-model context-window sizes (in tokens). Mastra's provider
 * registry carries no window data, so this is a curated, conservative lookup
 * keyed by model-id patterns. Shared by the renderer (usage meter) and the main
 * process (token budgeter / compaction).
 *
 * Conservative on purpose: an unknown model falls back to a small window, so we
 * compact early rather than overflow a provider. Tune as models change.
 */

const K = 1024;

interface WindowRule {
  test: RegExp;
  window: number;
}

/** First matching rule wins; matched against the lowercased model id (no slug). */
const RULES: WindowRule[] = [
  // OpenAI
  { test: /gpt-4o|gpt-4\.1|chatgpt-4o/, window: 128 * K },
  { test: /gpt-5|o3|o4/, window: 256 * K },
  // Anthropic Claude
  { test: /claude/, window: 200 * K },
  // Google Gemini
  { test: /gemini/, window: 1000 * K },
  // DeepSeek
  { test: /deepseek/, window: 128 * K },
  // Z.AI / GLM
  { test: /glm-?4\.6|glm-?5|glm-?4\.5v|glm-?z1/, window: 200 * K },
  { test: /glm/, window: 128 * K },
  // Alibaba Qwen — some variants advertise 1M; otherwise 128k
  { test: /qwen.*1m|qwen.*-max-1m/, window: 1000 * K },
  { test: /qwen/, window: 128 * K },
  // Moonshot / Kimi
  { test: /kimi|moonshot/, window: 200 * K },
  // MiniMax
  { test: /minimax/, window: 200 * K },
  // Tencent Hunyuan / TC code
  { test: /hunyuan|tc-code/, window: 128 * K },
  // Xiaomi MiMo
  { test: /mimo/, window: 128 * K },
  // Meta Llama
  { test: /llama-?4/, window: 256 * K },
  { test: /llama-?3\.[12]|llama-?3-/, window: 128 * K },
  // Mistral
  { test: /mistral|mixtral|magistral|codestral/, window: 128 * K }
];

/** Conservative default for models we don't recognize. */
export const DEFAULT_CONTEXT_WINDOW = 32 * K;

/**
 * The context window (in tokens) for a Mastra router model id, e.g.
 * "deepseek/deepseek-chat" or "openrouter/openai/gpt-4o". Strips the leading
 * provider slug; for gateway ids (openrouter/<vendor>/<model>) the inner vendor
 * + model still flows through the pattern match.
 */
export const contextWindowFor = (model: string | null): number => {
  if (!model) {
    return DEFAULT_CONTEXT_WINDOW;
  }
  // Drop the first segment (provider slug); keep the rest so gateway routes like
  // "openrouter/openai/gpt-4o" still match on "openai/gpt-4o".
  const withoutSlug = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  const id = withoutSlug.toLowerCase();
  for (const rule of RULES) {
    if (rule.test.test(id)) {
      return rule.window;
    }
  }
  return DEFAULT_CONTEXT_WINDOW;
};
