/**
 * kernel/utils/part-summary.ts — media part summaries for traces and
 * checkpoints (Plan 9 Phase 4 stage F).
 *
 * Traces and checkpoints record WHAT a non-text part was (kind, MIME type,
 * decoded size, a hash of its source), never its bytes: a 200 KB screenshot
 * must not ride every trace line and every durable checkpoint row (size, PII).
 * This module is the one place that turns a part into that summary:
 *   - `summarizePart`        — a core ContentPart (the kernel side)
 *   - `summarizeWireContent` — the image blocks of a provider wire message
 *                              (observable-llm, for the `llm-exchange` event)
 *   - `checkpointMediaStub`  — the text part that replaces inline media in a
 *                              serialized KernelState (kernel-codec)
 *
 * The sha256 is over the source data (base64 payload or URL), the same input
 * llm-provider's `mediaPlaceholder` hashes, so its first 12 hex chars match the
 * `[image:<media_type>:<sha256-12>]` placeholder in the exchange text.
 *
 * Pure. No Effect, no state.
 */
import { createHash } from "node:crypto";
import type {
  AudioPart,
  ContentPart,
  ContentPartSummary,
  ImagePart,
  MediaSource,
  TextPart,
} from "@reactive-agents/core";

/** A part that is not text. */
export type MediaPart = Exclude<ContentPart, { type: "text" }>;

/** Decoded size of a base64 payload, computed without decoding. Deterministic. */
export const base64DecodedBytes = (data: string): number => {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
};

const sha256Hex = (input: string): string => createHash("sha256").update(input, "utf8").digest("hex");

/** Summary of an image or audio source: decoded size for base64, hash of the data either way. */
export const summarizeMediaSource = (type: "image" | "audio", source: MediaSource): ContentPartSummary => ({
  type,
  media_type: source.media_type,
  ...(source.type === "base64" ? { bytes: base64DecodedBytes(source.data) } : {}),
  sha256: sha256Hex(source.data),
});

/** Summary of one non-text part. A file part is already a reference: its own size and hash pass through. */
export const summarizePart = (part: MediaPart): ContentPartSummary =>
  part.type === "file"
    ? {
        type: "file",
        media_type: part.ref.media_type,
        ...(part.ref.bytes !== undefined ? { bytes: part.ref.bytes } : {}),
        ...(part.ref.sha256 !== undefined ? { sha256: part.ref.sha256 } : {}),
      }
    : summarizeMediaSource(part.type, part.source);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const asMediaSource = (v: unknown): MediaSource | undefined =>
  isRecord(v) &&
  (v.type === "base64" || v.type === "url") &&
  typeof v.media_type === "string" &&
  typeof v.data === "string"
    ? { type: v.type, media_type: v.media_type, data: v.data }
    : undefined;

/**
 * Summaries of the image blocks of a provider wire message's content
 * (`LLMMessage["content"]`: a string or ContentBlock[]). Empty for strings and
 * text-only block lists, so text messages carry no `parts` field.
 */
export const summarizeWireContent = (content: unknown): readonly ContentPartSummary[] => {
  if (!Array.isArray(content)) return [];
  const out: ContentPartSummary[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== "image") continue;
    const source = asMediaSource(block.source);
    if (source !== undefined) out.push(summarizeMediaSource("image", source));
  }
  return out;
};

/**
 * Structural guard: an image or audio part (or a wire image block, same
 * shape) whose source holds inline base64 bytes. URL sources carry no bytes
 * and are not matched.
 */
export const isInlineMediaPart = (v: unknown): v is ImagePart | AudioPart => {
  if (!isRecord(v) || (v.type !== "image" && v.type !== "audio")) return false;
  const source = asMediaSource(v.source);
  return source !== undefined && source.type === "base64";
};

/**
 * The text part that stands in for inline media in a serialized KernelState.
 * Checkpoints never hold media bytes, so a resumed run sees this stub where
 * the media was (an audio transcript, being text, is kept).
 */
export const checkpointMediaStub = (part: ImagePart | AudioPart): TextPart => {
  const s = summarizeMediaSource(part.type, part.source);
  const transcript = part.type === "audio" && part.transcript !== undefined ? `; transcript: ${part.transcript}` : "";
  return {
    type: "text",
    text: `[${s.type} omitted from checkpoint: ${s.media_type}, ${s.bytes ?? 0} bytes, sha256:${(s.sha256 ?? "").slice(0, 12)}${transcript}]`,
  };
};
