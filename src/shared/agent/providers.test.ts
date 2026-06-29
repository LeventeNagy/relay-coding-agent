import { describe, it, expect } from "vitest";
import {
  requiresThinking,
  providerSlug,
  credentialList,
  reasoningCapsFor,
  buildModelOptions,
  providerCatalog
} from "./providers";

describe("requiresThinking", () => {
  it("is true for Kimi code/thinking models on either Moonshot platform", () => {
    expect(requiresThinking("moonshotai/kimi-k2.7-code")).toBe(true);
    expect(requiresThinking("moonshotai/kimi-k2-thinking")).toBe(true);
    expect(requiresThinking("moonshotai-cn/kimi-k2.7-code")).toBe(true);
  });

  it("is false for non-reasoning Kimi models and other providers", () => {
    expect(requiresThinking("moonshotai/kimi-k2.6")).toBe(false);
    expect(requiresThinking("zai/glm-4.6")).toBe(false);
    expect(requiresThinking(null)).toBe(false);
  });
});

describe("providerSlug", () => {
  it("returns the segment before the first slash", () => {
    expect(
      providerSlug({ name: "x", variable: "X", model: "openrouter/openai/gpt", note: "", plans: [] })
    ).toBe("openrouter");
  });
});

describe("credentialList", () => {
  it("deduplicates providers by API key env var", () => {
    const creds = credentialList();
    const vars = creds.map((c) => c.variable);
    expect(new Set(vars).size).toBe(vars.length); // no duplicate vars
  });

  it("collapses the two Moonshot routes under one key with both models", () => {
    const moonshot = credentialList().find((c) => c.variable === "MOONSHOT_API_KEY");
    expect(moonshot).toBeDefined();
    expect(moonshot?.models.length).toBe(2); // global + China
  });
});

describe("reasoningCapsFor", () => {
  it("exposes high/max effort for GLM-5 models", () => {
    const caps = reasoningCapsFor("zai/glm-5.5");
    expect(caps?.ns).toBe("zai");
    expect(caps?.effortValues).toEqual(["high", "max"]);
    expect(caps?.defaultEffort).toBe("max");
  });

  it("returns a toggle-only cap for older GLM and null for non-reasoning providers", () => {
    expect(reasoningCapsFor("zai/glm-4.6")?.effortValues).toEqual([]);
    expect(reasoningCapsFor("deepseek/deepseek-chat")).toBeNull();
  });
});

describe("buildModelOptions", () => {
  it("expands a configured provider's registry models, keeping the provider name", () => {
    const opts = buildModelOptions(["DEEPSEEK_API_KEY"], {
      deepseek: ["deepseek-chat", "deepseek-reasoner"]
    });
    expect(opts.map((o) => o.model)).toEqual([
      "deepseek/deepseek-chat",
      "deepseek/deepseek-reasoner"
    ]);
    expect(opts[0].providerName).toBe("DeepSeek");
  });

  it("omits providers whose key is not configured", () => {
    const opts = buildModelOptions([], { deepseek: ["deepseek-chat"] });
    expect(opts).toEqual([]);
  });
});

describe("providerCatalog", () => {
  it("has a unique default model per entry", () => {
    const models = providerCatalog.map((p) => p.model);
    expect(new Set(models).size).toBe(models.length);
  });
});
