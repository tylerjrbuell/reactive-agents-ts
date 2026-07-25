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

  // Wave C.2 slice 3 — the run ledger reaches the trace stream.
  it("maps LedgerEntryAppended → ledger-entry, batch + iter from the entries", () => {
    const raw = {
      _tag: "LedgerEntryAppended", agentId: "a", ...base,
      entries: [
        { kind: "tool-invocation", seq: 3, iteration: 2, toolName: "file-read" },
        { kind: "tool-result", seq: 4, iteration: 2, success: true, pass: "sub-agent:worker" },
      ],
    } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 9);
    expect(ev?.kind).toBe("ledger-entry");
    expect(ev?.seq).toBe(9);              // trace seq, injected — NOT the ledger seq
    expect((ev as { iter: number }).iter).toBe(2);
    const entries = (ev as { entries: ReadonlyArray<Record<string, unknown>> }).entries;
    expect(entries).toHaveLength(2);
    expect(entries[1].pass).toBe("sub-agent:worker");   // merged sub-agent provenance survives onto the trace
  });

  it("maps a ledger batch with no iteration to iter -1", () => {
    const raw = {
      _tag: "LedgerEntryAppended", agentId: "a", ...base,
      entries: [{ kind: "requirement", seq: 0 }],
    } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 1);
    expect((ev as { iter: number }).iter).toBe(-1);
  });
});
