/**
 * Composer attachments: which files a chat accepts, how big, and whether the
 * chosen model can take them. Pure; a server enforces it and a UI previews it
 * with the same rules, so a refusal reads the same on both sides.
 */

/** What an attachment becomes in the turn. */
export type AttachmentKind = "image" | "audio" | "text";

/** Size and count limits. */
export const ATTACHMENT_CAPS = {
  /** Image bytes. */
  imageBytes: 10 * 1024 * 1024,
  /** Audio bytes. */
  audioBytes: 25 * 1024 * 1024,
  /** A text file is inlined whole up to this many bytes (an upload over it is refused). */
  fileBytes: 1024 * 1024,
  /** Attachments (files, pictures, tagged workspace files) on one message. */
  count: 8,
  /** Bytes of one text file placed in the prompt; more is cut with a visible note. */
  inlineBytes: 64 * 1024,
  /** Bytes of text placed in one prompt across every inlined file. */
  inlineTotalBytes: 192 * 1024,
} as const;

/** Image MIME types accepted. */
export const IMAGE_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** Audio MIME types accepted. */
export const AUDIO_MIME_TYPES: readonly string[] = [
  "audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/ogg", "audio/webm", "audio/flac", "audio/aac",
];
/** Extensions of files read as text (when the MIME type is generic or empty). */
export const TEXT_EXTENSIONS: readonly string[] = [
  "txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "yaml", "yml", "toml", "xml", "html", "css", "log", "ini", "env.example",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "cs", "sh", "sql", "svelte", "vue", "diff", "patch",
];

const EXT_MIME: Readonly<Record<string, string>> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac", webm: "audio/webm",
};

const extensionOf = (name: string): string => {
  const base = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1) : "";
};

/** A file offered for attaching. */
export interface AttachmentCandidate {
  readonly name: string;
  /** Browser-reported MIME type; may be empty. */
  readonly mediaType: string;
  readonly bytes: number;
}

/** Result of {@link classifyAttachment}. */
export type AttachmentClass =
  | { readonly ok: true; readonly kind: AttachmentKind; readonly mediaType: string }
  | { readonly ok: false; readonly reason: string };

/** Human size: `812 B`, `12 KB`, `1.4 MB`. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Decide what a file is and whether it is allowed: MIME allowlist (the
 * extension decides when the browser gave no useful type) and the size cap of
 * its kind. A refusal names the reason in words a user can act on.
 */
export function classifyAttachment(file: AttachmentCandidate): AttachmentClass {
  const ext = extensionOf(file.name);
  const given = file.mediaType.toLowerCase().split(";")[0]!.trim();
  const mediaType = given === "" || given === "application/octet-stream" ? (EXT_MIME[ext] ?? given) : given;
  if (IMAGE_MIME_TYPES.includes(mediaType)) {
    return file.bytes > ATTACHMENT_CAPS.imageBytes
      ? { ok: false, reason: `${file.name} is ${formatBytes(file.bytes)}; pictures can be up to ${formatBytes(ATTACHMENT_CAPS.imageBytes)}` }
      : { ok: true, kind: "image", mediaType };
  }
  if (AUDIO_MIME_TYPES.includes(mediaType)) {
    return file.bytes > ATTACHMENT_CAPS.audioBytes
      ? { ok: false, reason: `${file.name} is ${formatBytes(file.bytes)}; audio can be up to ${formatBytes(ATTACHMENT_CAPS.audioBytes)}` }
      : { ok: true, kind: "audio", mediaType };
  }
  const textual =
    mediaType.startsWith("text/") ||
    ["application/json", "application/xml", "application/x-yaml", "application/yaml", "application/toml"].includes(mediaType) ||
    TEXT_EXTENSIONS.includes(ext);
  if (textual) {
    return file.bytes > ATTACHMENT_CAPS.fileBytes
      ? { ok: false, reason: `${file.name} is ${formatBytes(file.bytes)}; text files can be up to ${formatBytes(ATTACHMENT_CAPS.fileBytes)}` }
      : { ok: true, kind: "text", mediaType: mediaType.startsWith("text/") || mediaType.includes("json") ? mediaType : "text/plain" };
  }
  return { ok: false, reason: `${file.name}: ${mediaType === "" ? "unknown file type" : mediaType} is not supported (pictures, audio and text files are)` };
}

/** What a model accepts as input (the runtime's `modelInputCapabilities`). */
export interface InputCapabilitiesLike {
  readonly vision: boolean;
  readonly audioIn?: boolean;
  /** True when the answer comes from a probe or the static table, not a guess. */
  readonly authoritative: boolean;
}

/** Whether a kind may be attached for a model. */
export interface AttachmentGate {
  readonly allowed: boolean;
  /** Why not, for a tooltip or message. */
  readonly reason?: string;
}

/**
 * Gate one kind against a model's input capabilities, with the runtime's own
 * rule: an image is refused for an authoritative no-vision model, audio for an
 * authoritative model whose `audioIn` is explicitly false. A guessed capability
 * lets the part through (the provider decides). Text is always allowed. With no
 * capabilities (model not known yet) everything is allowed.
 */
export function gateAttachmentKind(kind: AttachmentKind, caps: InputCapabilitiesLike | undefined, model = "this model"): AttachmentGate {
  if (caps === undefined || kind === "text" || !caps.authoritative) return { allowed: true };
  if (kind === "image" && !caps.vision) return { allowed: false, reason: `${model} does not accept pictures. Pick a vision model to attach images.` };
  if (kind === "audio" && caps.audioIn === false) return { allowed: false, reason: `${model} does not accept audio. Pick an audio-capable model to attach audio.` };
  return { allowed: true };
}

/** The `UnsupportedModalityError` a server reports, in words for the transcript. */
export function modalityMessage(partType: string, model: string): string {
  const what = partType === "image" ? "pictures" : partType === "audio" ? "audio" : `${partType} input`;
  return `${model || "This model"} does not accept ${what}. Remove the attachment or switch to a model that does.`;
}

/** Cut `text` to at most `maxBytes` UTF-8 bytes on a character boundary. */
export function cutToBytes(text: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= maxBytes) return { text, truncated: false };
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (enc.encode(text.slice(0, mid)).length <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return { text: text.slice(0, lo), truncated: true };
}

/**
 * A text file as prompt context: a header naming the file and, when cut, "N KB
 * of M KB" so neither the agent nor the user mistakes a cut file for the whole.
 */
export function fileContextBlock(name: string, text: string, totalBytes: number, shownBytes: number): string {
  const note = shownBytes < totalBytes ? ` (${formatBytes(shownBytes)} of ${formatBytes(totalBytes)}, cut)` : ` (${formatBytes(totalBytes)})`;
  return `[File: ${name}${note}]\n\`\`\`\n${text}\n\`\`\``;
}

/** What a transcript keeps about an attachment: never its bytes. */
export interface AttachmentMeta {
  readonly kind: AttachmentKind | "workspace-file";
  readonly name: string;
  readonly mediaType?: string;
  readonly bytes: number;
  /** Workspace-relative path for a tagged file. */
  readonly path?: string;
  /** Bytes placed in the prompt when the file was cut. */
  readonly shownBytes?: number;
}
