import { Schema } from "effect";
import {
  ImagePartSchema,
  MediaSourceSchema,
  TextPartSchema,
  type ImagePart,
  type MediaSource,
  type TextPart,
} from "@reactive-agents/core";

// Wire content blocks (moved out of types.ts, Plan 9 Phase 4 stage C).
//
// The text and image blocks are DERIVED from core's typed parts, not a parallel
// type: a text block is a core `TextPart` plus Anthropic's optional
// `cache_control`; an image block is a core `ImagePart` whose source is narrowed
// to the four image MIME types every image-capable provider accepts. tool_use
// and tool_result stay wire-only blocks.

// ─── Cache Control (Anthropic Prompt Caching) ───

/**
 * Schema for Anthropic prompt caching control.
 * Currently only supports "ephemeral" type (cache for this request only).
 * Non-Anthropic providers silently ignore cache_control directives.
 *
 * @example
 * ```typescript
 * const cacheControl: CacheControl = { type: "ephemeral" };
 * ```
 */
export const CacheControlSchema = Schema.Struct({
  /** Cache type: "ephemeral" for request-scoped caching */
  type: Schema.Literal("ephemeral"),
});

/**
 * Anthropic prompt caching configuration.
 * Wraps text content blocks to enable prompt caching optimization.
 * Reduces costs for repeated context; only supported on Anthropic provider.
 */
export type CacheControl = Schema.Schema.Type<typeof CacheControlSchema>;

// ─── Content Blocks ───

/**
 * Schema for image source reference: a narrowing of core's `MediaSource`
 * (same fields) to the PNG, JPEG, GIF and WebP MIME types.
 *
 * @example
 * ```typescript
 * const source: ImageSource = {
 *   type: "base64",
 *   media_type: "image/png",
 *   data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
 * };
 * ```
 */
export const ImageSourceSchema = Schema.Struct({
  ...MediaSourceSchema.fields,
  /** MIME type of image: PNG, JPEG, GIF, or WebP */
  media_type: Schema.Literal(
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ),
});

/**
 * Image source reference type.
 * Either a base64-encoded image or an HTTPS URL to an image resource.
 * Assignable to core `MediaSource`.
 */
export type ImageSource = Schema.Schema.Type<typeof ImageSourceSchema>;

/**
 * Type guard: a core `MediaSource` whose MIME type is one of the four wire
 * image types, so it can travel as an image block.
 *
 * @param source — any media source
 * @returns true when `source` narrows to {@link ImageSource}
 */
export const isImageSource = (source: MediaSource): source is ImageSource =>
  Schema.is(ImageSourceSchema)(source);

/**
 * Schema for text content blocks: core `TextPart` plus an optional Anthropic
 * cache_control directive.
 *
 * @example
 * ```typescript
 * const textBlock: TextContentBlock = {
 *   type: "text",
 *   text: "This is a text message"
 * };
 * ```
 */
export const TextContentBlockSchema = Schema.Struct({
  ...TextPartSchema.fields,
  /** Optional Anthropic cache control directive */
  cache_control: Schema.optional(CacheControlSchema),
});

/**
 * Schema for image content blocks: core `ImagePart` with the source narrowed
 * to {@link ImageSourceSchema}.
 *
 * @example
 * ```typescript
 * const imageBlock: ImageContentBlock = {
 *   type: "image",
 *   source: { type: "url", media_type: "image/png", data: "https://..." }
 * };
 * ```
 */
export const ImageContentBlockSchema = Schema.Struct({
  ...ImagePartSchema.fields,
  /** Image source reference */
  source: ImageSourceSchema,
});

/**
 * Schema for tool use content blocks (model invoking a tool).
 *
 * @example
 * ```typescript
 * const toolBlock: ToolUseContentBlock = {
 *   type: "tool_use",
 *   id: "toolu_123",
 *   name: "file-read",
 *   input: { path: "./output.txt" }
 * };
 * ```
 */
export const ToolUseContentBlockSchema = Schema.Struct({
  /** Content type identifier */
  type: Schema.Literal("tool_use"),
  /** Unique tool call identifier */
  id: Schema.String,
  /** Tool name being invoked */
  name: Schema.String,
  /** Tool parameters (JSON-compatible object) */
  input: Schema.Unknown,
});

/**
 * Schema for tool result content blocks (system returning tool output).
 *
 * @example
 * ```typescript
 * const resultBlock: ToolResultContentBlock = {
 *   type: "tool_result",
 *   tool_use_id: "toolu_123",
 *   content: "File contents..."
 * };
 * ```
 */
export const ToolResultContentBlockSchema = Schema.Struct({
  /** Content type identifier */
  type: Schema.Literal("tool_result"),
  /** ID of tool call this result corresponds to */
  tool_use_id: Schema.String,
  /** Tool result/output content */
  content: Schema.String,
});

/**
 * Union of all content block types used in LLM messages.
 * Content blocks allow mixing text, images, tool invocations, and tool results.
 * The text and image variants are core `TextPart` / `ImagePart`.
 *
 * @example
 * ```typescript
 * const blocks: readonly ContentBlock[] = [
 *   { type: "text", text: "Analyze this image:" },
 *   { type: "image", source: { type: "url", media_type: "image/png", data: "https://..." } }
 * ];
 * ```
 */
export type ContentBlock =
  /** Text content (optionally cached with Anthropic) */
  | (TextPart & { readonly cache_control?: CacheControl })
  /** Image content */
  | (ImagePart & { readonly source: ImageSource })
  | {
      /** Model invoking a tool */
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }
  | {
      /** System returning tool output */
      readonly type: "tool_result";
      readonly tool_use_id: string;
      readonly content: string;
    };

/**
 * The blocks a `role: "tool"` message may carry when its content is not a
 * plain string: text and image. A tool result never contains tool_use or
 * nested tool_result blocks.
 */
export type ToolMessageBlock = Extract<ContentBlock, { readonly type: "text" | "image" }>;

// ─── Cacheable Content Block ───

/**
 * Text content block with cache control enabled.
 * Used when text context should be cached for cost reduction (Anthropic only).
 * Non-Anthropic providers silently ignore the cache_control directive.
 *
 * @example
 * ```typescript
 * const cached: CacheableContentBlock = {
 *   type: "text",
 *   text: "Expensive context (system prompt, instructions, etc)",
 *   cache_control: { type: "ephemeral" }
 * };
 * ```
 */
export type CacheableContentBlock = {
  /** Always "text" */
  readonly type: "text";
  /** Cached text content */
  readonly text: string;
  /** Cache control directive (always ephemeral) */
  readonly cache_control: CacheControl;
};

/**
 * Wrap plain text in a cacheable content block.
 * Enables Anthropic prompt caching for the given text (no-op for other providers).
 * Useful for repeated context like system prompts, instructions, or reference documents.
 *
 * @param text — The text to cache
 * @returns A content block with ephemeral cache control enabled
 *
 * @example
 * ```typescript
 * const cached = makeCacheable("You are a helpful assistant...");
 * // Returns: { type: "text", text: "...", cache_control: { type: "ephemeral" } }
 * ```
 */
export const makeCacheable = (text: string): CacheableContentBlock => ({
  type: "text",
  text,
  cache_control: { type: "ephemeral" },
});
