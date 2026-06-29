import { describe, it, expect } from "vitest";
import { contextWindowFor, DEFAULT_CONTEXT_WINDOW } from "./contextWindows";

const K = 1024;

describe("contextWindowFor", () => {
  it("strips the provider slug and matches the model id", () => {
    expect(contextWindowFor("deepseek/deepseek-chat")).toBe(128 * K);
    expect(contextWindowFor("zai/glm-4.6")).toBe(200 * K);
    expect(contextWindowFor("moonshotai/kimi-k2.7-code")).toBe(200 * K);
    expect(contextWindowFor("google/gemini-2.5-pro")).toBe(1000 * K);
  });

  it("matches the inner vendor/model for gateway routes", () => {
    expect(contextWindowFor("openrouter/openai/gpt-4o")).toBe(128 * K);
  });

  it("falls back to a smaller GLM window for non-flagship GLM ids", () => {
    expect(contextWindowFor("zai-coding-plan/glm-4.5-air")).toBe(128 * K);
  });

  it("returns the conservative default for null or unknown models", () => {
    expect(contextWindowFor(null)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(contextWindowFor("acme/totally-unknown-model")).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(DEFAULT_CONTEXT_WINDOW).toBe(32 * K);
  });
});
