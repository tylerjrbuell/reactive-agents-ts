import { Schema } from "effect";

// Typed message / tool-result content (Plan 9 Phase 4, principle 8: the core
// assumes no modality). Text is one part kind. Field names match
// llm-provider's ImageSource so its ContentBlock stays the wire view of these
// parts rather than a second type.
//
// Canonical form (load-bearing for replay): content whose every part is text
// is stored as ONE string. normalizeContent enforces it, so text-only runs keep
// today's exact bytes and replay hashes.

// ─── Sources and references ───

/** Inline or remote media bytes: base64 data or an HTTP(S) URL. */
export const MediaSourceSchema = Schema.Struct({
  type: Schema.Literal("base64", "url"),
  /** MIME type, e.g. `image/png`, `audio/wav`. */
  media_type: Schema.String,
  /** Base64 data (`type: "base64"`) or URL (`type: "url"`). */
  data: Schema.String,
});
export type MediaSource = typeof MediaSourceSchema.Type;

/** A reference to stored content (workspace file, diff, report). Never inline bytes. */
export const ArtifactRefSchema = Schema.Struct({
  uri: Schema.String,
  media_type: Schema.String,
  name: Schema.optional(Schema.String),
  bytes: Schema.optional(Schema.Number),
  sha256: Schema.optional(Schema.String),
});
export type ArtifactRef = typeof ArtifactRefSchema.Type;

// ─── Parts ───

export const TextPartSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});
export type TextPart = typeof TextPartSchema.Type;

export const ImagePartSchema = Schema.Struct({
  type: Schema.Literal("image"),
  source: MediaSourceSchema,
});
export type ImagePart = typeof ImagePartSchema.Type;

export const AudioPartSchema = Schema.Struct({
  type: Schema.Literal("audio"),
  source: MediaSourceSchema,
  transcript: Schema.optional(Schema.String),
});
export type AudioPart = typeof AudioPartSchema.Type;

export const FilePartSchema = Schema.Struct({
  type: Schema.Literal("file"),
  ref: ArtifactRefSchema,
});
export type FilePart = typeof FilePartSchema.Type;

/** One typed unit of message or tool-result content. */
export const ContentPartSchema = Schema.Union(
  TextPartSchema,
  ImagePartSchema,
  AudioPartSchema,
  FilePartSchema,
);
export type ContentPart = typeof ContentPartSchema.Type;

/** Message content: a string (canonical for text-only) or typed parts. */
export const MessageContentSchema = Schema.Union(
  Schema.String,
  Schema.Array(ContentPartSchema),
);
export type MessageContent = typeof MessageContentSchema.Type;

// ─── Helpers ───

/**
 * The text of some content: a string passes through; text parts are joined
 * with `""` (the same rule as llm-provider's `messageContentToString`);
 * non-text parts contribute nothing.
 */
export const contentText = (content: MessageContent): string =>
  typeof content === "string"
    ? content
    : content.map((p) => (p.type === "text" ? p.text : "")).join("");

/** The parts of some content. A string becomes one text part (none if empty). */
export const contentParts = (content: MessageContent): readonly ContentPart[] =>
  typeof content === "string"
    ? content.length === 0
      ? []
      : [{ type: "text", text: content }]
    : content;

/**
 * Canonical form. Content made only of text parts collapses to one string;
 * anything with a non-text part stays as parts. Idempotent.
 */
export const normalizeContent = (content: MessageContent): MessageContent =>
  typeof content === "string" || content.some((p) => p.type !== "text")
    ? content
    : contentText(content);
