import { describe, it, expect, beforeEach } from "bun:test";
import { Effect, Ref } from "effect";
import { makeRecallHandler, recallTool } from "../src/skills/recall.js";

let storeRef: Ref.Ref<Map<string, string>>;
let handler: ReturnType<typeof makeRecallHandler>;

beforeEach(() => Effect.runSync(Effect.gen(function* () {
  storeRef = yield* Ref.make(new Map<string, string>());
  handler = makeRecallHandler(storeRef, {});
})));

describe("recall tool definition", () => {
  it("has name 'recall'", () => expect(recallTool.name).toBe("recall"));
  it("has retrieval and segmentation parameters", () => {
    const names = recallTool.parameters.map(p => p.name);
    expect(names).toContain("key");
    expect(names).toContain("content");
    expect(names).toContain("query");
    expect(names).toContain("full");
    expect(names).toContain("start");
    expect(names).toContain("maxChars");
    expect(names).toContain("lineStart");
    expect(names).toContain("lineCount");
    expect(names).toContain("arrayStart");
    expect(names).toContain("arrayCount");
  });
});

describe("recall write mode", () => {
  it("stores content and returns preview", async () => {
    const result = await Effect.runPromise(handler({ key: "plan", content: "Step 1\nStep 2" })) as any;
    expect(result.saved).toBe(true);
    expect(result.key).toBe("plan");
    expect(result.bytes).toBe(13);
    expect(result.preview).toContain("Step 1");
  });

  it("stores large content in full without truncation", async () => {
    const big = "x".repeat(2000);
    await Effect.runPromise(handler({ key: "big", content: big }));
    const store = await Effect.runPromise(Ref.get(storeRef));
    expect(store.get("big")).toBe(big);
  });
});

describe("recall read mode", () => {
  it("returns preview by default for large entries", async () => {
    const big = "a".repeat(500);
    await Effect.runPromise(handler({ key: "data", content: big }));
    const result = await Effect.runPromise(handler({ key: "data" })) as any;
    expect(result.truncated).toBe(true);
    expect(result.preview.length).toBeLessThanOrEqual(210);
  });

  it("returns full content when full: true", async () => {
    const big = "a".repeat(500);
    await Effect.runPromise(handler({ key: "data", content: big }));
    const result = await Effect.runPromise(handler({ key: "data", full: true })) as any;
    expect(result.truncated).toBe(false);
    expect(result.content.length).toBe(500);
  });

  it("always returns full for entries below autoFullThreshold", async () => {
    await Effect.runPromise(handler({ key: "small", content: "tiny" }));
    const result = await Effect.runPromise(handler({ key: "small" })) as any;
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("tiny");
  });

  it("returns found: false for missing key", async () => {
    const result = await Effect.runPromise(handler({ key: "missing" })) as any;
    expect(result.found).toBe(false);
  });
});

describe("recall list mode", () => {
  it("returns all entries with metadata", async () => {
    await Effect.runPromise(handler({ key: "a", content: "hello" }));
    await Effect.runPromise(handler({ key: "_tool_result_1", content: "auto result" }));
    const result = await Effect.runPromise(handler({})) as any;
    expect(result.totalEntries).toBe(2);
    const aEntry = result.entries.find((e: any) => e.key === "a");
    expect(aEntry?.type).toBe("agent");
    const autoEntry = result.entries.find((e: any) => e.key === "_tool_result_1");
    expect(autoEntry?.type).toBe("auto");
  });
});

describe("recall search mode", () => {
  it("finds entries by keyword", async () => {
    await Effect.runPromise(handler({ key: "react", content: "TypeScript React components" }));
    await Effect.runPromise(handler({ key: "python", content: "Python data science numpy" }));
    const result = await Effect.runPromise(handler({ query: "TypeScript React" })) as any;
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);
    expect(result.matches[0].key).toBe("react");
  });

  it("returns zero matches for unrelated query", async () => {
    await Effect.runPromise(handler({ key: "data", content: "apples oranges" }));
    const result = await Effect.runPromise(handler({ query: "quantum neutron" })) as any;
    expect(result.totalMatches).toBe(0);
  });

  it("supports in-entry search when key + query are provided", async () => {
    const text = [
      "alpha line",
      "beta match line",
      "gamma",
      "delta match line",
    ].join("\n");
    await Effect.runPromise(handler({ key: "notes", content: text }));
    const result = await Effect.runPromise(handler({ key: "notes", query: "match" })) as any;
    expect(result.mode).toBe("in-entry-search");
    expect(result.totalMatches).toBe(2);
    expect(result.matches[0].line).toContain("match");
  });
});

describe("recall segmented retrieval", () => {
  it("supports char-range retrieval with nextStart", async () => {
    const big = "x".repeat(300);
    await Effect.runPromise(handler({ key: "blob", content: big }));
    const result = await Effect.runPromise(
      handler({ key: "blob", start: 50, maxChars: 80 }),
    ) as any;
    expect(result.mode).toBe("chars");
    expect(result.content.length).toBe(80);
    expect(result.start).toBe(50);
    expect(result.nextStart).toBe(130);
    expect(result.hasMore).toBe(true);
  });

  it("supports line-range retrieval", async () => {
    const lines = Array.from({ length: 120 }, (_, i) => `line-${i}`);
    await Effect.runPromise(handler({ key: "log", content: lines.join("\n") }));
    const result = await Effect.runPromise(
      handler({ key: "log", lineStart: 10, lineCount: 5 }),
    ) as any;
    expect(result.mode).toBe("lines");
    expect(result.content).toContain("line-10");
    expect(result.content).toContain("line-14");
    expect(result.totalLines).toBe(120);
    expect(result.nextLineStart).toBe(15);
  });

  it("supports JSON array slicing", async () => {
    const arr = Array.from({ length: 30 }, (_, i) => ({ id: i }));
    await Effect.runPromise(handler({ key: "arr", content: JSON.stringify(arr) }));
    const result = await Effect.runPromise(
      handler({ key: "arr", arrayStart: 5, arrayCount: 4 }),
    ) as any;
    expect(result.mode).toBe("array");
    expect(result.items.length).toBe(4);
    expect(result.items[0].id).toBe(5);
    expect(result.items[3].id).toBe(8);
    expect(result.totalItems).toBe(30);
    expect(result.nextArrayStart).toBe(9);
  });
});
