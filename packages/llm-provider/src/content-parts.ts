import { Effect } from "effect";
import {
  base64DecodedBytes,
  mediaLabel,
  sha256Hex,
  type ArtifactRef,
  type AudioPart,
  type FilePart,
  type MediaSource,
} from "@reactive-agents/core";
import type { Capability } from "./capability.js";
import type { InputModality } from "./capabilities.js";
import type { ContentBlock, ImageSource } from "./content-blocks.js";
import type { LLMMessage } from "./types.js";

// Provider-boundary handling of non-text content parts (Plan 9 Phase 4 stage C).
//
// Only the provider boundary knows modalities; the kernel never branches on
// them. Each adapter maps an image or audio part to its wire format when it
// can, and otherwise renders a deterministic text stub and records a
// `content-part-degraded` fact. File parts have no native wire path on any
// provider: inline-text files become text, every other file becomes a stub.
// Nothing is silently dropped.

/** Message role, as used by the wire rules below. */
export type MessageRole = LLMMessage["role"];

/** Why a media part did not reach the model as that media. */
export type DegradeReason =
  /** The provider declares no image input at all. */
  | "provider-no-image-input"
  /** The resolved model capability says the model has no vision. */
  | "model-no-image-input"
  /** The provider accepts inline base64 images only, and the source is a URL. */
  | "url-image-unsupported"
  /** The provider's wire format has no image slot for this message role. */
  | "role-no-image-input"
  /** The provider declares no audio input. */
  | "provider-no-audio-input"
  /** The resolved model capability says the model has no audio input. */
  | "model-no-audio-input"
  /** The capability row is a guess, so audio is not risked on the model. */
  | "model-audio-unverified"
  /** The provider's wire format has no audio slot for this message role. */
  | "role-no-audio-input"
  /** The provider accepts inline base64 audio only, and the source is a URL. */
  | "url-audio-unsupported"
  /** The audio MIME type is not one the provider's wire format accepts. */
  | "audio-format-unsupported"
  /** No provider takes file parts, and the file's bytes are not inline text data. */
  | "file-not-inlinable"
  /** No provider takes file parts, and the file is not a text-like type. */
  | "file-not-text";

/** One degraded part: what it was and why it became a stub. Never raw bytes. */
export interface DegradedPart {
  readonly partType: "image" | "audio" | "file";
  readonly mediaType: string;
  /** Decoded size for base64 sources; undefined for URL sources. */
  readonly bytes: number | undefined;
  readonly role: MessageRole;
  readonly reason: DegradeReason;
  /** Audio only: the transcript, kept in the stub because it is text. */
  readonly transcript?: string;
  /** File only: display name (`name at uri`, or `inline data` for data URIs). */
  readonly name?: string;
}

/** Per-request media admission, from provider declaration plus model capability. */
export interface ContentPolicy {
  /** Set when images are blocked for the whole request; undefined when allowed. */
  readonly imageBlocked: "provider-no-image-input" | "model-no-image-input" | undefined;
  /**
   * Audio admission. Absent: the provider declares no audio input. `"send"`:
   * audio may go on the wire (still subject to role, URL and format rules).
   * A reason: the provider takes audio but this model is not confirmed to.
   */
  readonly audio?: "send" | "model-no-audio-input" | "model-audio-unverified";
}

/** Policy that admits images (used where a mapper is called without a request context). */
export const IMAGES_ALLOWED: ContentPolicy = { imageBlocked: undefined };

const isAuthoritative = (cap: Pick<Capability, "source"> | undefined): boolean =>
  cap !== undefined && (cap.source === "probe" || cap.source === "static-table");

/**
 * Resolve the per-request content policy.
 *
 * Images: the provider must declare `"image"`. The model gate applies only
 * when the capability row is authoritative (`probe` or `static-table`); a
 * fallback, inferred or user-supplied row carries a guessed `supportsVision`,
 * so the image is sent and a real refusal surfaces as a provider error rather
 * than a stub built on a guess.
 *
 * Audio is stricter because few models take it: it is admitted only when the
 * provider declares `"audio"` AND the row is authoritative AND
 * `supportsAudioIn` is true. A guessed row degrades the audio instead.
 *
 * @param declared — the provider's declared input modalities (absent = text only)
 * @param cap — the resolved model capability, when available
 */
export const resolveContentPolicy = (
  declared: readonly InputModality[] | undefined,
  cap?: Pick<Capability, "supportsVision" | "supportsAudioIn" | "source">,
): ContentPolicy => {
  const modalities = declared ?? [];
  const image: ContentPolicy = !modalities.includes("image")
    ? { imageBlocked: "provider-no-image-input" }
    : isAuthoritative(cap) && cap !== undefined && !cap.supportsVision
      ? { imageBlocked: "model-no-image-input" }
      : IMAGES_ALLOWED;
  if (!modalities.includes("audio")) return image;
  const audio: NonNullable<ContentPolicy["audio"]> = !isAuthoritative(cap)
    ? "model-audio-unverified"
    : cap?.supportsAudioIn === true
      ? "send"
      : "model-no-audio-input";
  return { ...image, audio };
};

