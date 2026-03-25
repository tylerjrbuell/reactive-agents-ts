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
  it("has all four parameters", () => {
    const names = recallTool.parameters.map(p => p.name);
    expect(names).toContain("key");
    expect(names).toContain("content");
    expect(names).toContain("query");
    expect(names).toContain("full");
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
});
