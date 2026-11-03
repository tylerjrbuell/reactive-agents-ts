import { describe, it, expect } from "bun:test";
import { toTraceEvent } from "../src/normalize.js";
import type { AgentEvent } from "@reactive-agents/core";
import { isTraceEvent } from "../src/events.js";
import type { EntropyScoredEvent, DecisionEvaluatedEvent } from "../src/events.js";

const base = { taskId: "run-1", timestamp: 1000 };

/**
 * One cast site for every partial raw-event fixture in this file.
 * boundary: toTraceEvent's input is the wide AgentEvent union; each fixture here
 * carries only the fields the normalizer reads, and some deliberately omit
 * fields (legacy shapes).
 */
const rawEvent = (fields: Record<string, unknown>): AgentEvent => fields as unknown as AgentEvent;

describe("toTraceEvent", () => {
  it("maps LLMExchangeEmitted → llm-exchange with the injected seq", () => {
    const raw = rawEvent({
      _tag: "LLMExchangeEmitted", ...base, iteration: 2, provider: "ollama", model: "qwen3.5",
      requestKind: "stream", systemPrompt: "sys", messages: [{ role: "user", content: "hi" }],
      toolSchemaNames: [], response: { content: "ok", tokensIn: 100, tokensOut: 5 },
    });
    const ev = toTraceEvent(raw, 7);
    expect(ev?.kind).toBe("llm-exchange");
    expect(ev?.seq).toBe(7);
    expect((ev as { provider: string }).provider).toBe("ollama");
    expect((ev as { iter: number }).iter).toBe(2);
  });
  it("AgentStarted carries taskTruncated when the raw task was clipped", () => {
    const raw = rawEvent({
      _tag: "AgentStarted", ...base,
      task: "a long prompt",
      model: "qwen3.5",
      provider: "ollama",
      taskTruncated: true,
    });
    const ev = toTraceEvent(raw, 1);
    expect(ev?.kind).toBe("run-started");
    expect((ev as { taskTruncated?: boolean }).taskTruncated).toBe(true);
  });
  it("AgentStarted omits taskTruncated when the raw task was not clipped", () => {
    const raw = rawEvent({
      _tag: "AgentStarted", ...base,
      task: "short prompt",
      model: "qwen3.5",
      provider: "ollama",
    });
    const ev = toTraceEvent(raw, 1);
    expect(ev?.kind).toBe("run-started");
    expect("taskTruncated" in (ev as Record<string, unknown>)).toBe(false);
  });
  it("maps StrategySwitched → strategy-switched", () => {
    const raw = rawEvent({ _tag: "StrategySwitched", ...base, from: "reactive", to: "plan-execute", reason: "stuck" });
    const ev = toTraceEvent(raw, 3);
    expect(ev?.kind).toBe("strategy-switched");
    expect((ev as { to: string }).to).toBe("plan-execute");
  });
  it("returns null for unmapped tags (ReasoningStepCompleted)", () => {
    const raw = rawEvent({ _tag: "ReasoningStepCompleted", ...base, strategy: "reactive", step: 1, totalSteps: 0, thought: "x" });
    expect(toTraceEvent(raw, 1)).toBeNull();
  });

  // Wave C.2 slice 3 — the run ledger reaches the trace stream.
  it("maps LedgerEntryAppended → ledger-entry, batch + iter from the entries", () => {
    const raw = rawEvent({
      _tag: "LedgerEntryAppended", agentId: "a", ...base,
      entries: [
        { kind: "tool-invocation", seq: 3, iteration: 2, toolName: "file-read" },
        { kind: "tool-result", seq: 4, iteration: 2, success: true, pass: "sub-agent:worker" },
      ],
    });
    const ev = toTraceEvent(raw, 9);
    expect(ev?.kind).toBe("ledger-entry");
    expect(ev?.seq).toBe(9);              // trace seq, injected — NOT the ledger seq
    expect((ev as { iter: number }).iter).toBe(2);
    const entries = (ev as { entries: ReadonlyArray<Record<string, unknown>> }).entries;
    expect(entries).toHaveLength(2);
    expect(entries[1].pass).toBe("sub-agent:worker");   // merged sub-agent provenance survives onto the trace
  });

  it("maps a ledger batch with no iteration to iter -1", () => {
    const raw = rawEvent({
      _tag: "LedgerEntryAppended", agentId: "a", ...base,
      entries: [{ kind: "requirement", seq: 0 }],
    });
    const ev = toTraceEvent(raw, 1);
    expect((ev as { iter: number }).iter).toBe(-1);
  });

  it("maps ChecklistInferred → checklist-inferred; round-trips JSON and passes isTraceEvent", () => {
    const raw = rawEvent({
      _tag: "ChecklistInferred", ...base, itemId: "2", groupKey: "root", iteration: 3,
      evidence: { seq: 11, kind: "artifact", detail: "./out/report.md" },
    });
    const ev = toTraceEvent(raw, 5);
    expect(ev).toMatchObject({ kind: "checklist-inferred", runId: "run-1", iter: 3, seq: 5, itemId: "2", groupKey: "root" });
    const parsed: unknown = JSON.parse(JSON.stringify(ev));
    expect(isTraceEvent(parsed)).toBe(true);
    expect((parsed as { evidence: { seq: number } }).evidence.seq).toBe(11); // ledger seq, not the trace seq
  });

  it("a checklist-inferred line missing its payload is rejected; historical kinds still load", () => {
    expect(isTraceEvent({ kind: "checklist-inferred", runId: "r", timestamp: 1, iter: 0, seq: 0 })).toBe(false);
    expect(isTraceEvent({ kind: "ledger-entry", runId: "r", timestamp: 1, iter: 0, seq: 0, entries: [] })).toBe(true);
  });

  it("maps EnvironmentChanged → environment-updated (session id as runId); round-trips and passes isTraceEvent", () => {
    const raw = rawEvent({
      _tag: "EnvironmentChanged", sessionId: "sess_1", timestamp: 9,
      changes: [{ kind: "model", summary: "Model changed: a -> b" }],
    });
    const ev = toTraceEvent(raw, 2);
    expect(ev).toMatchObject({ kind: "environment-updated", runId: "sess_1", iter: -1, seq: 2 });
    expect(isTraceEvent(JSON.parse(JSON.stringify(ev)))).toBe(true);
    expect(isTraceEvent({ kind: "environment-updated", runId: "s", timestamp: 1, iter: -1, seq: 0 })).toBe(false);
  });

  it("EntropyScored preserves null sources rather than coercing to 0", () => {
    const raw = rawEvent({
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
    });
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
    const raw = rawEvent({
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
    });
    const ev = toTraceEvent(raw, 0) as EntropyScoredEvent;
    expect(ev.sources.token).toBe(0);
    expect(ev.sources.semantic).toBeNull();
    // sourcesPresent excludes contextPressure — token(0)/structural/behavioral
    // present, semantic null.
    expect(ev.sourcesPresent).toBe(3);
  });

  it("EntropyScored carries confidence, trajectory shape, and model tier", () => {
    const raw = rawEvent({
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
    });
    const ev = toTraceEvent(raw, 0) as EntropyScoredEvent;
    expect(ev.confidence).toBe("low");
    expect(ev.trajectoryShape).toBe("flat");
    expect(ev.modelTier).toBe("local");
  });

  it("EntropyScored defaults gracefully when rich fields are absent", () => {
    const raw = rawEvent({
      _tag: "EntropyScored",
      taskId: "run-bare",
      timestamp: 1000,
      iteration: 1,
      composite: 0.3,
      sources: { token: null, structural: 0.4, semantic: null, behavioral: 0.2, contextPressure: 0.05 },
    });
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
    const raw = rawEvent({
      _tag: "EntropyScored",
      taskId: "run-old-shape",
      timestamp: 1000,
      iteration: 2,
      composite: 0.45,
      sources: { token: 0.1, structural: 0.2, semantic: 0.3, behavioral: 0.4, contextPressure: 0.05 },
    });
    const ev = toTraceEvent(raw, 0) as EntropyScoredEvent;
    expect(ev.sourcesPresent).toBe(4);
    expect(ev.confidence).toBe("low");
    expect(isTraceEvent(ev)).toBe(true);
  });

  it("ReactiveDecision prefers an explicit confidence over the entropy-delta formula", () => {
    const raw = rawEvent({
      _tag: "ReactiveDecision",
      taskId: "run-switch",
      iteration: 3,
      decision: "switch-strategy",
      confidence: 0.44,
      reason: "Entropy flat for 3 iterations with high loop score (0.69)",
      entropyBefore: 0.62,
    });
    const ev = toTraceEvent(raw, 0) as DecisionEvaluatedEvent;
    expect(ev.confidence).toBeCloseTo(0.44, 5);
  });

  it("ReactiveDecision still derives confidence from entropy delta when none is given", () => {
    const raw = rawEvent({
      _tag: "ReactiveDecision",
      taskId: "run-delta",
      iteration: 3,
      decision: "compress",
      entropyBefore: 0.8,
      entropyAfter: 0.4,
      reason: "compressed",
    });
    const ev = toTraceEvent(raw, 0) as DecisionEvaluatedEvent;
    expect(ev.confidence).toBeCloseTo(0.5, 5);
  });
  it("AgentStarted forwards config + origin; absent stays {} with no origin", () => {
    const cfg = { mechanisms: { leanHarness: true }, builder: {}, env: {} };
    const withCfg = toTraceEvent(rawEvent({ _tag: "AgentStarted", ...base, model: "m", provider: "p", config: cfg, origin: "gateway", posture: "plan" }), 1);
    expect(withCfg?.kind === "run-started" && withCfg.config).toEqual({ ...cfg, posture: "plan" });
    expect(withCfg?.kind === "run-started" && withCfg.origin).toBe("gateway");
    const legacy = toTraceEvent(rawEvent({ _tag: "AgentStarted", ...base, model: "m", provider: "p" }), 1);
    expect(legacy?.kind === "run-started" && legacy.config).toEqual({});
    expect(legacy && "origin" in legacy).toBe(false);
  });
  it("AgentAborted maps to a valid run-aborted sentinel", () => {
    const ev = toTraceEvent(rawEvent({ _tag: "AgentAborted", ...base, agentId: "a", causeClass: "interrupt", durationMs: 12, rootRunId: "root", depth: 1 }), 3);
    expect(ev?.kind).toBe("run-aborted");
    expect(ev?.runId).toBe("run-1");
    expect(ev?.rootRunId).toBe("root");
    expect(isTraceEvent(ev)).toBe(true);
    expect(isTraceEvent({ kind: "run-aborted", runId: "x", timestamp: 1, iter: -1, seq: 0 })).toBe(false);
  });
});