/** What a provider's wire format can carry for audio. Base64 only. */
export interface AudioWireRules {
  /** Roles whose wire message has an audio slot. */
  readonly roles: readonly MessageRole[];
  /** Accepted audio MIME types, lowercase, exact match. */
  readonly mediaTypes: readonly string[];
}

/** What a provider's wire format can carry for images, and optionally audio. */
export interface ImageWireRules {
  /** True when URL sources can be sent as-is (OpenAI `image_url`). */
  readonly url: boolean;
  /** Roles whose wire message has an image slot. */
  readonly roles: readonly MessageRole[];
  /** Audio slot; absent when the wire format has none. */
  readonly audio?: AudioWireRules;
}

/** Wire rules that include an audio slot. */
export type AudioCapableRules = ImageWireRules & { readonly audio: AudioWireRules };

/** The fate of one image part at a provider boundary. */
export type ImageRoute =
  | { readonly kind: "send"; readonly source: ImageSource }
  | { readonly kind: "stub"; readonly text: string; readonly degraded: DegradedPart };

const REASON_TEXT: Record<Exclude<DegradeReason, "role-no-image-input" | "role-no-audio-input">, string> = {
  "provider-no-image-input": "provider has no image input",
  "model-no-image-input": "model has no image input",
  "url-image-unsupported": "provider accepts inline base64 images only",
  "provider-no-audio-input": "provider has no audio input",
  "model-no-audio-input": "model has no audio input",
  "model-audio-unverified": "model audio input is unverified",
  "url-audio-unsupported": "provider accepts inline base64 audio only",
  "audio-format-unsupported": "audio format is not accepted by the provider",
  "file-not-inlinable": "provider has no file input and the file is not inline data",
  "file-not-text": "provider has no file input and the file is not text",
};

/**
 * Deterministic text stub for a degraded part, e.g.
 * `[image omitted: image/png, 41 KB; model has no image input]`. An audio
 * transcript, being text, stays in the stub (`; transcript: ...`).
 *
 * @param d — the degraded part
 */
export const degradedStub = (d: DegradedPart): string =>
  mediaLabel(
    {
      kind: d.partType,
      mediaType: d.mediaType,
      bytes: d.bytes,
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.transcript !== undefined ? { transcript: d.transcript } : {}),
    },
    d.reason === "role-no-image-input"
      ? `provider has no image input in ${d.role} messages`
      : d.reason === "role-no-audio-input"
        ? `provider has no audio input in ${d.role} messages`
        : REASON_TEXT[d.reason],
  );

/**
 * Decide whether an image part is sent or stubbed. Order: request policy,
 * then the role's wire slot, then URL support.
 *
 * @param source — the image source
 * @param role — the message role carrying the image
 * @param policy — the per-request policy from {@link resolveContentPolicy}
 * @param rules — the provider's image wire rules
 */
export const routeImage = (
  source: ImageSource,
  role: MessageRole,
  policy: ContentPolicy,
  rules: ImageWireRules,
): ImageRoute => {
  const reason: DegradeReason | undefined =
    policy.imageBlocked ??
    (!rules.roles.includes(role)
      ? "role-no-image-input"
      : source.type === "url" && !rules.url
        ? "url-image-unsupported"
        : undefined);
  if (reason === undefined) return { kind: "send", source };
  const degraded: DegradedPart = {
    partType: "image",
    mediaType: source.media_type,
    bytes: source.type === "base64" ? base64DecodedBytes(source.data) : undefined,
    role,
    reason,
  };
  return { kind: "stub", text: degradedStub(degraded), degraded };
};

// ─── File parts ───

/**
 * Most bytes of an inline text file that reach the model. Longer files are cut
 * at this byte count and end with a visible truncation marker.
 */
export const FILE_INLINE_MAX_BYTES = 32 * 1024;

const TEXT_APPLICATION_TYPES: ReadonlySet<string> = new Set([
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/x-ndjson",
  "application/javascript",
  "application/typescript",
  "application/toml",
  "application/sql",
]);

/** True for `text/*`, the common text `application/*` types, and `+json` / `+xml` suffixes. */
export const isTextLikeMediaType = (mediaType: string): boolean => {
  const base = (mediaType.split(";")[0] ?? "").trim().toLowerCase();
  return (
    base.startsWith("text/") || TEXT_APPLICATION_TYPES.has(base) || base.endsWith("+json") || base.endsWith("+xml")
  );
};

