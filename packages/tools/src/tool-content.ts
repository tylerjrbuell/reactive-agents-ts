import { Schema } from "effect";
import { ContentPartSchema, type ContentPart } from "@reactive-agents/core";

// Typed tool-result content (Plan 9 Phase 4 stage E). A tool returns
// `toolContent(parts)` to carry image, audio or file parts instead of a
// string. The kernel act seam recognises the value with `isToolContent`.
// Any other return value is unchanged.

/** A tool result that carries typed core content parts. */
export const ToolContentSchema = Schema.TaggedStruct("ToolContent", {
  parts: Schema.Array(ContentPartSchema),
});

/** A tool result that carries typed core content parts. Build it with `toolContent`. */
export type ToolContent = typeof ToolContentSchema.Type;

const partFallbackText = (part: ContentPart): string => {
  switch (part.type) {
    case "text":
      return part.text;
    case "image":
      return `[image: ${part.source.media_type}]`;
    case "audio":
      return part.transcript !== undefined
        ? `[audio: ${part.source.media_type}] ${part.transcript}`
        : `[audio: ${part.source.media_type}]`;
    case "file":
      return `[file: ${part.ref.name ?? part.ref.uri} (${part.ref.media_type}) ${part.ref.uri}]`;
  }
};

/**
 * The text view of tool content: text parts verbatim, one short marker per
 * non-text part, joined with newlines. Media bytes never appear in it.
 */
export const toolContentText = (content: ToolContent): string =>
  content.parts.map(partFallbackText).join("\n");

// `toJSON` lives on the prototype: Bun's JSON.stringify ignores a
// non-enumerable own `toJSON`, and an enumerable one would leak into equality.
class ToolContentValue implements ToolContent {
  readonly _tag = "ToolContent" as const;
  constructor(readonly parts: readonly ContentPart[]) {}
  toJSON(): string {
    return toolContentText(this);
  }
}

/**
 * Wrap typed content parts as a tool result.
 *
 * A consumer that does not know about typed parts and serializes the value
 * with `JSON.stringify` gets `toolContentText` (text plus markers), never the
 * base64 bytes.
 *
 * @example
 * ```ts
 * return toolContent([
 *   { type: "text", text: "Chart rendered" },
 *   { type: "image", source: { type: "base64", media_type: "image/png", data } },
 * ]);
 * ```
 */
export const toolContent = (parts: readonly ContentPart[]): ToolContent => new ToolContentValue([...parts]);

/** True when a tool result is typed content built with `toolContent`. */
export const isToolContent: (value: unknown) => value is ToolContent = Schema.is(ToolContentSchema);
