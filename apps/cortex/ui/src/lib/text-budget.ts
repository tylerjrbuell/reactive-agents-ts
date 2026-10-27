/**
 * Render budgets for large text. A single multi-hundred-KB string dropped into the
 * DOM (or run through the markdown + KaTeX pipeline) can freeze or crash the tab,
 * so big payloads are shown a bounded slice at a time.
 */

/** Chars shown before a "show more" is offered. */
export const PREVIEW_CHARS = 4_000;
/** Chars each "show more" click reveals. */
export const REVEAL_STEP = 24_000;
/** Above this, markdown is not rendered unless the user opts in. */
export const MARKDOWN_AUTO_RENDER_LIMIT = 30_000;

/** Human size for a char count (treated as ~bytes). */
export function formatSize(chars: number): string {
  if (chars < 1_000) return `${chars} chars`;
  if (chars < 1_000_000) return `${(chars / 1_000).toFixed(chars < 10_000 ? 1 : 0)} KB`;
  return `${(chars / 1_000_000).toFixed(1)} MB`;
}

/** Slice of `text` to show given how many chars are currently revealed (never splits a surrogate pair). */
export function visibleSlice(text: string, revealed: number): { shown: string; hidden: number } {
  if (text.length <= revealed) return { shown: text, hidden: 0 };
  let end = revealed;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return { shown: text.slice(0, end), hidden: text.length - end };
}

/** Next reveal size after one "show more" click. */
export const nextReveal = (revealed: number): number => revealed + REVEAL_STEP;
