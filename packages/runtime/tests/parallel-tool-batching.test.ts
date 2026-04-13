import { describe, it, expect } from "bun:test";
import { planNextMoveBatches } from "@reactive-agents/reasoning";

describe("parallelToolCalls kill-switch", () => {
  it("disabled config produces singletons", () => {
    const calls = [
      { id: "a", name: "web-search", arguments: {} },
      { id: "b", name: "web-search", arguments: {} },
    ];
    const batches = planNextMoveBatches(calls, { enabled: false });
    expect(batches).toHaveLength(2);
  });

  it("enabled config (default) batches safe tools", () => {
    const calls = [
      { id: "a", name: "web-search", arguments: {} },
      { id: "b", name: "web-search", arguments: {} },
    ];
    const batches = planNextMoveBatches(calls, { enabled: true, maxBatchSize: 4, allowParallelBatching: true });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });
});
