import { describe, it, expect } from "bun:test";
import { toTraceEvent } from "../src/normalize.js";
import type { AgentEvent } from "@reactive-agents/core";

const base = { taskId: "run-1", timestamp: 1000 };

describe("toTraceEvent", () => {
  it("maps LLMExchangeEmitted → llm-exchange with the injected seq", () => {
    const raw = {
      _tag: "LLMExchangeEmitted", ...base, iteration: 2, provider: "ollama", model: "qwen3.5",
      requestKind: "stream", systemPrompt: "sys", messages: [{ role: "user", content: "hi" }],
      toolSchemaNames: [], response: { content: "ok", tokensIn: 100, tokensOut: 5 },
    } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 7);
    expect(ev?.kind).toBe("llm-exchange");
    expect(ev?.seq).toBe(7);
    expect((ev as { provider: string }).provider).toBe("ollama");
    expect((ev as { iter: number }).iter).toBe(2);
  });
  it("maps StrategySwitched → strategy-switched", () => {
    const raw = { _tag: "StrategySwitched", ...base, from: "reactive", to: "plan-execute", reason: "stuck" } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 3);
    expect(ev?.kind).toBe("strategy-switched");
    expect((ev as { to: string }).to).toBe("plan-execute");
  });
  it("returns null for unmapped tags (ReasoningStepCompleted)", () => {
    const raw = { _tag: "ReasoningStepCompleted", ...base, strategy: "reactive", step: 1, totalSteps: 0, thought: "x" } as unknown as AgentEvent;
    expect(toTraceEvent(raw, 1)).toBeNull();
  });
});
