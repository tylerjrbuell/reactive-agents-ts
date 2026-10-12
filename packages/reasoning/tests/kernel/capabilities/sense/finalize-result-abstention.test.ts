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
  rawTerminatedBy?: string;
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
        extraMetadata: {
          ...(params.terminatedBy !== undefined ? { terminatedBy: params.terminatedBy } : {}),
          ...(params.rawTerminatedBy !== undefined ? { rawTerminatedBy: params.rawTerminatedBy } : {}),
        },
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

// ── Give-up honesty gate: a run may not report success on a non-answer with
// nothing grounded behind it (e.g. loop_graceful / exhaustion + a model that
// says "the tools do not include X, so I cannot complete this"). ──
const GIVE_UP =
  "The available tools do not include a function for sending Slack messages. The task cannot be completed with the current toolset.";

const obsStep = (toolName: string): ReasoningStep =>
  step("observation", "observation body", {
    observationResult: {
      success: true,
      toolName,
      displayText: "x",
      category: "custom",
      resultKind: "data",
      preserveOnCompaction: false,
      trustLevel: "untrusted",
    },
  });

describe("finalizeStrategyResult: give-up honesty gate", () => {
  it("downgrades a completed give-up with no grounding to an abstention", async () => {
    const result = await mint({
      output: GIVE_UP,
      status: "completed",
      terminatedBy: "end_turn",
      steps: [step("thought", "hmm"), obsStep("recall")],
    });
    const md = result.metadata as Record<string, unknown>;
    expect(md.terminatedBy).toBe("abstained");
    expect(md.abstention).toBeDefined();
    // The model's own explanation is preserved as the output.
    expect(result.output).toBe(GIVE_UP);
  });

  it("does NOT downgrade when the run grounded real evidence", async () => {
    const result = await mint({
      output: GIVE_UP,
      status: "completed",
      terminatedBy: "end_turn",
      steps: [obsStep("web-search")],
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("end_turn");
  });

  it("does NOT downgrade a real answer", async () => {
    const result = await mint({
      output: "Hello, team! This is a test message.",
      status: "completed",
      terminatedBy: "end_turn",
      steps: [obsStep("recall")],
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("end_turn");
  });

  it("downgrades on a harness-forced terminal even when the phrasing is unrecognized", async () => {
    const result = await mint({
      output: "The task requires sending a Slack message, but none of the available tools support this action right now.",
      status: "completed",
      terminatedBy: "end_turn",
      rawTerminatedBy: "loop_graceful",
      steps: [obsStep("recall")],
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("abstained");
  });

  it("leaves a run that already abstained untouched (does not clobber its descriptor)", async () => {
    const result = await mint({
      output: "Could not complete the task: no grounded answer could be produced from the available tools.",
      status: "completed",
      terminatedBy: "abstained",
      steps: [obsStep("recall")],
    });
    expect((result.metadata as Record<string, unknown>).terminatedBy).toBe("abstained");
    expect((result.metadata as Record<string, unknown>).abstention).toBeUndefined();
  });
});
