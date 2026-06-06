// apps/cortex/ui/src/lib/stores/timeline-store.test.ts
import { describe, it, expect } from "bun:test";
import { categoryOf, isAux, filterRows, ALL_CATEGORIES, type TimelineRow } from "./timeline-filter.js";

const row = (over: Partial<TimelineRow>): TimelineRow => ({
  id: "0", seq: 0, ts: 0, iteration: 1, category: "reasoning", kind: "reasoning-thought", title: "t", ...over,
});

describe("timeline-filter", () => {
  it("categorizes a strategy-switched trace as control", () => {
    expect(categoryOf({ kind: "strategy-switched" } as never)).toBe("control");
  });
  it("flags a completeStructured llm-exchange as aux", () => {
    expect(isAux({ kind: "llm-exchange", requestKind: "completeStructured", systemPrompt: "x" } as never)).toBe(true);
  });
  it("flags a tool-classifier llm-exchange as aux", () => {
    expect(isAux({ kind: "llm-exchange", requestKind: "complete", systemPrompt: "You are a tool classifier. Output…" } as never)).toBe(true);
  });
  it("does NOT flag a normal reasoning llm-exchange as aux", () => {
    expect(isAux({ kind: "llm-exchange", requestKind: "stream", systemPrompt: "Environment: …" } as never)).toBe(false);
  });
  it("filterRows excludes muted categories", () => {
    const rows = [row({ category: "reasoning" }), row({ category: "aux", id: "1", seq: 1 })];
    const out = filterRows(rows, new Set(ALL_CATEGORIES.filter((c) => c !== "aux")));
    expect(out.map((r) => r.id)).toEqual(["0"]);
  });
});
