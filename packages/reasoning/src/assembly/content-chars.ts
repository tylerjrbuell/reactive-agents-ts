// File: src/assembly/content-chars.ts
//
// The window size of message content, in chars (Plan 9 Phase 4 stage D2).
//
// Assembly budgets are char budgets (compaction fires at `window × 4` chars, the
// finalize projection trace reports `chars`). Before D2 they read
// `contentText(...).length`, so an image, audio or file part counted as 0 chars
// and a media-heavy thread could never trigger compaction. Every non-text part
// now counts a fixed, deterministic cost instead. Text-only content (canonically
// one string) measures exactly as before, so text runs are unchanged.

import type { MessageContent } from "@reactive-agents/core";

/**
 * Fixed window cost of one non-text part (image, audio or file), in chars.
 *
 * 4,000 chars is about 1,000 tokens at the 4 chars/token ratio the assembly
 * budgets use (`window × 4`). It is near what Anthropic and OpenAI charge for
 * one ~1 megapixel image. It is a deterministic estimate, not a measurement:
 * the true cost depends on provider, resolution and part kind. It does not
 * depend on the part's byte size, so base64 data never inflates the budget.
 */
export const MEDIA_PART_CHARS = 4_000;

/** Chars of some content: text length, plus {@link MEDIA_PART_CHARS} per non-text part. */
export const contentChars = (content: MessageContent): number =>
  typeof content === "string"
    ? content.length
    : content.reduce((n, p) => n + (p.type === "text" ? p.text.length : MEDIA_PART_CHARS), 0);
