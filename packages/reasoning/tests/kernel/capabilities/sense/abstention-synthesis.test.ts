// Run: bun test packages/reasoning/tests/kernel/capabilities/sense/abstention-synthesis.test.ts --timeout 15000
//
// GH #206: honest abstention synthesis on effort exhaustion.
//
// A run that stops after effort (iteration/tool budget exhausted, or its
// terminal was rejected) with no verified output must ship a deterministic
// abstention naming what was attempted, not empty output. These tests pin the
// two decisions the synthesis rests on: WHEN to synthesize (which terminals)
// and WHAT to say (the attempts summary). Both are pure; the mint that wires
// them is covered in finalize-result-abstention.test.ts.
import { describe, it, expect } from "bun:test";
import type { ReasoningStep } from "../../../../src/types/step.js";
import {
  shouldSynthesizeAbstention,
  summarizeAttempts,
} from "../../../../src/kernel/capabilities/sense/abstention-synthesis.js";

let seq = 0;
function step(
  type: ReasoningStep["type"],
  metadata?: ReasoningStep["metadata"],
): ReasoningStep {
  seq += 1;
  return {
    id: `s${seq}` as ReasoningStep["id"],
    type,
    content: `${type} content`,
    timestamp: new Date(0),
    ...(metadata ? { metadata } : {}),
  };
}

describe("shouldSynthesizeAbstention: which terminals get an abstention", () => {
  it("fires for exhaustion / model-gave-up terminals", () => {
    for (const reason of [
      "end_turn",
      "llm_end_turn",
      "max_iterations",
      "budget_exceeded",
      "loop_graceful",
      "controller_early_stop:low_delta",
      undefined,
    ]) {
      expect(shouldSynthesizeAbstention(reason)).toBe(true);
    }
  });

  it("never fires for infrastructure faults (keep the real provider cause)", () => {
    expect(shouldSynthesizeAbstention("llm_error")).toBe(false);
    expect(shouldSynthesizeAbstention("kernel_error")).toBe(false);
  });
});

describe("summarizeAttempts: deterministic what-was-attempted summary", () => {
  it("reports 'no tool calls were made' when only thoughts exist", () => {
    expect(summarizeAttempts([step("thought"), step("thought")])).toBe(
      "no tool calls were made",
    );
  });

  it("counts attempted calls, names the tools, and counts successes", () => {
    const steps: ReasoningStep[] = [
      step("thought"),
      step("action", { toolCall: { id: "c1", name: "bench_web_search", arguments: {} } }),
      step("observation", {
        observationResult: {
          success: false,
          toolName: "bench_web_search",
          displayText: "rate limited",
          category: "web-search",
          resultKind: "error",
          preserveOnCompaction: false,
          trustLevel: "untrusted",
        },
      }),
    ];
    expect(summarizeAttempts(steps)).toBe(
      "1 tool call(s) attempted (bench_web_search), 0 succeeded",
    );
  });

  it("dedupes tool names and counts successes across steps", () => {
    const ok = (toolName: string): ReasoningStep["metadata"] => ({
      observationResult: {
        success: true,
        toolName,
        displayText: "ok",
        category: "data",
        resultKind: "data",
        preserveOnCompaction: false,
        trustLevel: "untrusted",
      },
    });
    const steps: ReasoningStep[] = [
      step("action", { toolCall: { id: "a", name: "search", arguments: {} } }),
      step("observation", ok("search") as ReasoningStep["metadata"]),
      step("action", { toolCall: { id: "b", name: "read", arguments: {} } }),
      step("observation", ok("read") as ReasoningStep["metadata"]),
      step("action", { toolCall: { id: "c", name: "search", arguments: {} } }),
      step("observation", ok("search") as ReasoningStep["metadata"]),
    ];
    expect(summarizeAttempts(steps)).toBe(
      "3 tool call(s) attempted (search, read), 3 succeeded",
    );
  });
});
