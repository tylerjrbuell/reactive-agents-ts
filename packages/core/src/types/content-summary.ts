/**
 * types/content-summary.ts — media part summaries and the inline-media
 * redaction rule (Plan 9 Phase 4 stage F).
 *
 * Traces, checkpoints and run results record WHAT a non-text part was (kind,
 * MIME type, decoded size, a hash of its source), never its bytes: a 200 KB
 * screenshot must not ride every trace line, checkpoint row or result payload
 * (size, PII). This module is the one place that turns a part into that
 * summary and the one place that strips inline bytes:
 *   - `summarizePart` / `summarizeParts` — core ContentParts
 *   - `summarizeWireContent` — the image blocks of a provider wire message
 *   - `mediaPartLabel` / `mediaLabel` — the readable label for a non-text part
 *   - `inlineMediaStub` — the text part that replaces one inline media part
 *   - `redactInlineMedia` — a part list with every inline media part stubbed
 *
 * The sha256 is over the source data (base64 payload or URL), the same input
 * llm-provider's `mediaPlaceholder` hashes, so its first 12 hex chars match the
 * `[image:<media_type>:<sha256-12>]` placeholder in the exchange text.
 *
 * Pure. No Effect, no state. Browser-safe (no `node:` imports): the core root
 * index is bundled into browser apps.
 */
import { sha256Hex } from "../utils/sha256.js";
import type {
  AudioPart,
  ContentPart,
  ContentPartSummary,
  ImagePart,
  MediaSource,
  TextPart,
} from "./content.js";

/** A part that is not text. */
export type MediaPart = Exclude<ContentPart, { type: "text" }>;

/** Decoded size of a base64 payload, computed without decoding. Deterministic. */
export const base64DecodedBytes = (data: string): number => {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
};

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

/** Summaries of the non-text parts of a list, in order. Text parts contribute nothing. */
export const summarizeParts = (parts: readonly ContentPart[]): readonly ContentPartSummary[] =>
  parts.flatMap((p) => (p.type === "text" ? [] : [summarizePart(p)]));

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
 * The text part that stands in for one inline media part wherever bytes must
 * not be persisted (checkpoints, run results). Readers see this stub where the
 * media was; an audio transcript, being text, is kept.
 */
export const inlineMediaStub = (part: ImagePart | AudioPart): TextPart => {
  const s = summarizeMediaSource(part.type, part.source);
  const transcript = part.type === "audio" && part.transcript !== undefined ? `; transcript: ${part.transcript}` : "";
  return {
    type: "text",
    text: `[${s.type} omitted from record: ${s.media_type}, ${s.bytes ?? 0} bytes, sha256:${(s.sha256 ?? "").slice(0, 12)}${transcript}]`,
  };
};

/** The facts a {@link mediaLabel} states about one non-text part. Never bytes. */
export interface MediaLabelFacts {
  readonly kind: "image" | "audio" | "file";
  readonly mediaType: string;
  /** Decoded size in bytes; undefined for a remote (URL) source. Not shown when `name` is set. */
  readonly bytes?: number | undefined;
  /** Where a file part lives (`name at uri`, or the uri); shown instead of a size. */
  readonly name?: string | undefined;
  /** An audio transcript. Being text, it is kept in the label. */
  readonly transcript?: string | undefined;
}

/**
 * The one human-readable label for a non-text part, seen by models and
 * traces wherever a part is shown as text:
 * `[<kind>: <media_type>, <size or name>; transcript: <t>]`, or with a reason
 * `[<kind> omitted: <media_type>, <size or name>; <why>; transcript: <t>]`.
 * Size is `N KB` (at least 1) or `remote url`. The transcript comes last
 * because it is free text. Deterministic.
 *
 * Not used by {@link inlineMediaStub} or llm-provider's `mediaPlaceholder`:
 * those formats carry exact bytes and a hash and are pinned for record and
 * replay keys.
 *
 * @param facts — what the part is
 * @param why — why the part did not reach its reader as media; adds "omitted"
 */
export const mediaLabel = (facts: MediaLabelFacts, why?: string): string => {
  const head = why === undefined ? facts.kind : `${facts.kind} omitted`;
  const detail =
    facts.name ?? (facts.bytes === undefined ? "remote url" : `${Math.max(1, Math.round(facts.bytes / 1024))} KB`);
  const reason = why === undefined ? "" : `; ${why}`;
  const transcript = facts.transcript === undefined ? "" : `; transcript: ${facts.transcript}`;
  return `[${head}: ${facts.mediaType}, ${detail}${reason}${transcript}]`;
};

/** The {@link MediaLabelFacts} of one non-text part. */
const mediaLabelFacts = (part: MediaPart): MediaLabelFacts => {
  if (part.type === "file") {
    const { name, uri, media_type } = part.ref;
    return { kind: "file", mediaType: media_type, name: name === undefined ? uri : `${name} at ${uri}` };
  }
  const bytes = part.source.type === "base64" ? base64DecodedBytes(part.source.data) : undefined;
  return {
    kind: part.type,
    mediaType: part.source.media_type,
    bytes,
    ...(part.type === "audio" && part.transcript !== undefined ? { transcript: part.transcript } : {}),
  };
};

/**
 * The {@link mediaLabel} of one non-text part.
 *
 * @param part — the image, audio or file part
 * @param why — why the part did not reach its reader as media; adds "omitted"
 */
export const mediaPartLabel = (part: MediaPart, why?: string): string => mediaLabel(mediaLabelFacts(part), why);

/**
 * A part list with every inline base64 image/audio part replaced by its
 * `inlineMediaStub`. URL-sourced media and file parts carry no bytes and are
 * kept. A list with no inline media is returned by reference (no copy).
 * Accepts untyped lists too (e.g. step metadata read at a boundary): any
 * element that is not inline media passes through unchanged.
 */
export function redactInlineMedia(parts: readonly ContentPart[]): readonly ContentPart[];
export function redactInlineMedia(parts: readonly unknown[]): readonly unknown[];
export function redactInlineMedia(parts: readonly unknown[]): readonly unknown[] {
  return parts.some(isInlineMediaPart) ? parts.map((p) => (isInlineMediaPart(p) ? inlineMediaStub(p) : p)) : parts;
}
