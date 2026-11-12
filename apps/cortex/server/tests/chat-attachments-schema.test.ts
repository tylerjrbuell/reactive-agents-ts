import { describe, expect, it } from "bun:test";
import { Elysia, t } from "elysia";
import { ATTACHMENT_CAPS } from "@reactive-agents/ui-core";
import { attachmentsSchema, UPLOAD_BASE64_MAX } from "../api/chat-attachments-schema.js";

const app = new Elysia().post("/x", () => "ok", { body: t.Object({ message: t.String(), attachments: t.Optional(attachmentsSchema) }) });
const post = (attachments: unknown) =>
  app.handle(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "m", attachments }) }));
const upload = { name: "a.txt", mediaType: "text/plain", dataBase64: "aGk=" };

describe("chat attachments schema limits", () => {
  it("accepts a normal set", async () => {
    expect((await post({ uploads: [upload], files: ["src/a.ts"] })).status).toBe(200);
  });

  it("refuses too many uploads or files at the schema", async () => {
    expect((await post({ uploads: Array.from({ length: ATTACHMENT_CAPS.count + 1 }, () => upload) })).status).toBe(422);
    expect((await post({ files: Array.from({ length: ATTACHMENT_CAPS.count + 1 }, () => "a.ts") })).status).toBe(422);
  });

  it("refuses an oversized base64 payload, name, media type or path at the schema", async () => {
    expect((await post({ uploads: [{ ...upload, dataBase64: "A".repeat(UPLOAD_BASE64_MAX + 1) }] })).status).toBe(422);
    expect((await post({ uploads: [{ ...upload, name: "n".repeat(256) }] })).status).toBe(422);
    expect((await post({ uploads: [{ ...upload, mediaType: "m".repeat(256) }] })).status).toBe(422);
    expect((await post({ files: ["p".repeat(4097)] })).status).toBe(422);
  });

  it("still takes the largest allowed upload (25 MB audio)", () => {
    expect(UPLOAD_BASE64_MAX).toBeGreaterThanOrEqual(Math.ceil((ATTACHMENT_CAPS.audioBytes * 4) / 3));
  });
});
