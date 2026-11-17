/**
 * Builds a chat turn's input from the composer: the typed message, uploaded
 * pictures / audio / text files, and tagged workspace files.
 *
 * Uploaded text files are placed in the prompt as bounded context with a visible
 * "N KB of M KB" note when cut; a tagged workspace file is a pointer (path, size, how
 * to read it) unless tiny, see `chat-file-pointer.ts`; pictures and audio become
 * typed content parts for the model. The model's input capabilities are checked
 * first, so an unsupported kind is refused with a plain message before any run
 * starts (the runtime's `UnsupportedModalityError` is the backstop). Tagged files
 * never leave the session's workspace root (`workspace-files.ts`).
 *
 * The turn stores {@link AttachmentMeta} (name, kind, size), never bytes.
 */
import { modelInputCapabilities, type TaskInput } from "@reactive-agents/runtime";
import type { ContentPart } from "@reactive-agents/core";
import {
  ATTACHMENT_CAPS,
  classifyAttachment,
  cutToBytes,
  fileContextBlock,
  gateAttachmentKind,
  modalityMessage,
  type AttachmentKind,
  type AttachmentMeta,
} from "@reactive-agents/ui-core";
import { looksBinary, readWorkspaceText } from "./workspace-files.js";
import { POINTER_INLINE_MAX_BYTES, workspaceFileBlock } from "./chat-file-pointer.js";

/** One file uploaded from the composer (base64, no data-URL prefix). */
export interface AttachmentUpload {
  readonly name: string;
  readonly mediaType: string;
  readonly dataBase64: string;
}

/** The attachment part of a chat-stream request. */
export interface TurnAttachments {
  readonly uploads?: readonly AttachmentUpload[];
  /** Workspace-relative paths of tagged files. */
  readonly files?: readonly string[];
}

/** Why a turn input was refused. */
export type AttachmentRefusalCode =
  | "too-many"
  | "unsupported-type"
  | "too-large"
  | "bad-data"
  | "no-workspace"
  | "bad-file"
  | "unsupported-modality";

export type BuiltTurnInput =
  | { readonly ok: true; readonly input: TaskInput; readonly meta: readonly AttachmentMeta[]; readonly hasMedia: boolean }
  | {
      readonly ok: false;
      /** 400 bad request, 413 too large, 422 model cannot take it. */
      readonly status: 400 | 413 | 422;
      readonly code: AttachmentRefusalCode;
      readonly error: string;
      /** `image` / `audio` when `code` is `unsupported-modality`. */
      readonly partType?: string;
    };

const refuse = (status: 400 | 413 | 422, code: AttachmentRefusalCode, error: string, partType?: string): BuiltTurnInput => ({
  ok: false,
  status,
  code,
  error,
  ...(partType !== undefined ? { partType } : {}),
});

/** Decoded size of a base64 string without decoding it. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** What `GET /api/chat/sessions/:id/input-capabilities` reports for the session's model. */
export interface SessionInputCapabilities {
  readonly provider: string;
  readonly model: string;
  readonly vision: boolean;
  readonly audioIn: boolean | null;
  readonly authoritative: boolean;
}

/** The model's input capabilities, `null` when the provider or model is not set. */
export function inputCapabilitiesOf(provider: string, model: string): SessionInputCapabilities | null {
  if (provider === "" || model === "") return null;
  const c = modelInputCapabilities(provider, model);
  return { provider, model, vision: c.vision, audioIn: c.audioIn ?? null, authoritative: c.authoritative };
}

/**
 * Turn the composer's message and attachments into the run input. Text-only (no
 * picture or audio) stays a plain string, so text turns are byte-identical to
 * before. `workspaceRoot` is the session workspace, needed only for tagged files.
 */
