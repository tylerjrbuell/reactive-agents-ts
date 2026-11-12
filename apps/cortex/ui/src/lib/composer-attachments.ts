/**
 * What the chat composer holds besides text: pictures, audio, text files and tagged
 * workspace files, each a removable chip until the message is sent. The rules (kinds,
 * caps, model gating) are ui-core's, the same ones the server enforces. Pure; the
 * controller and components wire it.
 */
import {
  ATTACHMENT_CAPS,
  classifyAttachment,
  gateAttachmentKind,
  type AttachmentKind,
  type AttachmentMeta,
  type InputCapabilitiesLike,
} from "@reactive-agents/ui-core";

/** One chip in the composer. */
export interface DraftAttachment {
  readonly id: string;
  readonly kind: AttachmentKind | "workspace-file";
  readonly name: string;
  readonly bytes: number;
  readonly mediaType?: string;
  /** Workspace-relative path (a tagged file). */
  readonly path?: string;
  /** Uploaded bytes, base64 (pictures, audio, text files). */
  readonly dataBase64?: string;
  /** Data URL for a picture thumbnail. */
  readonly thumb?: string;
}

/** Outcome of offering a file to the composer. */
export type Admission =
  | { readonly ok: true; readonly kind: AttachmentKind; readonly mediaType: string }
  | { readonly ok: false; readonly reason: string };

/** Whether another attachment fits, and if not, why. */
export function countRefusal(items: readonly DraftAttachment[]): string | null {
  return items.length >= ATTACHMENT_CAPS.count ? `At most ${ATTACHMENT_CAPS.count} attachments per message` : null;
}

/**
 * Admit (or refuse) one file for the composer: count cap, MIME allowlist, size cap of
 * its kind, then the model's input capabilities. The refusal text is for a toast.
 */
export function admit(
  items: readonly DraftAttachment[],
  file: { readonly name: string; readonly mediaType: string; readonly bytes: number },
  caps: InputCapabilitiesLike | undefined,
  model: string,
): Admission {
  const full = countRefusal(items);
  if (full) return { ok: false, reason: full };
  const c = classifyAttachment(file);
  if (!c.ok) return { ok: false, reason: c.reason };
  const gate = gateAttachmentKind(c.kind, caps, model || "this model");
  if (!gate.allowed) return { ok: false, reason: gate.reason ?? "This model cannot take that kind of file" };
  if (items.some((i) => i.kind !== "workspace-file" && i.name === file.name && i.bytes === file.bytes)) {
    return { ok: false, reason: `${file.name} is already attached` };
  }
  return { ok: true, kind: c.kind, mediaType: c.mediaType };
}

/** Add a tagged workspace file; the same path twice is one chip. */
export function addTagged(items: readonly DraftAttachment[], file: { readonly path: string; readonly bytes: number }, id: string): { readonly items: readonly DraftAttachment[]; readonly error?: string } {
  if (items.some((i) => i.kind === "workspace-file" && i.path === file.path)) return { items };
  const full = countRefusal(items);
  if (full) return { items, error: full };
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  return { items: [...items, { id, kind: "workspace-file", name, path: file.path, bytes: file.bytes }] };
}

/** The `attachments` part of the stream request, or undefined when nothing is attached. */
export function requestOf(items: readonly DraftAttachment[]): { readonly uploads?: readonly { name: string; mediaType: string; dataBase64: string }[]; readonly files?: readonly string[] } | undefined {
  const uploads = items.flatMap((i) => (i.kind !== "workspace-file" && i.dataBase64 !== undefined ? [{ name: i.name, mediaType: i.mediaType ?? "application/octet-stream", dataBase64: i.dataBase64 }] : []));
  const files = items.flatMap((i) => (i.kind === "workspace-file" && i.path !== undefined ? [i.path] : []));
  if (uploads.length === 0 && files.length === 0) return undefined;
  return { ...(uploads.length > 0 ? { uploads } : {}), ...(files.length > 0 ? { files } : {}) };
}

/** What the transcript keeps about the chips: no bytes. */
export function metaOf(items: readonly DraftAttachment[]): readonly AttachmentMeta[] {
  return items.map((i) => ({
    kind: i.kind,
    name: i.name,
    bytes: i.bytes,
    ...(i.mediaType ? { mediaType: i.mediaType } : {}),
    ...(i.path ? { path: i.path } : {}),
  }));
}

/** Base64 of bytes, in chunks (a large picture must not blow the call stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** The `accept` list of a picker for one kind. */
export function acceptFor(kind: AttachmentKind): string {
  return kind === "image" ? "image/png,image/jpeg,image/gif,image/webp" : kind === "audio" ? "audio/*" : "text/*,.md,.json,.csv,.ts,.tsx,.js,.py,.yaml,.yml,.toml,.xml,.log,.sh,.sql";
}
