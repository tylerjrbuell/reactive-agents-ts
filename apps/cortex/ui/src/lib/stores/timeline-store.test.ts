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

import { get, writable } from "svelte/store";
import { createTimelineStore } from "./timeline-store.js";
import type { RunState } from "./run-store.js";

const ev = (type: string, payload: Record<string, unknown>, ts = 0) => ({ type, payload, ts, v: 1, agentId: "a", runId: "run-1", source: "eventbus" as const });

function runStateWith(events: unknown[]): RunState {
  return { events } as unknown as RunState;
}

describe("createTimelineStore", () => {
  it("emits a reasoning row from ReasoningStepCompleted and a control row from StrategySwitched, grouped by iteration", () => {
    const rs = writable(runStateWith([
      ev("ReasoningIterationProgress", { iteration: 1, toolsThisStep: [] }),
      ev("ReasoningStepCompleted", { thought: "thinking about it", strategy: "reactive" }),
      ev("StrategySwitched", { taskId: "run-1", from: "reactive", to: "plan-execute", reason: "stuck", timestamp: 1 }),
      ev("ReasoningIterationProgress", { iteration: 2, toolsThisStep: ["crypto-price"] }),
    ]));
    const store = createTimelineStore(rs);
    const groups = get(store);
    expect(groups.map((g) => g.iteration)).toEqual([1, 2]);
    const kinds = groups.flatMap((g) => g.rows.map((r) => r.kind));
    expect(kinds).toContain("reasoning-thought");
    expect(kinds).toContain("strategy-switched");
  });

  it("preserves reasoning content (no loss): thought text survives onto the row", () => {
    const rs = writable(runStateWith([
      ev("ReasoningIterationProgress", { iteration: 1 }),
      ev("ReasoningStepCompleted", { thought: "the answer is 42", rawResponse: "raw 42" }),
    ]));
    const rows = get(createTimelineStore(rs)).flatMap((g) => g.rows);
    const r = rows.find((x) => x.kind === "reasoning-thought");
    expect(r?.reasoning?.thought).toBe("the answer is 42");
    expect(r?.reasoning?.rawResponse).toBe("raw 42");
  });

  it("normalizes LLMExchangeEmitted into an llm row via toTraceEvent", () => {
    const rs = writable(runStateWith([
      ev("ReasoningIterationProgress", { iteration: 1 }),
      ev("LLMExchangeEmitted", {
        taskId: "run-1", timestamp: 1, iteration: 1, provider: "ollama", model: "qwen3.5",
        requestKind: "stream", systemPrompt: "Environment: …", messages: [], toolSchemaNames: [],
        response: { content: "ok", tokensIn: 50, tokensOut: 3 },
      }),
    ]));
    const rows = get(createTimelineStore(rs)).flatMap((g) => g.rows);
    const llm = rows.find((x) => x.kind === "llm-exchange");
    expect(llm?.category).toBe("llm");
    expect(llm?.trace).toBeDefined();
  });
});
