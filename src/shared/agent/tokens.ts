import type { AgentMessage } from "./types";

/**
 * Approximate token counting. There's no universal tokenizer across Relay's
 * providers, so this is a calibrated character heuristic with a CJK adjustment
 * (Chinese/Japanese/Korean glyphs are far more token-dense than Latin text).
 * Used for the usage meter and the context budgeter — never for billing, so a
 * small over-estimate is fine (and safer: we compact a little early).
 */

/** Flat token cost we attribute to an image part (provider-dependent; a guess). */
const IMAGE_TOKENS = 1100;
/** Per-message structural overhead (role, delimiters). */
const MESSAGE_OVERHEAD = 4;

const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/g;

/** Estimate tokens for a plain string. */
export const estimateTokens = (text: string): number => {
  if (!text) {
    return 0;
  }
  const cjkCount = text.match(CJK)?.length ?? 0;
  const rest = text.length - cjkCount;
  // ~4 Latin chars/token; CJK is denser at ~1.6 chars/token.
  return Math.ceil(rest / 4 + cjkCount / 1.6);
};

/** Estimate tokens for one message: text + attachments + structural overhead. */
export const estimateMessageTokens = (message: AgentMessage): number => {
  let total = MESSAGE_OVERHEAD + estimateTokens(message.content);
  for (const att of message.attachments ?? []) {
    if (att.kind === "image") {
      total += IMAGE_TOKENS;
    } else if (att.text) {
      total += estimateTokens(att.text);
    }
  }
  return total;
};

/** Estimate tokens for a whole conversation, plus optional extra text (a summary). */
export const estimateConversationTokens = (
  messages: AgentMessage[],
  extraText?: string
): number => {
  let total = extraText ? estimateTokens(extraText) : 0;
  for (const message of messages) {
    total += estimateMessageTokens(message);
  }
  return total;
};
