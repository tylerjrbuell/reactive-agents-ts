import { t } from "elysia";
import { ATTACHMENT_CAPS } from "@reactive-agents/ui-core";

/**
 * Longest base64 string an upload may carry: the largest per-kind byte cap, 4 chars per
 * 3 bytes (plus padding). Enforced by the route schema, so an oversized body is refused
 * at validation (422) instead of after it has been parsed and copied.
 */
export const UPLOAD_BASE64_MAX = Math.ceil((Math.max(ATTACHMENT_CAPS.imageBytes, ATTACHMENT_CAPS.audioBytes, ATTACHMENT_CAPS.fileBytes) * 4) / 3) + 4;

/** `attachments` of `POST /api/chat/sessions/:id/chat/stream`; `buildTurnInput` still applies the per-kind rules. */
export const attachmentsSchema = t.Object({
  uploads: t.Optional(
    t.Array(t.Object({ name: t.String({ maxLength: 255 }), mediaType: t.String({ maxLength: 255 }), dataBase64: t.String({ maxLength: UPLOAD_BASE64_MAX }) }), {
      maxItems: ATTACHMENT_CAPS.count,
    }),
  ),
  files: t.Optional(t.Array(t.String({ maxLength: 4096 }), { maxItems: ATTACHMENT_CAPS.count })),
});
