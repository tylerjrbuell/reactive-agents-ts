// File: src/strategies/shared/thinking-utils.ts
/**
 * Thinking model support — extract and strip <think>...</think> blocks.
 *
 * Models like qwen3.5, DeepSeek-R1, and QwQ embed internal reasoning in
 * <think>...</think> blocks. These MUST be stripped before parsing to prevent:
 * - Parser poisoning: hypothetical ACTION/FINAL ANSWER inside <think> treated as real
 * - Context bloat: thinking re-sent as context, inflating tokens
 * - Task confusion: model's internal brainstorm treated as the response
 */

/** Regex matching <think>...</think> blocks (case insensitive, non-greedy) */
const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi;

/** Regex matching unclosed <think> tags — strip from <think> to end of string */
const UNCLOSED_THINK_RE = /<think>[\s\S]*$/i;

/**
 * Extract thinking blocks and clean content from LLM response text.
 *
 * @returns `thinking` — concatenated content of all <think> blocks (null if none)
 * @returns `content` — the text with all <think> blocks removed
 */
export function extractThinking(text: string): {
  thinking: string | null;
  content: string;
} {
  // Fast path: no think tags at all
  if (!text) return { thinking: null, content: text };
  if (!/<think/i.test(text)) return { thinking: null, content: text };

  // Collect all thinking blocks
  const thinkingParts: string[] = [];
  let content = text.replace(THINK_BLOCK_RE, (match) => {
    // Extract inner content (strip the tags themselves)
    const inner = match.replace(/<\/?think>/gi, "").trim();
    if (inner.length > 0) {
      thinkingParts.push(inner);
    }
    return "";
  });

  // Handle unclosed <think> tag — strip from <think> to end
  if (UNCLOSED_THINK_RE.test(content)) {
    const unclosedMatch = content.match(UNCLOSED_THINK_RE);
    if (unclosedMatch) {
      const inner = unclosedMatch[0].replace(/<think>/i, "").trim();
      if (inner.length > 0) {
        thinkingParts.push(inner);
      }
      content = content.replace(UNCLOSED_THINK_RE, "");
    }
  }

  // Clean up: collapse multiple blank lines, trim
  content = content.replace(/\n{3,}/g, "\n\n").trim();

  return {
    thinking: thinkingParts.length > 0 ? thinkingParts.join("\n\n") : null,
    content,
  };
}

/**
 * Strip all <think>...</think> blocks from text.
 * Shorthand for `extractThinking(text).content`.
 */
export function stripThinking(text: string): string {
  return extractThinking(text).content;
}