export function buildTurnInput(args: {
  readonly message: string;
  readonly attachments?: TurnAttachments | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly provider: string;
  readonly model: string;
}): BuiltTurnInput {
  const uploads = args.attachments?.uploads ?? [];
  const files = args.attachments?.files ?? [];
  if (uploads.length === 0 && files.length === 0) return { ok: true, input: args.message, meta: [], hasMedia: false };
  if (uploads.length + files.length > ATTACHMENT_CAPS.count) {
    return refuse(400, "too-many", `At most ${ATTACHMENT_CAPS.count} attachments per message`);
  }
  if (files.length > 0 && (args.workspaceRoot === undefined || args.workspaceRoot === "")) {
    return refuse(400, "no-workspace", "Tagging files needs a workspace: set one for this chat first");
  }
  const caps = modelInputCapabilitiesOrUndefined(args.provider, args.model);
  const meta: AttachmentMeta[] = [];
  const media: ContentPart[] = [];
  const blocks: string[] = [];
  let inlined = 0;
  const budgetFor = (): number => Math.max(0, Math.min(ATTACHMENT_CAPS.inlineBytes, ATTACHMENT_CAPS.inlineTotalBytes - inlined));

  // A tagged file is a pointer, or inline when tiny (chat-file-pointer.ts); the read keeps the confinement,
  // secret and binary refusals. Only the inlined bytes count against the prompt budget.
  for (const f of files) {
    const read = readWorkspaceText(args.workspaceRoot ?? "", f, POINTER_INLINE_MAX_BYTES);
    if (!read.ok) return refuse(400, "bad-file", `${f}: ${read.error}`);
    if (read.totalBytes <= POINTER_INLINE_MAX_BYTES) inlined += read.shownBytes;
    blocks.push(workspaceFileBlock({ path: read.path, totalBytes: read.totalBytes, text: read.text }));
    meta.push({ kind: "workspace-file", name: read.path.slice(read.path.lastIndexOf("/") + 1), path: read.path, bytes: read.totalBytes });
  }

  for (const u of uploads) {
    if (!BASE64.test(u.dataBase64)) return refuse(400, "bad-data", `${u.name}: the file data is not valid base64`);
    const bytes = base64Bytes(u.dataBase64);
    const c = classifyAttachment({ name: u.name, mediaType: u.mediaType, bytes });
    if (!c.ok) return refuse(c.reason.includes("not supported") ? 400 : 413, c.reason.includes("not supported") ? "unsupported-type" : "too-large", c.reason);
    const gate = gateAttachmentKind(c.kind, caps, args.model);
    if (!gate.allowed) return refuse(422, "unsupported-modality", modalityMessage(c.kind, args.model), c.kind);
    if (c.kind === "image" || c.kind === "audio") {
      media.push(mediaPart(c.kind, c.mediaType, u.dataBase64));
      meta.push({ kind: c.kind, name: u.name, mediaType: c.mediaType, bytes });
    } else {
      const raw = new Uint8Array(Buffer.from(u.dataBase64, "base64"));
      if (looksBinary(raw.subarray(0, 8192))) return refuse(400, "unsupported-type", `${u.name} is a binary file; only text files can be attached`);
      const text = new TextDecoder("utf-8", { fatal: false }).decode(raw);
      const cut = cutToBytes(text, budgetFor());
      const shown = new TextEncoder().encode(cut.text).length;
      inlined += shown;
      blocks.push(fileContextBlock(u.name, cut.text, bytes, shown));
      meta.push({ kind: "text", name: u.name, mediaType: c.mediaType, bytes, ...(cut.truncated ? { shownBytes: shown } : {}) });
    }
  }

  const text = blocks.length > 0 ? `${args.message}\n\n${blocks.join("\n\n")}` : args.message;
  if (media.length === 0) return { ok: true, input: text, meta, hasMedia: false };
  return { ok: true, input: [{ type: "text", text }, ...media], meta, hasMedia: true };
}

function mediaPart(kind: AttachmentKind, mediaType: string, data: string): ContentPart {
  const source = { type: "base64" as const, media_type: mediaType, data };
  return kind === "image" ? { type: "image", source } : { type: "audio", source };
}

function modelInputCapabilitiesOrUndefined(provider: string, model: string) {
  if (provider === "" || model === "") return undefined;
  const c = modelInputCapabilities(provider, model);
  return { vision: c.vision, ...(c.audioIn !== undefined ? { audioIn: c.audioIn } : {}), authoritative: c.authoritative };
}
