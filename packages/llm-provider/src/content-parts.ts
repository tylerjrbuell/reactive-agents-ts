import { Effect } from "effect";
import { base64DecodedBytes, mediaLabel, sha256Hex, type MediaSource } from "@reactive-agents/core";
import type { Capability } from "./capability.js";
import type { InputModality } from "./capabilities.js";
import type { ContentBlock, ImageSource } from "./content-blocks.js";
import type { LLMMessage } from "./types.js";

// Provider-boundary handling of non-text content parts (Plan 9 Phase 4 stage C).
//
// Only the provider boundary knows modalities; the kernel never branches on
// them. Each adapter maps an image part to its wire format when it can, and
// otherwise renders a deterministic text stub and records a
// `content-part-degraded` fact. Nothing is silently dropped.

/** Message role, as used by the wire rules below. */
export type MessageRole = LLMMessage["role"];

/** Why an image part did not reach the model as an image. */
export type DegradeReason =
  /** The provider declares no image input at all. */
  | "provider-no-image-input"
  /** The resolved model capability says the model has no vision. */
  | "model-no-image-input"
  /** The provider accepts inline base64 images only, and the source is a URL. */
  | "url-image-unsupported"
  /** The provider's wire format has no image slot for this message role. */
  | "role-no-image-input";

/** One degraded part: what it was and why it became a stub. Never raw bytes. */
export interface DegradedPart {
  readonly partType: "image";
  readonly mediaType: string;
  /** Decoded size for base64 sources; undefined for URL sources. */
  readonly bytes: number | undefined;
  readonly role: MessageRole;
  readonly reason: DegradeReason;
}

/** Per-request image admission, from provider declaration plus model capability. */
export interface ContentPolicy {
  /** Set when images are blocked for the whole request; undefined when allowed. */
  readonly imageBlocked: "provider-no-image-input" | "model-no-image-input" | undefined;
}

/** Policy that admits images (used where a mapper is called without a request context). */
export const IMAGES_ALLOWED: ContentPolicy = { imageBlocked: undefined };

/**
 * Resolve the per-request content policy.
 *
 * The provider must declare `"image"` in its input modalities. The model gate
 * applies only when the capability row is authoritative (`probe` or
 * `static-table`); a fallback, inferred or user-supplied row carries a guessed
 * `supportsVision`, so the image is sent and a real refusal surfaces as a
 * provider error rather than a stub built on a guess.
 *
 * @param declared — the provider's declared input modalities (absent = text only)
 * @param cap — the resolved model capability, when available
 */
export const resolveContentPolicy = (
  declared: readonly InputModality[] | undefined,
  cap?: Pick<Capability, "supportsVision" | "source">,
): ContentPolicy => {
  if (!(declared ?? []).includes("image")) return { imageBlocked: "provider-no-image-input" };
  const authoritative = cap !== undefined && (cap.source === "probe" || cap.source === "static-table");
  if (authoritative && !cap.supportsVision) return { imageBlocked: "model-no-image-input" };
  return IMAGES_ALLOWED;
};

/** What a provider's wire format can carry for images. */
export interface ImageWireRules {
  /** True when URL sources can be sent as-is (OpenAI `image_url`). */
  readonly url: boolean;
  /** Roles whose wire message has an image slot. */
  readonly roles: readonly MessageRole[];
}

/** The fate of one image part at a provider boundary. */
export type ImageRoute =
  | { readonly kind: "send"; readonly source: ImageSource }
  | { readonly kind: "stub"; readonly text: string; readonly degraded: DegradedPart };

const REASON_TEXT: Record<Exclude<DegradeReason, "role-no-image-input">, string> = {
  "provider-no-image-input": "provider has no image input",
  "model-no-image-input": "model has no image input",
  "url-image-unsupported": "provider accepts inline base64 images only",
};

/**
 * Deterministic text stub for a degraded part, e.g.
 * `[image omitted: image/png, 41 KB; model has no image input]`.
 *
 * @param d — the degraded part
 */
export const degradedStub = (d: DegradedPart): string =>
  mediaLabel(
    { kind: d.partType, mediaType: d.mediaType, bytes: d.bytes },
    d.reason === "role-no-image-input" ? `provider has no image input in ${d.role} messages` : REASON_TEXT[d.reason],
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

/** A text or image block after routing: images that cannot be sent are already text stubs. */
export type ResolvedPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly source: ImageSource };

/**
 * Route the text and image blocks of one message. Text passes through in
 * order; each image is either kept or replaced in place by its stub. Other
 * block kinds (tool_use, tool_result) are skipped: adapters map those
 * themselves.
 *
 * @param blocks — the message's content blocks
 * @param role — the message role
 * @param policy — the per-request policy
 * @param rules — the provider's image wire rules
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
    if (b.type === "text") parts.push({ kind: "text", text: b.text });
    else if (b.type === "image") {
      const route = routeImage(b.source, role, policy, rules);
      if (route.kind === "send") parts.push({ kind: "image", source: route.source });
      else {
        parts.push({ kind: "text", text: route.text });
        degraded.push(route.degraded);
      }
    }
  }
  return { parts, degraded };
};

/**
 * Join the text of routed parts with `""` (the flattening rule of
 * `messageContentToString`). Image parts contribute nothing; callers that
 * flatten route with rules that stub every image first.
 *
 * @param parts — routed parts
 */
export const joinText = (parts: readonly ResolvedPart[]): string =>
  parts.map((p) => (p.kind === "text" ? p.text : "")).join("");

/** Rules for a wire slot that carries text only: every image becomes a stub. */
export const TEXT_ONLY_RULES: ImageWireRules = { url: false, roles: [] };

/**
 * Stable trace/replay placeholder for a media part:
 * `[image:<media_type>:<sha256-12>]`, hashed over the source data (base64
 * payload or URL). Two requests differing only in an image get different keys.
 *
 * The hash is core's `sha256Hex` over `data`, the same input and function
 * `summarizeMediaSource` uses for `ContentPartSummary.sha256` in traces, so
 * the 12-char prefix matches the summary.
 *
 * @param kind — the part kind
 * @param source — the media source
 */
export const mediaPlaceholder = (kind: "image", source: Pick<MediaSource, "media_type" | "data">): string =>
  `[${kind}:${source.media_type}:${sha256Hex(source.data).slice(0, 12)}]`;

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
