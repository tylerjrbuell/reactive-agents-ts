// Run: bun test packages/reasoning/tests/kernel/capabilities/sense/finalize-result-abstention.test.ts --timeout 15000
//
// GH #206: the terminal mint (`finalizeStrategyResult`, the single boundary
// every strategy crosses) synthesizes an honest abstention when a run resolves
// to `failed` with no substantive output, and only then. Infra faults keep
// their real cause; a run with output is untouched.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { ReasoningStep } from "../../../../src/types/step.js";
import { finalizeStrategyResult } from "../../../../src/kernel/capabilities/sense/finalize-result.js";
import { provideTestEnvelope } from "../../../../src/kernel/envelope/run-envelope.js";

let seq = 0;
function step(
  type: ReasoningStep["type"],
  content: string,
  metadata?: ReasoningStep["metadata"],
): ReasoningStep {
  seq += 1;
  return {
    id: `m${seq}` as ReasoningStep["id"],
    type,
    content,
    timestamp: new Date(0),
    ...(metadata ? { metadata } : {}),
  };
}

const ATTEMPTED_STEPS: ReasoningStep[] = [
  step("thought", "I will search for the price."),
  step("action", "search", { toolCall: { id: "c1", name: "search", arguments: {} } }),
  step("observation", "rate limited", {
    observationResult: {
      success: false,
      toolName: "search",
      displayText: "rate limited",
      category: "web-search",
      resultKind: "error",
      preserveOnCompaction: false,
      trustLevel: "untrusted",
    },
  }),
];

function mint(params: {
  output: unknown;
  status: "completed" | "partial" | "failed";
  terminatedBy?: string;
  steps?: readonly ReasoningStep[];
}) {
  return Effect.runPromise(
    provideTestEnvelope(
      finalizeStrategyResult({
        strategy: "reactive",
        steps: params.steps ?? ATTEMPTED_STEPS,
        output: params.output,
        status: params.status,
        start: Date.now(),
        totalTokens: 10,
        totalCost: 0,
        extraMetadata: params.terminatedBy !== undefined ? { terminatedBy: params.terminatedBy } : {},
      }),
    ),
  );
}

describe("finalizeStrategyResult: GH #206 abstention synthesis", () => {
  it("synthesizes an honest abstention on failed + empty output (exhaustion terminal)", async () => {
    const result = await mint({ output: null, status: "failed", terminatedBy: "end_turn" });
    expect(result.status).toBe("failed");
    expect(result.output).toBe(
      "Could not complete the task within the available budget. " +
        "What was attempted: 1 tool call(s) attempted (search), 0 succeeded.",
    );
    expect((result.metadata as Record<string, unknown>).harnessAuthoredOutput).toBe(true);
  });

  it("does NOT synthesize for infrastructure faults (keeps the real cause)", async () => {
    const result = await mint({ output: null, status: "failed", terminatedBy: "llm_error" });
    expect(result.status).toBe("failed");
    expect(result.output == null || result.output === "").toBe(true);
    expect((result.metadata as Record<string, unknown>).harnessAuthoredOutput).toBeUndefined();
  });

  it("leaves a run that already produced output untouched", async () => {
    const result = await mint({ output: "The answer is 42.", status: "completed" });
    expect(result.output).toBe("The answer is 42.");
    expect((result.metadata as Record<string, unknown>).harnessAuthoredOutput).toBeUndefined();
  });

  it("leaves a failed run that already produced (rejected-content-free) output untouched", async () => {
    const result = await mint({ output: "partial findings", status: "failed", terminatedBy: "end_turn" });
    expect(result.output).toBe("partial findings");
  });
});
