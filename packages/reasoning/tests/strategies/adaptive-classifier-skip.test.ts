// File: tests/strategies/adaptive-classifier-skip.test.ts
//
// W2d 2.6 — adaptive classify site (GH #240). When classifierReliability is
// "low" or "skip", the LLM classify round-trip is skipped entirely and the
// strategy defaults to reactive. Trusted/absent reliability keeps the LLM
// classify call (no regression).
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const baseCalibration: ModelCalibration = {
  modelId: "classifier-skip-test",
  calibratedAt: new Date(0).toISOString(),
  probeVersion: 1,
  runsAveraged: 1,
  steeringCompliance: "hybrid",
  parallelCallCapability: "sequential-only",
  observationHandling: "uses-recall",
  systemPromptAttention: "moderate",
  optimalToolResultChars: 800,
};

const lowReliability = { ...baseCalibration, classifierReliability: "low" as const };
const highReliability = { ...baseCalibration, classifierReliability: "high" as const };

// Ambiguous task: no tools, long enough to escape "short task → reactive",
// matches none of the heuristic patterns → heuristicClassify returns null →
// the LLM classify branch (the site under test) is reached.
const AMBIGUOUS_TASK =
  "write a detailed comprehensive analysis of the subject matter covering all relevant aspects thoroughly and completely";

// Non-trivial taskClassification so `classifyTask` is bypassed and
// `heuristicClassify` returns null for AMBIGUOUS_TASK, reaching the
// classifier-skip branch.
const COMPLEX_CLASSIFICATION = {
  complexity: { complexity: "complex", reason: "test", confidence: 0.9 },
  intent: { format: null, cues: [], expectedContent: [], expectedEntities: [] },
  shape: {
    complexity: "complex",
    needsTools: false,
    needsMultiStep: false,
    needsCitation: false,
    needsStructuredOutput: false,
    expectedOutputForm: "explanation",
    highConfidence: true,
    reason: "test",
  },
  horizon: { horizon: "short", reason: "test", confidence: 0.9 },
};

const reactiveLayer = TestLLMServiceLayer([
  { match: "Think step-by-step", text: "FINAL ANSWER: done." },
]);

const classifyAndReactiveLayer = TestLLMServiceLayer([
  { match: "Classify the task", text: "REACTIVE" },
  { match: "Think step-by-step", text: "FINAL ANSWER: done." },
]);

describe("adaptive classifier-skip (GH #240)", () => {
  it("classifierReliability 'low' skips the LLM classify call and defaults to reactive", async () => {
    // No "Classify the task" response is provided — if the classify call
    // fired, the run would fail. Providing only the reactive response proves
    // classify was skipped.
    const program = executeAdaptive({
      taskDescription: AMBIGUOUS_TASK,
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
      calibration: lowReliability,
      taskClassification: COMPLEX_CLASSIFICATION,
    });

    const result = await Effect.runPromise(
      provideTestEnvelope(program.pipe(Effect.provide(reactiveLayer))),
    );

    expect(result.strategy).toBe("adaptive");
    expect(result.status).toBe("completed");
    const skipStep = result.steps.find((s) =>
      s.content.includes("Classifier skipped"),
    );
    expect(skipStep).toBeDefined();
    expect(skipStep!.content).toContain("reactive");
  });

  it("classifierReliability 'high' still consults the LLM classify call", async () => {
    const program = executeAdaptive({
      taskDescription: AMBIGUOUS_TASK,
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
      calibration: highReliability,
      taskClassification: COMPLEX_CLASSIFICATION,
    });

    const result = await Effect.runPromise(
      provideTestEnvelope(
        program.pipe(Effect.provide(classifyAndReactiveLayer)),
      ),
    );

    expect(result.strategy).toBe("adaptive");
    expect(result.status).toBe("completed");
    const classifyStep = result.steps.find((s) =>
      s.content.includes("Selected strategy"),
    );
    expect(classifyStep).toBeDefined();
  });
});