/** Display name for a file ref. A data URI is never echoed (it holds the bytes). */
const fileName = (ref: ArtifactRef): string =>
  ref.uri.startsWith("data:")
    ? (ref.name ?? "inline data")
    : ref.name === undefined
      ? ref.uri
      : `${ref.name} at ${ref.uri}`;

/** Decode a `data:<type>;base64,<data>` URI to bytes; undefined for any other uri. */
const dataUriBytes = (uri: string): Buffer | undefined => {
  const m = /^data:[^,]*;base64,(.*)$/s.exec(uri);
  return m === null ? undefined : Buffer.from(m[1] ?? "", "base64");
};

/** The fate of one file part: its text, or a stub. Files are never sent as bytes. */
export type FileRoute =
  | { readonly kind: "inline"; readonly text: string }
  | { readonly kind: "stub"; readonly text: string; readonly degraded: DegradedPart };

/**
 * Turn a file part into text. A text-like file whose bytes are inline
 * (`data:...;base64,` uri) is decoded and inlined behind its label, cut at
 * {@link FILE_INLINE_MAX_BYTES} with a visible marker. Any other file becomes a
 * stub: the provider boundary does no storage I/O, so a path or remote uri is
 * not read here (resolve the ref to inline text upstream).
 *
 * @param part — the file part
 * @param role — the message role carrying the file
 */
export const routeFile = (part: FilePart, role: MessageRole): FileRoute => {
  const { ref } = part;
  const name = fileName(ref);
  const bytes = dataUriBytes(ref.uri);
  const reason: DegradeReason | undefined = !isTextLikeMediaType(ref.media_type)
    ? "file-not-text"
    : bytes === undefined
      ? "file-not-inlinable"
      : undefined;
  if (reason === undefined && bytes !== undefined) {
    const cut = bytes.length > FILE_INLINE_MAX_BYTES;
    const body = bytes.subarray(0, FILE_INLINE_MAX_BYTES).toString("utf8");
    const header = mediaLabel({ kind: "file", mediaType: ref.media_type, name });
    const marker = cut ? `\n[truncated: first ${FILE_INLINE_MAX_BYTES} of ${bytes.length} bytes]` : "";
    return { kind: "inline", text: `${header}\n${body}${marker}` };
  }
  const degraded: DegradedPart = {
    partType: "file",
    mediaType: ref.media_type,
    bytes: ref.bytes ?? bytes?.length,
    role,
    reason: reason ?? "file-not-inlinable",
    name,
  };
  return { kind: "stub", text: degradedStub(degraded), degraded };
};

// ─── The one media router ───

/** An image, audio or file block: the parts the router decides on. */
export type MediaBlock = Extract<ContentBlock, { readonly type: "image" | "audio" | "file" }>;

/** The fate of one media part at a provider boundary. */
export type MediaRoute =
  | { readonly kind: "send-image"; readonly source: ImageSource }
  | { readonly kind: "send-audio"; readonly source: MediaSource }
  | { readonly kind: "text"; readonly text: string; readonly degraded?: DegradedPart };

const routeAudio = (part: AudioPart, role: MessageRole, policy: ContentPolicy, rules: ImageWireRules): MediaRoute => {
  const slot = rules.audio;
  const reason: DegradeReason | undefined =
    policy.audio === undefined
      ? "provider-no-audio-input"
      : policy.audio !== "send"
        ? policy.audio
        : slot === undefined || !slot.roles.includes(role)
          ? "role-no-audio-input"
          : part.source.type === "url"
            ? "url-audio-unsupported"
            : !slot.mediaTypes.includes(part.source.media_type.toLowerCase())
              ? "audio-format-unsupported"
              : undefined;
  if (reason === undefined) return { kind: "send-audio", source: part.source };
  const degraded: DegradedPart = {
    partType: "audio",
    mediaType: part.source.media_type,
    bytes: part.source.type === "base64" ? base64DecodedBytes(part.source.data) : undefined,
    role,
    reason,
    ...(part.transcript !== undefined ? { transcript: part.transcript } : {}),
  };
  return { kind: "text", text: degradedStub(degraded), degraded };
};

/**
 * Route one image, audio or file part: send it, or replace it with text and
 * report the degradation. The single router behind every adapter.
 *
 * @param block — the media block
 * @param role — the message role carrying it
 * @param policy — the per-request policy from {@link resolveContentPolicy}
 * @param rules — the provider's wire rules (an `audio` slot makes audio sendable)
 */
