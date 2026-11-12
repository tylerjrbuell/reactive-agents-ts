import { describe, it, expect } from "bun:test";
import type { AgentEvent, RunAbortReason } from "../src/index.js";

describe("MemoryRecalled event + guardrail abort reason", () => {
  it("MemoryRecalled is a member of AgentEvent with optional agentId/query", () => {
    const minimal: AgentEvent = { _tag: "MemoryRecalled", taskId: "t", tier: "semantic", items: [] };
    const full: AgentEvent = {
      _tag: "MemoryRecalled",
      taskId: "t",
      agentId: "a",
      tier: "episodic",
      query: "q",
      items: [{ id: "m1", tier: "episodic", summary: "s", score: 0.9, importance: 0.5 }],
    };
    expect(minimal._tag).toBe("MemoryRecalled");
    expect(full._tag).toBe("MemoryRecalled");
  });

  it("RunAbortReason accepts 'guardrail'", () => {
    const r: RunAbortReason = "guardrail";
    expect(r).toBe("guardrail");
  });
});
