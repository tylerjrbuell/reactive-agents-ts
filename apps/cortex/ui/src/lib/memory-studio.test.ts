import { describe, expect, test } from "bun:test";
import {
  deleteMemoryEntry,
  fetchMemory,
  filterEntries,
  memoryLayerTabs,
  memoryStudioHref,
  memoryUrl,
  parseTags,
  proceduralDraftOf,
  proceduralPatchOf,
  provenanceOf,
  searchHint,
  searchMemory,
  semanticDraftOf,
  semanticPatchOf,
  shortId,
  updateSemanticMemory,
  type MemoryListing,
  type ProceduralMemory,
  type SemanticMemory,
} from "./memory-studio.js";

const sem: SemanticMemory = {
  id: "sem-1",
  content: "Deploys use blue green.",
  summary: "Deploys",
  importance: 0.7,
  verified: false,
  tags: ["ops", "deploy"],
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  accessCount: 2,
  lastAccessedAt: "2026-11-11T00:00:00.000Z",
  taskId: "task-1",
  runId: "run-1",
};
const proc: ProceduralMemory = {
  id: "proc-1",
  name: "release",
  description: "Cut a release",
  pattern: "build, tag",
  successRate: 0.9,
  useCount: 3,
  tags: [],
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
};

type Call = { url: string; init?: RequestInit };
const recorder = (body: unknown, status = 200) => {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fn };
};

describe("provenance", () => {
  test("an entry with a run links to the run view", () => {
    expect(provenanceOf(sem)).toEqual({ kind: "run", runId: "run-1", href: "/run/run-1", taskId: "task-1" });
  });
  test("an entry without a run says so", () => {
    expect(provenanceOf(proc)).toEqual({ kind: "unknown" });
  });
  test("the studio link carries the agent and the run", () => {
    expect(memoryStudioHref("agent a", "run-1")).toBe("/lab?agent=agent+a&run=run-1#memory");
    expect(memoryStudioHref("a")).toBe("/lab?agent=a#memory");
  });
  test("long ids are shortened for labels", () => {
    expect(shortId("01HXABCDEFGHJKMNPQ")).toBe("01HXAB…MNPQ");
    expect(shortId("run-1")).toBe("run-1");
  });
});

describe("semanticPatchOf", () => {
  test("an untouched draft is no patch", () => {
    expect(semanticPatchOf(sem, semanticDraftOf(sem))).toEqual({ ok: true, patch: null });
  });
  test("only changed fields are sent", () => {
    const d = { ...semanticDraftOf(sem), content: " Deploys use canaries. ", importance: "0.9" };
    expect(semanticPatchOf(sem, d)).toEqual({ ok: true, patch: { content: "Deploys use canaries.", importance: 0.9 } });
  });
  test("tags are compared as a list", () => {
    expect(semanticPatchOf(sem, { ...semanticDraftOf(sem), tags: "ops,  deploy" })).toEqual({ ok: true, patch: null });
    expect(semanticPatchOf(sem, { ...semanticDraftOf(sem), tags: "ops" })).toEqual({ ok: true, patch: { tags: ["ops"] } });
  });
  test("empty content and out-of-range importance are refused", () => {
    expect(semanticPatchOf(sem, { ...semanticDraftOf(sem), content: "  " }).ok).toBe(false);
    expect(semanticPatchOf(sem, { ...semanticDraftOf(sem), importance: "1.5" }).ok).toBe(false);
    expect(semanticPatchOf(sem, { ...semanticDraftOf(sem), importance: "" }).ok).toBe(false);
    expect(semanticPatchOf(sem, { ...semanticDraftOf(sem), importance: "abc" }).ok).toBe(false);
  });
});

describe("proceduralPatchOf", () => {
  test("changed fields only; the name stays required", () => {
    expect(proceduralPatchOf(proc, proceduralDraftOf(proc))).toEqual({ ok: true, patch: null });
    expect(proceduralPatchOf(proc, { ...proceduralDraftOf(proc), description: "Release checklist" })).toEqual({
      ok: true,
      patch: { description: "Release checklist" },
    });
    expect(proceduralPatchOf(proc, { ...proceduralDraftOf(proc), name: "" }).ok).toBe(false);
  });
});

describe("helpers", () => {
  test("parseTags trims, drops empties and duplicates", () => {
    expect(parseTags(" a, b,,a , c ")).toEqual(["a", "b", "c"]);
  });
  test("layer tabs carry counts once loaded", () => {
    const listing: MemoryListing = { agentId: "a", available: true, dbPath: "", semantic: [sem], procedural: [], episodic: [] };
    expect(memoryLayerTabs(listing).map((t) => [t.id, t.count])).toEqual([
      ["semantic", 1],
      ["procedural", 0],
      ["episodic", 0],
    ]);
    expect(memoryLayerTabs(null)[0]).toEqual({ id: "semantic", label: "Facts" });
  });
  test("filterEntries matches content, tags, names and event types", () => {
    expect(filterEntries([sem], "DEPLOY").length).toBe(1);
    expect(filterEntries([sem], "ops").length).toBe(1);
    expect(filterEntries([proc], "release").length).toBe(1);
    expect(filterEntries([{ id: "e", date: "", content: "x", eventType: "task-started" }], "started").length).toBe(1);
    expect(filterEntries([sem], "nothing").length).toBe(0);
  });
  test("searchHint warns only when every word is a single character", () => {
    expect(searchHint("a")).toMatch(/2 or more/);
    expect(searchHint("x y")).toMatch(/2 or more/);
    expect(searchHint("bun")).toBeNull();
    expect(searchHint("ai")).toBeNull();
    expect(searchHint("  ")).toBeNull();
  });
});

describe("API client", () => {
  test("memoryUrl encodes the agent and skips empty query values", () => {
    expect(memoryUrl("a/b", "/search", { q: "x y", runId: undefined })).toMatch(/\/api\/memory\/a%2Fb\/search\?q=x\+y$/);
  });
  test("fetchMemory passes the run filter", async () => {
    const r = recorder({ agentId: "a", available: true, dbPath: "", semantic: [], procedural: [], episodic: [] });
    await fetchMemory("a", "run-1", r.fn);
    expect(r.calls[0]?.url).toMatch(/\/api\/memory\/a\?runId=run-1$/);
  });
  test("searchMemory returns results", async () => {
    const r = recorder({ results: [sem] });
    expect((await searchMemory("a", "deploy", undefined, r.fn)).map((e) => e.id)).toEqual(["sem-1"]);
  });
  test("updates PATCH the changed fields; deletes use DELETE", async () => {
    const r = recorder(sem);
    await updateSemanticMemory("a", "sem 1", { importance: 0.9 }, r.fn);
    expect(r.calls[0]?.url).toMatch(/\/api\/memory\/a\/semantic\/sem%201$/);
    expect(r.calls[0]?.init?.method).toBe("PATCH");
    expect(r.calls[0]?.init?.body).toBe(JSON.stringify({ importance: 0.9 }));
    const d = recorder({ deleted: true });
    await deleteMemoryEntry("a", "procedural", "p1", d.fn);
    expect(d.calls[0]?.init?.method).toBe("DELETE");
  });
  test("a failed call rejects with the server's error", async () => {
    const r = recorder({ error: "No memory database" }, 404);
    await expect(fetchMemory("a", undefined, r.fn)).rejects.toThrow("No memory database");
  });
});
