/**
 * act/tool-result-content.ts — typed tool-result content at the act seam
 * (Plan 9 Phase 4 stage E).
 *
 * A tool may return `toolContent(parts)` (`@reactive-agents/tools`) to carry
 * image, audio or file parts. The act seam splits that value in two:
 *   - a TEXT VIEW (`contentText`: text parts only, joined with "") that every
 *     string reader acts on: normalization, compression, the scratchpad, the
 *     observation step's text and the ledger;
 *   - the PARTS, which ride the observation step (`metadata.contentParts`) to
 *     the tool-result message, so the provider request carries them.
 *
 * Any other return value takes the existing string path unchanged, and
 * text-only tool content collapses to one string (canonical form), so a
 * text-only run keeps its exact bytes and replay hashes.
 */
import { contentText, normalizeContent, type ContentPart, type MessageContent } from "@reactive-agents/core";
import { isToolContent } from "@reactive-agents/tools";

/** The act-seam view of a branded tool result. */
export interface ToolContentView {
  /** Text parts joined with "". Media bytes never appear here. */
  readonly text: string;
  /** All parts, in order. Present only when a non-text part exists. */
  readonly parts?: readonly ContentPart[];
}

/**
 * The text view and parts of a `toolContent(...)` result, or `undefined`
 * when the value is not branded tool content (the caller keeps its string path).
 */
export const toolContentView = (value: unknown): ToolContentView | undefined => {
  if (!isToolContent(value)) return undefined;
  const content = normalizeContent(value.parts);
  return typeof content === "string" ? { text: content } : { text: contentText(content), parts: content };
};

/** The non-text parts of some content (none for a string). */
export const mediaPartsOf = (content: MessageContent): readonly ContentPart[] =>
  typeof content === "string" ? [] : content.filter((p) => p.type !== "text");

/**
 * The tool-result message content for an observation.
 *
 * No parts: the text, unchanged. Text unchanged since the split (it equals
 * the parts' text view): the original parts, in order. Text rewritten by a
 * later stage (compression preview, fact extraction, recovery guidance): that
 * text first, then the media parts. The media always travels.
 */
export const toolResultMessageContent = (text: string, parts?: readonly ContentPart[]): MessageContent => {
  if (parts === undefined) return text;
  if (text === contentText(parts)) return normalizeContent(parts);
  const media = mediaPartsOf(parts);
  return normalizeContent(text.length > 0 ? [{ type: "text", text }, ...media] : media);
};
