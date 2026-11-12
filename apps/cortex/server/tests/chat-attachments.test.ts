// Run: bun run repo test apps/cortex/server/tests/chat-attachments.test.ts
//
// A chat turn's input from the composer: text-only stays a plain string; pictures and
// audio become typed parts; text files and tagged workspace files are bounded context
// with a visible cut note; caps, MIME allowlist and the model's input capabilities
// refuse before a run starts. The turn stores metadata, never bytes.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { join } from "node:path";
import { ATTACHMENT_CAPS } from "@reactive-agents/ui-core";
import { openDatabase } from "../db/schema.js";
import { getChatTurns } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { base64Bytes, buildTurnInput, inputCapabilitiesOf } from "../services/chat-attachments.js";
import { readStoredAttachments } from "../services/chat-turn-trace.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
let root = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cortex-attach-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "big.md"), "y".repeat(300_000));
  writeFileSync(join(root, ".env"), "SECRET=1");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const base = { provider: "test", model: "test-model", workspaceRoot: undefined as string | undefined };

describe("buildTurnInput", () => {
  it("no attachments: the message string, untouched", () => {
    expect(buildTurnInput({ ...base, message: "hi" })).toEqual({ ok: true, input: "hi", meta: [], hasMedia: false });
  });

  it("an image becomes an image part after the text part", () => {
    const r = buildTurnInput({ ...base, message: "what is this", attachments: { uploads: [{ name: "p.png", mediaType: "image/png", dataBase64: PNG }] } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hasMedia).toBe(true);
    expect(r.input).toEqual([
      { type: "text", text: "what is this" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
    ]);
    expect(r.meta).toEqual([{ kind: "image", name: "p.png", mediaType: "image/png", bytes: 8 }]);
  });

  it("audio becomes an audio part", () => {
    const r = buildTurnInput({ ...base, message: "transcribe", attachments: { uploads: [{ name: "a.wav", mediaType: "audio/wav", dataBase64: PNG }] } });
    expect(r.ok && Array.isArray(r.input) && r.input[1]).toEqual({ type: "audio", source: { type: "base64", media_type: "audio/wav", data: PNG } });
  });

  it("a text upload is inlined into the prompt, a plain string", () => {
    const data = Buffer.from("hello file").toString("base64");
    const r = buildTurnInput({ ...base, message: "read", attachments: { uploads: [{ name: "n.txt", mediaType: "text/plain", dataBase64: data }] } });
    expect(r.ok && r.input).toContain("[File: n.txt (10 B)]");
    expect(r.ok && r.hasMedia).toBe(false);
  });

  it("a binary upload labelled text is refused", () => {
    const data = Buffer.from([0, 1, 2, 3, 0, 0]).toString("base64");
    const r = buildTurnInput({ ...base, message: "x", attachments: { uploads: [{ name: "n.txt", mediaType: "text/plain", dataBase64: data }] } });
    expect(r).toMatchObject({ ok: false, code: "unsupported-type" });
  });

  it("tagged workspace files are inlined with a visible N KB of M KB note when cut", () => {
    const r = buildTurnInput({ ...base, workspaceRoot: root, message: "review", attachments: { files: ["src/a.ts", "big.md"] } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = r.input as string;
    expect(text).toContain("[File: src/a.ts (20 B)]");
    expect(text).toContain("(64 KB of 293 KB, cut)");
    expect(r.meta[1]).toMatchObject({ kind: "workspace-file", path: "big.md", bytes: 300_000, shownBytes: 65_536 });
  });

  it("tagged files need a workspace and never leave it", () => {
    expect(buildTurnInput({ ...base, message: "x", attachments: { files: ["src/a.ts"] } })).toMatchObject({ ok: false, code: "no-workspace" });
    for (const f of ["../../etc/passwd", "/etc/passwd", ".env"]) {
      expect(buildTurnInput({ ...base, workspaceRoot: root, message: "x", attachments: { files: [f] } })).toMatchObject({ ok: false, status: 400, code: "bad-file" });
    }
  });

  it("caps: count, size per kind, type allowlist, bad base64", () => {
    const many = Array.from({ length: ATTACHMENT_CAPS.count + 1 }, (_, i) => ({ name: `f${i}.txt`, mediaType: "text/plain", dataBase64: "YQ==" }));
    expect(buildTurnInput({ ...base, message: "x", attachments: { uploads: many } })).toMatchObject({ ok: false, code: "too-many" });
    const bigImage = "A".repeat(Math.ceil(((ATTACHMENT_CAPS.imageBytes + 10) * 4) / 3 / 4) * 4);
    expect(buildTurnInput({ ...base, message: "x", attachments: { uploads: [{ name: "p.png", mediaType: "image/png", dataBase64: bigImage }] } })).toMatchObject({ ok: false, status: 413, code: "too-large" });
    expect(buildTurnInput({ ...base, message: "x", attachments: { uploads: [{ name: "a.exe", mediaType: "application/x-msdownload", dataBase64: "YQ==" }] } })).toMatchObject({ ok: false, code: "unsupported-type" });
    expect(buildTurnInput({ ...base, message: "x", attachments: { uploads: [{ name: "a.txt", mediaType: "text/plain", dataBase64: "not base64!" }] } })).toMatchObject({ ok: false, code: "bad-data" });
  });

  it("an authoritative no-vision model refuses a picture with the typed modality reason", () => {
    // qwen3:4b is in the framework's static capability table as text-only.
    const caps = inputCapabilitiesOf("ollama", "qwen3:4b");
    expect(caps?.vision).toBe(false);
    expect(caps?.authoritative).toBe(true);
    const r = buildTurnInput({ message: "x", provider: "ollama", model: "qwen3:4b", attachments: { uploads: [{ name: "p.png", mediaType: "image/png", dataBase64: PNG }] } });
    expect(r).toMatchObject({ ok: false, status: 422, code: "unsupported-modality", partType: "image" });
    expect(!r.ok && r.error).toContain("qwen3:4b does not accept pictures");
    // The same model still takes text files.
    expect(buildTurnInput({ message: "x", provider: "ollama", model: "qwen3:4b", attachments: { uploads: [{ name: "a.txt", mediaType: "text/plain", dataBase64: "YQ==" }] } }).ok).toBe(true);
    // A model whose capability is only a guess lets the picture through (the provider decides).
    expect(buildTurnInput({ message: "x", provider: "ollama", model: "llama3.1", attachments: { uploads: [{ name: "p.png", mediaType: "image/png", dataBase64: PNG }] } }).ok).toBe(true);
  });

  it("base64Bytes is the decoded size", () => {
    expect(base64Bytes("YQ==")).toBe(1);
    expect(base64Bytes(PNG)).toBe(8);
  });
});

describe("the attachments reach the session and are stored as metadata", () => {
  it("chatStream hands the session the parts, stores names and sizes on the user row, never bytes", async () => {
    const path = tmpDbPath("chat-attach");
    const db = openDatabase(path);
    const svc = new ChatSessionService(db, { title: async () => "" });
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      await svc.chat(id, "warm");
      const entry = (svc as unknown as { sessions: Map<string, { session: { runStream: unknown } }> }).sessions.get(id)!;
      let received: unknown;
      entry.session.runStream = async function* (input: unknown) {
        received = input;
        yield { _tag: "TextDelta", text: "ok" };
        yield { _tag: "StreamCompleted", output: "ok", metadata: { tokensUsed: 1 }, taskId: "r1" };
      };
      const built = buildTurnInput({ ...base, message: "look", attachments: { uploads: [{ name: "p.png", mediaType: "image/png", dataBase64: PNG }] } });
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      for await (const _ of svc.chatStream(id, "look", undefined, undefined, { input: built.input, attachments: built.meta })) {
        /* drain */
      }
      expect(received).toEqual(built.input);
      const turns = getChatTurns(db, id);
      const user = turns.filter((t) => t.role === "user").at(-1)!;
      expect(user.content).toBe("look");
      expect(user.trace?.attachments).toEqual([{ kind: "image", name: "p.png", mediaType: "image/png", bytes: 8 }]);
      expect(JSON.stringify(user)).not.toContain(PNG);
      // A turn without attachments stores none.
      expect(turns.filter((t) => t.role === "user")[0]!.trace?.attachments).toBeUndefined();
      await svc.disposeAll();
    } finally {
      db.close();
      rmDbFiles(path);
    }
  });

  it("stored attachment metadata reads back well-formed entries only", () => {
    expect(readStoredAttachments([{ kind: "text", name: "a", bytes: 1 }, { kind: "bogus", name: "b", bytes: 1 }, null, { kind: "image", name: "c" }])).toEqual([{ kind: "text", name: "a", bytes: 1 }]);
    expect(readStoredAttachments("x")).toBeUndefined();
  });
});
