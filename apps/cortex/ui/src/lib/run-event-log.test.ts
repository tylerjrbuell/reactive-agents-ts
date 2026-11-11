import { describe, expect, it } from "bun:test";
import { eventPreview, eventTypeChips, eventTypeLabel } from "./run-event-log.js";

const ev = (type: string, payload: Record<string, unknown> = {}) => ({ type, payload });

describe("eventTypeChips (B8)", () => {
  it("labels two *Emitted types apart (they both read 'Emitted 4')", () => {
    const events = [
      ...Array.from({ length: 4 }, () => ev("ChecklistEmitted")),
      ...Array.from({ length: 4 }, () => ev("PostureEmitted")),
    ];
    const chips = eventTypeChips(events);
    expect(chips.map((c) => c.label)).toEqual(["Checklist emitted", "Posture emitted"]);
    expect(new Set(chips.map((c) => c.label)).size).toBe(chips.length);
  });

  it("labels Started events apart and orders by count", () => {
    const chips = eventTypeChips([ev("ToolCallStarted"), ev("LLMRequestStarted"), ev("LLMRequestStarted")]);
    expect(chips).toEqual([
      { type: "LLMRequestStarted", label: "LLM request started", count: 2 },
      { type: "ToolCallStarted", label: "Tool call started", count: 1 },
    ]);
  });

  it("caps the chip count", () => {
    expect(eventTypeChips(["A", "B", "C"].map((t) => ev(`${t}Done`)), 2)).toHaveLength(2);
  });
});

describe("eventTypeLabel", () => {
  it("is sentence case and keeps acronyms", () => {
    expect(eventTypeLabel("AgentCompleted")).toBe("Agent completed");
    expect(eventTypeLabel("LLMRequestCompleted")).toBe("LLM request completed");
    expect(eventTypeLabel("Custom")).toBe("Custom");
  });
});

describe("eventPreview", () => {
  it("summarizes common types without raw JSON", () => {
    expect(eventPreview(ev("LLMRequestCompleted", { tokensUsed: { total: 120 }, durationMs: 800, model: "m" }))).toBe("120 tok · 800 ms · m");
    expect(eventPreview(ev("ToolCallCompleted", { toolName: "web-search", success: false }))).toBe("web-search failed");
    expect(eventPreview(ev("ToolCallStarted", { toolName: "shell-execute", args: { command: "sleep 30" } }))).toBe('shell-execute · {"command":"sleep 30"}');
    expect(eventPreview(ev("ToolCallStarted", { toolName: "web-search" }))).toBe("web-search");
    expect(eventPreview(ev("ReasoningIterationProgress", { iteration: 2, maxIterations: 6, toolsThisStep: ["a"] }))).toBe("Loop 2 of 6 · a");
    expect(eventPreview(ev("EntropyScored", { composite: 0.25, trajectory: { shape: "converging" } }))).toBe("η 0.250 · converging");
  });
  it("lists scalar fields for other types, skipping bookkeeping", () => {
    expect(eventPreview(ev("ContextPressure", { taskId: "t", level: "high", utilizationPct: 82, nested: { a: 1 } }))).toBe("level high · utilizationPct 82");
    expect(eventPreview(ev("ExecutionPhaseCompleted", { phase: "think", durationMs: 18326.362272 }))).toBe("phase think · durationMs 18326.36");
  });
});
