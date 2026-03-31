// File: src/strategies/kernel/thinking-utils.ts
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

// ── FINAL ANSWER regex (local copy to avoid circular dependency with tool-utils) ──
const FA_RE = /(?:\*{0,2})final\s*answer(?:\*{0,2})\s*[:：]\s*/i;

// ── ACTION regex ──
const ACTION_RE = /ACTION:\s*([\w\-/]+)\s*\(/i;

// ── Code block regex ──
const CODE_BLOCK_RE = /```[\s\S]*?```/g;

/**
 * Extract structured value from the thinking field when content is deficient.
 *
 * Thinking models (cogito, qwen3.5, DeepSeek-R1) sometimes put the real answer
 * in the thinking field and emit only a tiny fragment as content. This function
 * attempts to rescue usable output by checking for:
 *
 * 1. **FINAL ANSWER** — explicit answer marker in thinking
 * 2. **ACTION** — tool call the model intended to make
 * 3. **Code blocks** — code output that IS the answer
 * 4. **Last substantive paragraph** — the concluding analysis
 *
 * @param thinking - The model's thinking output
 * @param content - The deficient content (< 50 chars)
 * @returns Rescued content, or null if thinking doesn't contain usable output
 */
export function rescueFromThinking(thinking: string, content: string): string | null {
  if (!thinking || thinking.length === 0) return null;

  // 1. FINAL ANSWER in thinking — extract the answer portion
  const faMatch = thinking.match(new RegExp(FA_RE.source + "([\\s\\S]*)", "i"));
  if (faMatch?.[1]?.trim()) {
    return `FINAL ANSWER: ${faMatch[1].trim()}`;
  }

  // 2. ACTION in thinking — the model intended a tool call
  if (ACTION_RE.test(thinking)) {
    // Find the ACTION line and everything after it
    const actionIdx = thinking.search(ACTION_RE);
    if (actionIdx >= 0) {
      // Include some context before the action (last paragraph)
      const beforeAction = thinking.slice(0, actionIdx);
      const lastPara = beforeAction.split(/\n\n/).filter(p => p.trim()).pop() ?? "";
      return `${lastPara}\n\n${thinking.slice(actionIdx)}`.trim();
    }
  }

  // 3. Code blocks in thinking — the code IS the answer
  const codeBlocks = thinking.match(CODE_BLOCK_RE);
  if (codeBlocks && codeBlocks.length > 0) {
    // Include the paragraph before the first code block for context
    const firstBlockIdx = thinking.indexOf(codeBlocks[0]!);
    const beforeBlock = thinking.slice(0, firstBlockIdx);
    const lastPara = beforeBlock.split(/\n\n/).filter(p => p.trim()).pop() ?? "";
    // Include content after code blocks too (may have explanation)
    const afterLastBlock = thinking.slice(
      thinking.lastIndexOf(codeBlocks[codeBlocks.length - 1]!) + codeBlocks[codeBlocks.length - 1]!.length,
    ).trim();
    const parts = [lastPara, ...codeBlocks, afterLastBlock].filter(Boolean);
    return parts.join("\n\n");
  }

  // 4. Last substantive paragraph (> 80 chars) — likely the conclusion
  const paragraphs = thinking.split(/\n\n/).filter(p => p.trim().length > 80);
  if (paragraphs.length > 0) {
    // Use the last 1-2 substantive paragraphs
    return paragraphs.slice(-2).join("\n\n");
  }

  // Nothing usable found
  return null;
}
