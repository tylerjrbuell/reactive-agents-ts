// Run: bun run repo test apps/cortex/server/tests/chat-files-api.test.ts
//
// The `@` picker routes and the attachment refusals, over HTTP: files are searched and
// previewed under the session workspace only; a traversal, a secret, a binary or a model
// that cannot take a picture is a plain 4xx before any run starts.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { join } from "node:path";
import { Elysia } from "elysia";
import { openDatabase } from "../db/schema.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { chatRouter } from "../api/chat.js";

let ws = "";
let dbPath = "";
let svc: ChatSessionService;
let app: { readonly handle: (request: Request) => Response | Promise<Response> };
type Files = { workspace: string | null; files: { path: string }[] };
const files = async (res: Response): Promise<Files> => (await res.json()) as Files;
let id = "";
let noWsId = "";
let textOnlyId = "";

const get = (path: string) => app.handle(new Request(`http://localhost/api/chat${path}`));
const post = (path: string, body: unknown) =>
  app.handle(new Request(`http://localhost/api/chat${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

beforeAll(async () => {
  ws = mkdtempSync(join(tmpdir(), "cortex-files-api-"));
  mkdirSync(join(ws, "src"));
  writeFileSync(join(ws, "src", "notes.md"), "# notes\n");
  writeFileSync(join(ws, ".env"), "SECRET=1");
  writeFileSync(join(ws, "blob.bin"), Buffer.from([0, 1, 0, 2]));
  dbPath = tmpDbPath("files-api");
  const db = openDatabase(dbPath);
  svc = new ChatSessionService(db, { title: async () => "" });
  app = new Elysia().use(chatRouter(svc));
  id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", workspace: ws } });
  noWsId = await svc.createSession({ agentConfig: { provider: "test", model: "test-model" } });
  textOnlyId = await svc.createSession({ agentConfig: { provider: "ollama", model: "qwen3:4b", workspace: ws } });
});

afterAll(async () => {
  await svc.disposeAll();
  rmSync(ws, { recursive: true, force: true });
  rmDbFiles(dbPath);
});

describe("GET /sessions/:id/files", () => {
  it("searches the workspace, never listing secrets", async () => {
    const r = await files(await get(`/sessions/${id}/files?q=notes`));
    expect(r.workspace).toBe(ws);
    expect(r.files[0]?.path).toBe("src/notes.md");
    const all = await files(await get(`/sessions/${id}/files`));
    expect(all.files.map((f) => f.path)).not.toContain(".env");
  });

  it("a chat with no workspace lists nothing; an unknown chat is 404", async () => {
    expect(await (await get(`/sessions/${noWsId}/files`)).json()).toEqual({ workspace: null, files: [], truncated: false });
    expect((await get(`/sessions/nope/files`)).status).toBe(404);
  });
});

describe("GET /sessions/:id/files/preview", () => {
  it("previews a text file", async () => {
    const r: unknown = await (await get(`/sessions/${id}/files/preview?path=src/notes.md`)).json();
    expect(r).toMatchObject({ ok: true, path: "src/notes.md", text: "# notes\n", truncated: false });
  });

  it("refuses traversal, absolute paths, secrets and binaries with a 4xx", async () => {
    for (const p of ["../../etc/passwd", "/etc/passwd", ".env", "blob.bin", "..%2F..%2Fetc%2Fpasswd"]) {
      const res = await get(`/sessions/${id}/files/preview?path=${p}`);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect((await get(`/sessions/${noWsId}/files/preview?path=a.md`)).status).toBe(400);
  });
});

describe("input capabilities and stream refusals", () => {
  it("reports the session model's input capabilities", async () => {
    const r = (await (await get(`/sessions/${textOnlyId}/input-capabilities`)).json()) as { capabilities: unknown };
    expect(r.capabilities).toMatchObject({ provider: "ollama", model: "qwen3:4b", vision: false, authoritative: true });
  });

  it("a picture for a text-only model is a 422 with the typed reason, before any run", async () => {
    const res = await post(`/sessions/${textOnlyId}/chat/stream`, { message: "see", attachments: { uploads: [{ name: "p.png", mediaType: "image/png", dataBase64: PNG }] } });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "unsupported-modality", partType: "image" });
  });

  it("a tagged traversal path is a 400 and starts nothing", async () => {
    const res = await post(`/sessions/${id}/chat/stream`, { message: "x", attachments: { files: ["../../etc/passwd"] } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "bad-file" });
  });
});
