/**
 * Canonical projection of an LLM request into the flattened, truncated text
 * form recorded in `llm-exchange` trace events — shared by BOTH sides of the
 * exact-replay seam:
 *
 *   - Record side: `reasoning/src/kernel/observable-llm.ts` flattens
 *     `LLMMessage.content` (string | ContentBlock[]) with
 *     {@link messageContentToString}, and
 *     `reasoning/src/kernel/utils/diagnostics.ts` (`emitLLMExchange`) caps
 *     systemPrompt / message text with {@link truncateExchangeText} at
 *     {@link EXCHANGE_SYSTEM_PROMPT_MAX} / {@link EXCHANGE_MESSAGE_MAX}.
 *   - Replay side: `@reactive-agents/replay`'s request-key hashing applies the
 *     IDENTICAL projection to live `CompletionRequest`s so a byte-identical
 *     prompt hashes to the same key its recording did.
 *
 * If record and replay ever apply different flattening or different caps, every
 * replayed request key silently misses (tool-using assistant turns are always
 * ContentBlock[], and tool-schema-heavy system prompts routinely exceed 4000
 * chars) — so this module is the single source of truth. Change it on both
 * sides at once or not at all.
 */
import type { LLMMessage } from "./types.js";
import { mediaPlaceholder } from "./content-parts.js";

/** Record-side soft cap applied to `systemPrompt` before it enters a trace event. */
export const EXCHANGE_SYSTEM_PROMPT_MAX = 4_000;

/** Record-side soft cap applied to each flattened message's content. */
export const EXCHANGE_MESSAGE_MAX = 2_000;

/**
 * Flatten `LLMMessage.content` to plain text: string content passes through;
 * ContentBlock[] content extracts text blocks verbatim and replaces tool
 * blocks with stable placeholders (`[tool_use:<name>]`, `[tool_result]`).
 * Image blocks become `[image:<media_type>:<sha256-12>]` (hash of the source
 * data), so two requests differing only in an image get different replay keys.
 * Text-only content flattens exactly as before.
 */
export function messageContentToString(content: LLMMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object") {
          const blk = b as {
            type?: string;
            text?: string;
            name?: string;
            source?: { media_type?: unknown; data?: unknown };
          };
          if (blk.type === "text" && typeof blk.text === "string") return blk.text;
          if (blk.type === "tool_use") return `[tool_use:${blk.name ?? "?"}]`;
          if (blk.type === "tool_result") return `[tool_result]`;
          if (
            blk.type === "image" &&
            typeof blk.source?.media_type === "string" &&
            typeof blk.source.data === "string"
          ) {
            return mediaPlaceholder("image", {
              media_type: blk.source.media_type,
              data: blk.source.data,
            });
          }
        }
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * Soft-cap truncation used when recording exchange payloads. `undefined`
 * passes through unchanged; text at or under `max` is returned as-is;
 * longer text is sliced to exactly `max` chars and flagged `truncated`.
 */
export function truncateExchangeText(
  text: string | undefined,
  max: number,
): { text: string | undefined; truncated: boolean } {
  if (text === undefined) return { text: undefined, truncated: false };
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}
