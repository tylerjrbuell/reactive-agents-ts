import { describe, expect, test } from "bun:test";
import { fetchInputCapabilities, previewSessionFile, searchSessionFiles } from "./chat-files.js";

const json = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("chat files client", () => {
  test("search returns the server's hits, an empty result when it fails", async () => {
    const hits = { workspace: "/w", files: [{ path: "a.ts", bytes: 3, indices: [0] }], truncated: false };
    expect(await searchSessionFiles("", "s1", "a", undefined, json(hits))).toEqual(hits);
    expect(await searchSessionFiles("", "s1", "a", undefined, json({ error: "x" }, 404))).toEqual({ workspace: null, files: [], truncated: false });
  });

  test("the query and session id are encoded", async () => {
    let url = "";
    const f = (async (u: string) => ((url = u), new Response("{}"))) as unknown as typeof fetch;
    await searchSessionFiles("http://h", "a b", "x/y z", undefined, f);
    expect(url).toBe("http://h/api/chat/sessions/a%20b/files?q=x%2Fy%20z&limit=30");
  });

  test("preview passes the server's reason on a refusal", async () => {
    expect(await previewSessionFile("", "s", "../x", json({ error: "That path is outside the workspace" }, 400))).toEqual({ ok: false, error: "That path is outside the workspace" });
    const ok = { path: "a", text: "t", totalBytes: 1, shownBytes: 1, truncated: false };
    expect(await previewSessionFile("", "s", "a", json(ok))).toEqual({ ok: true, preview: ok });
  });

  test("capabilities map to ui-core's shape; unknown model is undefined", async () => {
    expect(await fetchInputCapabilities("", "s", json({ capabilities: { vision: false, audioIn: null, authoritative: true } }))).toEqual({ vision: false, authoritative: true });
    expect(await fetchInputCapabilities("", "s", json({ capabilities: { vision: true, audioIn: false, authoritative: true } }))).toEqual({ vision: true, audioIn: false, authoritative: true });
    expect(await fetchInputCapabilities("", "s", json({ capabilities: null }))).toBeUndefined();
  });
});
