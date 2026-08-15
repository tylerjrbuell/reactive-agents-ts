// Run: bun test packages/reasoning/tests/kernel/capabilities/reflect/reactive-observer-unconsumed-evidence.test.ts
//
// 2026-08-15 root fix (scratch.ts research-task finding): evaluateToolInject's
// knowledge-gap remedy defaulted to re-suggesting web-search even when the
// model already fetched the answer (e.g. an HTTP 200 page body) and simply
// never called recall() to read it back out of the compressed scratchpad.
// This test pins `computeHasUnconsumedStoredEvidence` against the REAL
// production shapes tool-observe.ts/act.ts write onto `ReasoningStep.metadata`
// (`storedKey` on observation steps, `toolCall: { name, arguments }` on
// action steps) — not a hand-built fixture that could drift from production.

import { describe, it, expect } from "bun:test";
import { computeHasUnconsumedStoredEvidence } from "../../../../src/kernel/capabilities/reflect/reactive-observer.js";
import type { ReasoningStep } from "../../../../src/types/index.js";

function observationStep(storedKey: string | undefined): ReasoningStep {
  return {
    id: "s" as never,
    type: "observation",
    content: "[preview]",
    timestamp: new Date(),
    metadata: { toolCallId: "c1", ...(storedKey ? { storedKey } : {}) },
  };
}

function actionStep(name: string, args: Record<string, unknown>): ReasoningStep {
  return {
    id: "a" as never,
    type: "action",
    content: `call ${name}`,
    timestamp: new Date(),
    metadata: { toolCall: { id: "c1", name, arguments: args } },
  };
}

describe("computeHasUnconsumedStoredEvidence (production step shapes)", () => {
  it("is false with no tool observations at all", () => {
    expect(computeHasUnconsumedStoredEvidence([])).toBe(false);
  });

  it("is false when the observation carried no storedKey (small result, nothing compressed)", () => {
    const steps = [observationStep(undefined)];
    expect(computeHasUnconsumedStoredEvidence(steps)).toBe(false);
  });

  it("is TRUE when http-get's result was compressed to a storedKey and never recalled (the scratch.ts bug)", () => {
    const steps = [
      actionStep("http-get", { url: "https://en.wikipedia.org/wiki/X" }),
      observationStep("_tool_result_2"),
    ];
    expect(computeHasUnconsumedStoredEvidence(steps)).toBe(true);
  });

  it("is false once a later recall({key}) call retrieves that exact storedKey", () => {
    const steps = [
      actionStep("http-get", { url: "https://en.wikipedia.org/wiki/X" }),
      observationStep("_tool_result_2"),
      actionStep("recall", { key: "_tool_result_2", full: true }),
    ];
    expect(computeHasUnconsumedStoredEvidence(steps)).toBe(false);
  });

  it("stays TRUE when recall is called for a DIFFERENT key (evidence still unread)", () => {
    const steps = [
      actionStep("http-get", { url: "https://en.wikipedia.org/wiki/X" }),
      observationStep("_tool_result_2"),
      actionStep("recall", { key: "_tool_result_9" }),
    ];
    expect(computeHasUnconsumedStoredEvidence(steps)).toBe(true);
  });

  it("stays TRUE for a query-mode recall (keyword search does not guarantee the specific key was read)", () => {
    const steps = [
      actionStep("http-get", { url: "https://en.wikipedia.org/wiki/X" }),
      observationStep("_tool_result_2"),
      actionStep("recall", { query: "episode" }),
    ];
    expect(computeHasUnconsumedStoredEvidence(steps)).toBe(true);
  });
});
