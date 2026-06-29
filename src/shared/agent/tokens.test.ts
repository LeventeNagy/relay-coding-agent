import { describe, it, expect } from "vitest";
import { estimateTokens, estimateMessageTokens, estimateConversationTokens } from "./tokens";
import type { AgentMessage, Attachment } from "./types";

const msg = (content: string, attachments?: Attachment[]): AgentMessage => ({
  id: "m1",
  role: "user",
  content,
  attachments,
  createdAt: "2026-01-01T00:00:00.000Z"
});

describe("estimateTokens", () => {
  it("is zero for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("counts ~4 Latin characters per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("treats CJK text as denser than Latin text of the same length", () => {
    const cjk = estimateTokens("你好世界"); // 4 ideographs
    const latin = estimateTokens("abcd"); // 4 latin chars
    expect(cjk).toBeGreaterThan(latin);
    // 4 / 1.6 = 2.5 -> ceil = 3
    expect(cjk).toBe(3);
  });
});

describe("estimateMessageTokens", () => {
  it("adds per-message structural overhead", () => {
    expect(estimateMessageTokens(msg(""))).toBe(4);
  });

  it("adds a flat cost for image attachments", () => {
    const withImage = msg("", [{ id: "a", name: "p.png", mimeType: "image/png", kind: "image" }]);
    expect(estimateMessageTokens(withImage)).toBe(4 + 1100);
  });

  it("counts extracted document text", () => {
    const doc = msg("", [
      { id: "d", name: "f.txt", mimeType: "text/plain", kind: "document", text: "abcdefgh" }
    ]);
    expect(estimateMessageTokens(doc)).toBe(4 + 2);
  });
});

describe("estimateConversationTokens", () => {
  it("sums messages and any extra summary text", () => {
    const messages = [msg("abcd"), msg("abcd")];
    // each message: 4 overhead + 1 content = 5; plus extra "abcdefgh" = 2
    expect(estimateConversationTokens(messages, "abcdefgh")).toBe(5 + 5 + 2);
  });

  it("works with no extra text", () => {
    expect(estimateConversationTokens([msg("")])).toBe(4);
  });
});
