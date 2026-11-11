import { describe, expect, test } from "bun:test";
import { liveToolCalls } from "./live-tool-calls.js";

describe("liveToolCalls", () => {
  test("a started call is live with its arguments until its completion arrives", () => {
    const started = { ts: 10, type: "ToolCallStarted", payload: { toolName: "shell-execute", callId: "c1", args: { command: "sleep 30" } } };
    expect(liveToolCalls([started])).toEqual([{ callId: "c1", toolName: "shell-execute", args: { command: "sleep 30" }, startedAt: 10 }]);
    const completed = { ts: 40, type: "ToolCallCompleted", payload: { toolName: "shell-execute", callId: "c1", success: true } };
    expect(liveToolCalls([started, completed])).toEqual([]);
  });

  test("keeps start order, omits args when the event had none, and skips calls without an id", () => {
    const out = liveToolCalls([
      { ts: 1, type: "ToolCallStarted", payload: { toolName: "a", callId: "x" } },
      { ts: 2, type: "ToolCallStarted", payload: { toolName: "b" } },
      { ts: 3, type: "ToolCallStarted", payload: { toolName: "c", callId: "y", args: { q: 1 } } },
      { ts: 4, type: "LLMRequestCompleted", payload: {} },
    ]);
    expect(out.map((c) => c.toolName)).toEqual(["a", "c"]);
    expect("args" in out[0]!).toBe(false);
  });
});