export function routeMedia(
  block: MediaBlock,
  role: MessageRole,
  policy: ContentPolicy,
  rules: AudioCapableRules,
): MediaRoute;
export function routeMedia(
  block: MediaBlock,
  role: MessageRole,
  policy: ContentPolicy,
  rules: ImageWireRules,
): Exclude<MediaRoute, { readonly kind: "send-audio" }>;
export function routeMedia(
  block: MediaBlock,
  role: MessageRole,
  policy: ContentPolicy,
  rules: ImageWireRules,
): MediaRoute {
  if (block.type === "image") {
    const r = routeImage(block.source, role, policy, rules);
    return r.kind === "send" ? { kind: "send-image", source: r.source } : { kind: "text", text: r.text, degraded: r.degraded };
  }
  if (block.type === "audio") return routeAudio(block, role, policy, rules);
  const f = routeFile(block, role);
  return f.kind === "inline" ? { kind: "text", text: f.text } : { kind: "text", text: f.text, degraded: f.degraded };
}

/** A block after routing: media that cannot be sent is already a text stub. */
export type ResolvedPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly source: ImageSource }
  | { readonly kind: "audio"; readonly source: MediaSource };

/**
 * Route the text and media blocks of one message. Text passes through in
 * order; each image, audio or file is either kept or replaced in place by
 * text. Other block kinds (tool_use, tool_result) are skipped: adapters map
 * those themselves.
 *
 * @param blocks — the message's content blocks
 * @param role — the message role
 * @param policy — the per-request policy
 * @param rules — the provider's wire rules
 * @returns the routed parts plus the degradations to emit
 */
export const resolveParts = (
  blocks: readonly ContentBlock[],
  role: MessageRole,
  policy: ContentPolicy,
  rules: ImageWireRules,
): { readonly parts: readonly ResolvedPart[]; readonly degraded: readonly DegradedPart[] } => {
  const parts: ResolvedPart[] = [];
  const degraded: DegradedPart[] = [];
  for (const b of blocks) {
    if (b.type === "text") {
      parts.push({ kind: "text", text: b.text });
      continue;
    }
    if (b.type !== "image" && b.type !== "audio" && b.type !== "file") continue;
    const route = routeMedia(b, role, policy, { ...rules, audio: rules.audio ?? { roles: [], mediaTypes: [] } });
    if (route.kind === "send-image") parts.push({ kind: "image", source: route.source });
    else if (route.kind === "send-audio") parts.push({ kind: "audio", source: route.source });
    else {
      parts.push({ kind: "text", text: route.text });
      if (route.degraded !== undefined) degraded.push(route.degraded);
    }
  }
  return { parts, degraded };
};

/**
 * Join the text of routed parts with `""` (the flattening rule of
 * `messageContentToString`). Image and audio parts contribute nothing; callers
 * that flatten route with rules that stub every media part first.
 *
 * @param parts — routed parts
 */
export const joinText = (parts: readonly ResolvedPart[]): string =>
  parts.map((p) => (p.kind === "text" ? p.text : "")).join("");

/** Rules for a wire slot that carries text only: every image and audio part becomes a stub. */
export const TEXT_ONLY_RULES: ImageWireRules = { url: false, roles: [] };

/**
 * Stable trace/replay placeholder for a media part:
 * `[image:<media_type>:<sha256-12>]`, hashed over the source data (base64
 * payload or URL; for a file, its uri). Two requests differing only in a media
 * part get different keys.
 *
 * The hash is core's `sha256Hex` over `data`, the same input and function
 * `summarizeMediaSource` uses for `ContentPartSummary.sha256` in traces, so
 * the 12-char prefix matches the summary.
 *
 * @param kind — the part kind
 * @param source — the media source
 */
export const mediaPlaceholder = (
  kind: "image" | "audio" | "file",
  source: Pick<MediaSource, "media_type" | "data">,
): string => `[${kind}:${source.media_type}:${sha256Hex(source.data).slice(0, 12)}]`;

/**
 * Emit one `content-part-degraded` fact per degraded part through the Effect
 * logger (the provider layer's structured channel, same as
 * `tool-schema-repaired`). Annotations carry type, MIME, size, role and reason;
 * never raw bytes.
 *
 * @param provider — provider name
 * @param model — model id
 * @param degraded — parts degraded while mapping this request
 */
export const emitContentDegradations = (
  provider: string,
  model: string,
  degraded: readonly DegradedPart[],
): Effect.Effect<void> =>
  Effect.forEach(
    degraded,
    (d) =>
      Effect.logWarning("content-part-degraded").pipe(
        Effect.annotateLogs({
          event: "content-part-degraded",
          provider,
          model,
          partType: d.partType,
          mediaType: d.mediaType,
          bytes: d.bytes === undefined ? "unknown" : String(d.bytes),
          role: d.role,
          reason: d.reason,
        }),
      ),
    { discard: true },
  );
