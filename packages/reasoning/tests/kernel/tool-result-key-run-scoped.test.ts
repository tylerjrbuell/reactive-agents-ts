// Scratchpad keys (`_tool_result_N`) are minted from the RUN's scratchpad, not
// a process-global counter. A module-level counter made prompts depend on how
// many runs the process had done before: two identical runs differed once the
// key crossed a digit boundary (_tool_result_99 -> _tool_result_100), which
// broke replay determinism and drifted a long-lived server's prompts.
import { describe, it, expect } from "bun:test";
import {
  compressToolResult,
  nextToolResultKey,
} from "../../src/kernel/capabilities/attend/tool-formatting.js";

const BIG = JSON.stringify(
  Array.from({ length: 40 }, (_, i) => ({ id: i, title: `item number ${i}`, body: "x".repeat(60) })),
);

describe("tool-result scratchpad keys are run-scoped", () => {
  it("a fresh run scratchpad mints _tool_result_1 regardless of prior process activity", () => {
    // Simulate earlier runs in the same process.
    const earlierRun = new Map<string, string>();
    for (let i = 0; i < 120; i++) {
      const c = compressToolResult(BIG, "web-search", 200, 3, earlierRun);
      if (c.stored) earlierRun.set(c.stored.key, c.stored.value);
    }

    const runA = new Map<string, string>();
    const runB = new Map<string, string>();
    const a = compressToolResult(BIG, "web-search", 200, 3, runA);
    const b = compressToolResult(BIG, "web-search", 200, 3, runB);

    expect(a.stored?.key).toBe("_tool_result_1");
    expect(b.stored?.key).toBe("_tool_result_1");
    expect(a.content).toBe(b.content);
  });

  it("keys stay unique within one run (no overwrite of an earlier stored result)", () => {
    const run = new Map<string, string>();
    const keys: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = compressToolResult(BIG, "web-search", 200, 3, run);
      expect(c.stored).toBeDefined();
      run.set(c.stored!.key, c.stored!.value);
      keys.push(c.stored!.key);
    }
    expect(keys).toEqual(["_tool_result_1", "_tool_result_2", "_tool_result_3"]);
  });

  it("minting skips past the highest existing key, ignoring unrelated entries", () => {
    const run = new Map<string, string>([
      ["_tool_result_7", "a"],
      ["_tool_result_2", "b"],
      ["notes", "c"],
      ["_tool_result_x", "d"],
    ]);
    expect(nextToolResultKey(run)).toBe("_tool_result_8");
    expect(nextToolResultKey(new Map())).toBe("_tool_result_1");
  });
});
