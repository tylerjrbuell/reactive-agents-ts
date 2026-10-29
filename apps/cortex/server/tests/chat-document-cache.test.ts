import { describe, expect, it } from "bun:test";
import { SessionDocumentCache, type DocumentFetcher } from "../services/chat-document-cache.js";

describe("SessionDocumentCache", () => {
  const ok: DocumentFetcher = async () => ({ ok: true, content: "body", format: "markdown" });

  it("fetches a URL once per session across rebuilds and inlines the content", async () => {
    let n = 0;
    const c = new SessionDocumentCache(async (u) => {
      n++;
      return ok(u);
    });
    const spec = [{ source: "https://example.com/a" }];
    const first = await c.resolve("s1", spec);
    const second = await c.resolve("s1", spec);
    expect(n).toBe(1);
    expect(second).toEqual([{ source: "https://example.com/a", content: "body", format: "markdown" }]);
    expect(first).toEqual(second);
    await c.resolve("s2", spec);
    expect(n).toBe(2);
  });

  it("drops and records failures, then recovers on a later success", async () => {
    let good = false;
    const c = new SessionDocumentCache(async () => (good ? { ok: true, content: "x", format: "text" } : { ok: false, reason: "HTTP 500" }));
    const spec = [{ source: "https://example.com/a" }, { source: "inline", content: "keep" }, { source: "/no/such/file.md" }];
    const out = await c.resolve("s", spec);
    expect(out).toEqual([{ source: "inline", content: "keep" }]);
    expect(c.failures("s")).toEqual([
      { source: "https://example.com/a", reason: "HTTP 500" },
      { source: "/no/such/file.md", reason: "unreadable file" },
    ]);
    good = true;
    await c.resolve("s", spec);
    expect(c.failures("s").map((f) => f.source)).toEqual(["/no/such/file.md"]);
    c.clear("s");
    expect(c.failures("s")).toEqual([]);
  });
});
