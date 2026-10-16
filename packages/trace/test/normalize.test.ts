import { describe, it, expect } from "bun:test";
import { toTraceEvent } from "../src/normalize.js";
import type { AgentEvent } from "@reactive-agents/core";
import { isTraceEvent } from "../src/events.js";
import type { EntropyScoredEvent, DecisionEvaluatedEvent } from "../src/events.js";

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
  it("AgentStarted carries taskTruncated when the raw task was clipped", () => {
    const raw = {
      _tag: "AgentStarted", ...base,
      task: "a long prompt",
      model: "qwen3.5",
      provider: "ollama",
      taskTruncated: true,
    } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 1);
    expect(ev?.kind).toBe("run-started");
    expect((ev as { taskTruncated?: boolean }).taskTruncated).toBe(true);
  });
  it("AgentStarted omits taskTruncated when the raw task was not clipped", () => {
    const raw = {
      _tag: "AgentStarted", ...base,
      task: "short prompt",
      model: "qwen3.5",
      provider: "ollama",
    } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 1);
    expect(ev?.kind).toBe("run-started");
    expect("taskTruncated" in (ev as Record<string, unknown>)).toBe(false);
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

  it("EntropyScored preserves null sources rather than coercing to 0", () => {
    const raw = {
      _tag: "EntropyScored",
      taskId: "run-null-src",
      timestamp: 1000,
      iteration: 4,
      composite: 0.52,
      sources: {
        token: null,
        structural: 0.55,
        semantic: null,
        behavioral: 0.33,
        contextPressure: 0.1,
      },
    } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 0) as EntropyScoredEvent;
    expect(ev.kind).toBe("entropy-scored");
    expect(ev.sources.token).toBeNull();
    expect(ev.sources.semantic).toBeNull();
    expect(ev.sources.structural).toBe(0.55);
    // sourcesPresent excludes contextPressure (never null) — only structural
    // + behavioral present here (token/semantic null).
    expect(ev.sourcesPresent).toBe(2);
  });

  it("EntropyScored keeps a genuine zero distinct from an absent source", () => {
    const raw = {
      _tag: "EntropyScored",
      taskId: "run-real-zero",
      timestamp: 1000,
      iteration: 4,
      composite: 0.4,
      sources: {
        token: 0,
        structural: 0.5,
        semantic: null,
        behavioral: 0.2,
        contextPressure: 0,
      },
    } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 0) as EntropyScoredEvent;
    expect(ev.sources.token).toBe(0);
    expect(ev.sources.semantic).toBeNull();
    // sourcesPresent excludes contextPressure — token(0)/structural/behavioral
    // present, semantic null.
    expect(ev.sourcesPresent).toBe(3);
  });

  it("EntropyScored carries confidence, trajectory shape, and model tier", () => {
    const raw = {
      _tag: "EntropyScored",
      taskId: "run-rich",
      timestamp: 1000,
      iteration: 5,
      composite: 0.61,
      sources: {
        token: null,
        structural: 0.55,
        semantic: null,
        behavioral: 0.33,
        contextPressure: 0.1,
      },
      trajectory: { history: [0.5, 0.58, 0.61], derivative: 0.03, momentum: 0.2, shape: "flat" },
      confidence: "low",
      modelTier: "local",
      iterationWeight: 0.42,
    } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 0) as EntropyScoredEvent;
    expect(ev.confidence).toBe("low");
    expect(ev.trajectoryShape).toBe("flat");
    expect(ev.modelTier).toBe("local");
  });

  it("EntropyScored defaults gracefully when rich fields are absent", () => {
    const raw = {
      _tag: "EntropyScored",
      taskId: "run-bare",
      timestamp: 1000,
      iteration: 1,
      composite: 0.3,
      sources: { token: null, structural: 0.4, semantic: null, behavioral: 0.2, contextPressure: 0.05 },
    } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 0) as EntropyScoredEvent;
    expect(ev.confidence).toBe("low");
    expect(ev.trajectoryShape).toBe("unknown");
    expect(ev.modelTier).toBe("unknown");
  });

  // I-2 (2026-09-14 final review, entropy-system-hardening): REQUIRED_FIELDS_BY_KIND
  // now requires sourcesPresent + confidence on entropy-scored, and isTraceEvent
  // hard-rejects (loadTrace silently drops) any event missing a required field.
  // A pre-branch raw bus event — no sourcesPresent/confidence keys at all, only
  // composite+sources — must still normalize into a TraceEvent that PASSES
  // isTraceEvent, or the pre-branch trace corpus becomes silently unparseable.
  it("normalizes an old-shape raw event (no sourcesPresent/confidence keys) into a valid, non-rejected TraceEvent", () => {
    const raw = {
      _tag: "EntropyScored",
      taskId: "run-old-shape",
      timestamp: 1000,
      iteration: 2,
      composite: 0.45,
      sources: { token: 0.1, structural: 0.2, semantic: 0.3, behavioral: 0.4, contextPressure: 0.05 },
    } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 0) as EntropyScoredEvent;
    expect(ev.sourcesPresent).toBe(4);
    expect(ev.confidence).toBe("low");
    expect(isTraceEvent(ev)).toBe(true);
  });

  it("ReactiveDecision prefers an explicit confidence over the entropy-delta formula", () => {
    const raw = {
      _tag: "ReactiveDecision",
      taskId: "run-switch",
      iteration: 3,
      decision: "switch-strategy",
      confidence: 0.44,
      reason: "Entropy flat for 3 iterations with high loop score (0.69)",
      entropyBefore: 0.62,
    } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 0) as DecisionEvaluatedEvent;
    expect(ev.confidence).toBeCloseTo(0.44, 5);
  });

  it("ReactiveDecision still derives confidence from entropy delta when none is given", () => {
    const raw = {
      _tag: "ReactiveDecision",
      taskId: "run-delta",
      iteration: 3,
      decision: "compress",
      entropyBefore: 0.8,
      entropyAfter: 0.4,
      reason: "compressed",
    } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 0) as DecisionEvaluatedEvent;
    expect(ev.confidence).toBeCloseTo(0.5, 5);
  });
});
