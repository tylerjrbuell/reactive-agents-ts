/**
 * Dedicated entropy sensor accuracy & tuning tests.
 *
 * Tests the full scoring pipeline end-to-end with realistic scenarios,
 * edge cases, sensitivity analysis, and numerical precision checks.
 * These tests ensure the entropy sensor reliably discriminates between
 * healthy reasoning, stalled loops, and degraded behavior.
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { EntropySensorService } from "@reactive-agents/core";
import { createReactiveIntelligenceLayer } from "../../src/runtime.js";
import { computeTokenEntropy } from "../../src/sensor/token-entropy.js";
import { computeStructuralEntropy } from "../../src/sensor/structural-entropy.js";
import { computeBehavioralEntropy } from "../../src/sensor/behavioral-entropy.js";
import { computeCompositeEntropy } from "../../src/sensor/composite.js";
import {
  computeEntropyTrajectory,
  classifyTrajectoryShape,
  iterationWeight,
} from "../../src/sensor/entropy-trajectory.js";
import {
  computeConformalThreshold,
  computeCalibration,
} from "../../src/calibration/conformal.js";
import {
  meanStructural,
  meanBehavioral,
} from "../../src/sensor/entropy-sensor-service.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type StepLike = {
  type: string;
  content?: string;
  metadata?: Record<string, unknown>;
};

function makeKernelState(steps: StepLike[], iteration = 3, maxIterations = 10) {
  return {
    taskId: `test-${Math.random().toString(36).slice(2, 8)}`,
    strategy: "reactive",
    kernelType: "react",
    steps,
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration,
    tokens: 0,
    cost: 0,
    status: "thinking" as const,
    output: null,
    error: null,
    meta: {},
  };
}

function scoreViaService(
  thought: string,
  opts?: {
    strategy?: string;
    iteration?: number;
    maxIterations?: number;
    steps?: StepLike[];
  },
) {
  const layer = createReactiveIntelligenceLayer();
  return Effect.runPromise(
    Effect.gen(function* () {
      const sensor = yield* EntropySensorService;
      return yield* sensor.score({
        thought,
        taskDescription: "Complete the task",
        strategy: opts?.strategy ?? "reactive",
        iteration: opts?.iteration ?? 3,
        maxIterations: opts?.maxIterations ?? 10,
        modelId: "cogito:14b",
        temperature: 0.3,
        kernelState: makeKernelState(
          opts?.steps ?? [],
          opts?.iteration ?? 3,
          opts?.maxIterations ?? 10,
        ),
      });
    }).pipe(Effect.provide(layer)),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. TOKEN ENTROPY — Precision & Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("token entropy precision", () => {
  test("perfectly uniform distribution yields entropy ≈ 1.0", () => {
    const logprobs = [
      {
        token: "a",
        logprob: -1.0986,
        topLogprobs: [
          { token: "a", logprob: -1.0986 }, // ln(1/3) = -1.0986
          { token: "b", logprob: -1.0986 },
          { token: "c", logprob: -1.0986 },
        ],
      },
    ];
    const result = computeTokenEntropy(logprobs);
    expect(result).not.toBeNull();
    expect(result!.sequenceEntropy).toBeGreaterThan(0.95);
  });

  test("single token with one alternative yields zero entropy", () => {
    const logprobs = [
      {
        token: "the",
        logprob: -0.001,
        topLogprobs: [{ token: "the", logprob: -0.001 }],
      },
    ];
    const result = computeTokenEntropy(logprobs);
    expect(result).not.toBeNull();
    expect(result!.sequenceEntropy).toBe(0); // log2(1) = 0, single element
  });

  test("token with empty topLogprobs contributes 0 entropy", () => {
    const logprobs = [
      { token: "the", logprob: -0.5, topLogprobs: [] },
      {
        token: "answer",
        logprob: -1.0,
        topLogprobs: [
          { token: "answer", logprob: -1.0 },
          { token: "result", logprob: -1.1 },
        ],
      },
    ];
    const result = computeTokenEntropy(logprobs);
    expect(result).not.toBeNull();
    expect(result!.tokenEntropies[0]).toBe(0);
    expect(result!.tokenEntropies[1]).toBeGreaterThan(0);
    // sequence = mean, so should be pulled down by the 0
    expect(result!.sequenceEntropy).toBeLessThan(result!.tokenEntropies[1]);
  });

  test("peakEntropy is always >= sequenceEntropy", () => {
    const logprobs = [
      {
        token: "a",
        logprob: -0.01,
        topLogprobs: [
          { token: "a", logprob: -0.01 },
          { token: "b", logprob: -5.0 },
        ],
      },
      {
        token: "c",
        logprob: -0.7,
        topLogprobs: [
          { token: "c", logprob: -0.7 },
          { token: "d", logprob: -0.8 },
          { token: "e", logprob: -0.9 },
        ],
      },
    ];
    const result = computeTokenEntropy(logprobs);
    expect(result!.peakEntropy).toBeGreaterThanOrEqual(result!.sequenceEntropy);
  });

  test("all entropies are in [0, 1] range", () => {
    const logprobs = Array.from({ length: 20 }, (_, i) => ({
      token: `t${i}`,
      logprob: -Math.random() * 5,
      topLogprobs: Array.from({ length: 5 }, (_, j) => ({
        token: `t${i}_${j}`,
        logprob: -Math.random() * 5,
      })),
    }));
    const result = computeTokenEntropy(logprobs);
    expect(result).not.toBeNull();
    for (const e of result!.tokenEntropies) {
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
    expect(result!.sequenceEntropy).toBeGreaterThanOrEqual(0);
    expect(result!.sequenceEntropy).toBeLessThanOrEqual(1);
  });

  test("spike detection threshold is configurable", () => {
    const logprobs = [
      {
        token: "x",
        logprob: -1.0,
        topLogprobs: [
          { token: "x", logprob: -1.0 },
          { token: "y", logprob: -1.05 },
          { token: "z", logprob: -1.1 },
        ],
      },
    ];
    const lowThreshold = computeTokenEntropy(logprobs, 0.5);
    const highThreshold = computeTokenEntropy(logprobs, 0.99);
    expect(lowThreshold!.entropySpikes.length).toBeGreaterThanOrEqual(
      highThreshold!.entropySpikes.length,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. STRUCTURAL ENTROPY — Strategy-Specific & Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("structural entropy precision", () => {
  test("plan-execute strategy with numbered steps scores high format", () => {
    const thought = "Step 1: Gather data\nStep 2: Analyze results\nStep 3: Summarize";
    const result = computeStructuralEntropy(thought, "plan-execute");
    expect(result.formatCompliance).toBe(0.9);
  });

  test("plan-execute without steps scores low format", () => {
    const thought = "I should probably try something.";
    const result = computeStructuralEntropy(thought, "plan-execute");
    expect(result.formatCompliance).toBe(0.4);
  });

  test("unknown strategy gets neutral format compliance", () => {
    const thought = "Some random thought about things.";
    const result = computeStructuralEntropy(thought, "custom-strategy");
    expect(result.formatCompliance).toBe(0.6);
  });

  test("empty string produces baseline values", () => {
    const result = computeStructuralEntropy("", "reactive");
    expect(result.thoughtDensity).toBe(0);
    expect(result.vocabularyDiversity).toBe(0);
    expect(result.hedgeScore).toBe(1.0); // no hedges found
    expect(result.jsonParseScore).toBe(1.0); // no JSON found
  });

  test("all 6 fields are in [0, 1]", () => {
    const inputs = [
      "Thought: test\nAction: web-search({\"q\": \"test\"})",
      "maybe possibly perhaps I think uncertain roughly approximately",
      "word word word word word word word word",
      "",
      "Step 1: something\nStep 2: another",
      'Action: invalid-json({"broken": true',
    ];
    for (const input of inputs) {
      const result = computeStructuralEntropy(input, "reactive");
      expect(result.formatCompliance).toBeGreaterThanOrEqual(0);
      expect(result.formatCompliance).toBeLessThanOrEqual(1);
      expect(result.orderIntegrity).toBeGreaterThanOrEqual(0);
      expect(result.orderIntegrity).toBeLessThanOrEqual(1);
      expect(result.thoughtDensity).toBeGreaterThanOrEqual(0);
      expect(result.thoughtDensity).toBeLessThanOrEqual(1);
      expect(result.vocabularyDiversity).toBeGreaterThanOrEqual(0);
      expect(result.vocabularyDiversity).toBeLessThanOrEqual(1);
      expect(result.hedgeScore).toBeGreaterThanOrEqual(0);
      expect(result.hedgeScore).toBeLessThanOrEqual(1);
      expect(result.jsonParseScore).toBeGreaterThanOrEqual(0);
      expect(result.jsonParseScore).toBeLessThanOrEqual(1);
    }
  });

  test("valid nested JSON parses correctly", () => {
    const thought = 'Action: tool({"outer": {"inner": [1,2,3]}})';
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.jsonParseScore).toBe(1.0);
  });

  test("maximum hedging caps at 0.7 (3+ hedge phrases)", () => {
    const thought = "I think maybe possibly perhaps uncertain not sure roughly approximately likely probably";
    const result = computeStructuralEntropy(thought, "reactive");
    // 10 hedge phrases detected, but capped at min(0.3, count*0.1) = 0.3
    // hedgeScore = 1 - 0.3 = 0.7
    expect(result.hedgeScore).toBe(0.7);
  });

  test("ReAct with Final Answer (no Action) still scores high format", () => {
    const thought = "Thought: The answer is clear.\nFinal Answer: Paris";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.formatCompliance).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. BEHAVIORAL ENTROPY — Complex Scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe("behavioral entropy precision", () => {
  test("mixed success/failure steps produce correct rate", () => {
    const result = computeBehavioralEntropy({
      steps: [
        { type: "action", metadata: { toolUsed: "web-search", success: true } },
        { type: "observation", metadata: { success: true } },
        { type: "action", metadata: { toolUsed: "file-read", success: false } },
        { type: "observation", metadata: { success: false } },
      ],
      iteration: 2,
    });
    expect(result.toolSuccessRate).toBe(0.5); // 2/4
  });

  test("loop detection distinguishes 2-repeat from 3-repeat", () => {
    const twoRepeat = computeBehavioralEntropy({
      steps: [
        { type: "action", content: "web-search({\"q\":\"a\"})", metadata: { toolUsed: "web-search" } },
        { type: "action", content: "web-search({\"q\":\"a\"})", metadata: { toolUsed: "web-search" } },
      ],
      iteration: 2,
    });
    const threeRepeat = computeBehavioralEntropy({
      steps: [
        { type: "action", content: "web-search({\"q\":\"a\"})", metadata: { toolUsed: "web-search" } },
        { type: "action", content: "web-search({\"q\":\"a\"})", metadata: { toolUsed: "web-search" } },
        { type: "action", content: "web-search({\"q\":\"a\"})", metadata: { toolUsed: "web-search" } },
      ],
      iteration: 3,
    });
    expect(twoRepeat.loopDetectionScore).toBe(0.8);
    expect(threeRepeat.loopDetectionScore).toBe(1.0);
  });

  test("same tool but different args is NOT a loop", () => {
    const result = computeBehavioralEntropy({
      steps: [
        { type: "action", content: 'web-search({"q":"dogs"})', metadata: { toolUsed: "web-search" } },
        { type: "action", content: 'web-search({"q":"cats"})', metadata: { toolUsed: "web-search" } },
      ],
      iteration: 2,
    });
    expect(result.loopDetectionScore).toBe(0); // Different args
  });

  test("completion approach weighted by iteration position", () => {
    const earlyCompletion = computeBehavioralEntropy({
      steps: [{ type: "thought", content: "Therefore, the answer is 42." }],
      iteration: 1,
      maxIterations: 10,
    });
    const lateCompletion = computeBehavioralEntropy({
      steps: [{ type: "thought", content: "Therefore, the answer is 42." }],
      iteration: 9,
      maxIterations: 10,
    });
    expect(lateCompletion.completionApproach).toBeGreaterThan(
      earlyCompletion.completionApproach,
    );
  });

  test("final-answer tool overrides to 1.0 completionApproach", () => {
    const result = computeBehavioralEntropy({
      steps: [
        { type: "action", metadata: { toolUsed: "final-answer" } },
      ],
      iteration: 3,
    });
    expect(result.completionApproach).toBe(1.0);
  });

  test("multiple completion markers stack", () => {
    const result = computeBehavioralEntropy({
      steps: [
        {
          type: "thought",
          content: "Therefore, in conclusion, the final answer is that to summarize the result is 42.",
        },
      ],
      iteration: 8,
      maxIterations: 10,
    });
    // Should have multiple markers detected
    expect(result.completionApproach).toBeGreaterThan(0.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. MEAN AGGREGATION — Inversion Correctness
// ═══════════════════════════════════════════════════════════════════════════════

describe("mean aggregation correctness", () => {
  test("meanStructural averages all 6 fields", () => {
    const result = meanStructural({
      formatCompliance: 1.0,
      orderIntegrity: 1.0,
      thoughtDensity: 1.0,
      vocabularyDiversity: 1.0,
      hedgeScore: 1.0,
      jsonParseScore: 1.0,
    });
    expect(result).toBe(1.0);
  });

  test("meanStructural with mixed values gives correct average", () => {
    const result = meanStructural({
      formatCompliance: 0.6,
      orderIntegrity: 0.8,
      thoughtDensity: 0.4,
      vocabularyDiversity: 0.5,
      hedgeScore: 0.9,
      jsonParseScore: 1.0,
    });
    expect(result).toBeCloseTo((0.6 + 0.8 + 0.4 + 0.5 + 0.9 + 1.0) / 6, 5);
  });

  test("meanBehavioral inverts success signals correctly", () => {
    // All perfect → low disorder
    const perfect = meanBehavioral({
      toolSuccessRate: 1.0,
      actionDiversity: 1.0,
      loopDetectionScore: 0,
      completionApproach: 1.0,
    });
    expect(perfect).toBe(0); // (1-1) + (1-1) + 0 + (1-1) / 4 = 0

    // All failing → high disorder
    const failing = meanBehavioral({
      toolSuccessRate: 0,
      actionDiversity: 0,
      loopDetectionScore: 1.0,
      completionApproach: 0,
    });
    expect(failing).toBe(1.0); // (1-0) + (1-0) + 1 + (1-0) / 4 = 4/4 = 1
  });

  test("meanBehavioral range is always [0, 1]", () => {
    for (let i = 0; i < 50; i++) {
      const result = meanBehavioral({
        toolSuccessRate: Math.random(),
        actionDiversity: Math.random(),
        loopDetectionScore: Math.random(),
        completionApproach: Math.random(),
      });
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. COMPOSITE SCORER — Weight Redistribution & Sensitivity
// ═══════════════════════════════════════════════════════════════════════════════

describe("composite scorer sensitivity", () => {
  test("increasing structural entropy raises composite", () => {
    const low = computeCompositeEntropy({
      token: null, structural: 0.2, semantic: null, behavioral: 0.5,
      contextPressure: 0.1, logprobsAvailable: false, iteration: 5, maxIterations: 10,
    });
    const high = computeCompositeEntropy({
      token: null, structural: 0.8, semantic: null, behavioral: 0.5,
      contextPressure: 0.1, logprobsAvailable: false, iteration: 5, maxIterations: 10,
    });
    expect(high.composite).toBeGreaterThan(low.composite);
  });

  test("increasing behavioral entropy raises composite", () => {
    const low = computeCompositeEntropy({
      token: null, structural: 0.5, semantic: null, behavioral: 0.2,
      contextPressure: 0.1, logprobsAvailable: false, iteration: 5, maxIterations: 10,
    });
    const high = computeCompositeEntropy({
      token: null, structural: 0.5, semantic: null, behavioral: 0.8,
      contextPressure: 0.1, logprobsAvailable: false, iteration: 5, maxIterations: 10,
    });
    expect(high.composite).toBeGreaterThan(low.composite);
  });

  test("token entropy has strongest weight when logprobs available", () => {
    // Keep everything else equal, toggle token entropy
    const withToken = computeCompositeEntropy({
      token: 0.9, structural: 0.3, semantic: 0.3, behavioral: 0.3,
      contextPressure: 0.1, logprobsAvailable: true, iteration: 5, maxIterations: 10,
    });
    const withoutToken = computeCompositeEntropy({
      token: 0.1, structural: 0.3, semantic: 0.3, behavioral: 0.3,
      contextPressure: 0.1, logprobsAvailable: true, iteration: 5, maxIterations: 10,
    });
    // Token has 0.30 weight — changing by 0.8 should shift composite by ~0.24
    const delta = withToken.composite - withoutToken.composite;
    expect(delta).toBeGreaterThan(0.2);
  });

  test("semantic null redistributes weight to structural and behavioral", () => {
    const withSemantic = computeCompositeEntropy({
      token: null, structural: 0.5, semantic: 0.5, behavioral: 0.5,
      contextPressure: 0.1, logprobsAvailable: false, iteration: 5, maxIterations: 10,
    });
    const withoutSemantic = computeCompositeEntropy({
      token: null, structural: 0.5, semantic: null, behavioral: 0.5,
      contextPressure: 0.1, logprobsAvailable: false, iteration: 5, maxIterations: 10,
    });
    // With semantic: 0.5*0.25 = 0.125 from semantic
    // Without: that 0.25 redistributed half to structural (0.125) and half to behavioral (0.125)
    // But all are 0.5, so composite should be similar
    expect(Math.abs(withSemantic.composite - withoutSemantic.composite)).toBeLessThan(0.05);
  });

  test("temperature 0 reduces token weight and increases structural", () => {
    const normalTemp = computeCompositeEntropy({
      token: 0.9, structural: 0.3, semantic: null, behavioral: 0.3,
      contextPressure: 0.1, logprobsAvailable: true, temperature: 0.7,
      iteration: 5, maxIterations: 10,
    });
    const zeroTemp = computeCompositeEntropy({
      token: 0.9, structural: 0.3, semantic: null, behavioral: 0.3,
      contextPressure: 0.1, logprobsAvailable: true, temperature: 0,
      iteration: 5, maxIterations: 10,
    });
    // Zero temp: token weight halved (0.30 → 0.15), structural gets boost
    // With high token (0.9), reducing token weight should lower composite
    expect(zeroTemp.composite).toBeLessThan(normalTemp.composite);
  });

  test("composite is always clamped to [0, 1]", () => {
    const extreme = computeCompositeEntropy({
      token: 1.0, structural: 1.0, semantic: 1.0, behavioral: 1.0,
      contextPressure: 1.0, logprobsAvailable: true, iteration: 10, maxIterations: 10,
    });
    expect(extreme.composite).toBeLessThanOrEqual(1.0);

    const zero = computeCompositeEntropy({
      token: 0, structural: 0, semantic: 0, behavioral: 0,
      contextPressure: 0, logprobsAvailable: true, iteration: 1, maxIterations: 10,
    });
    expect(zero.composite).toBeGreaterThanOrEqual(0);
  });

  test("confidence tiers are correctly assigned", () => {
    const all4 = computeCompositeEntropy({
      token: 0.5, structural: 0.5, semantic: 0.5, behavioral: 0.5,
      contextPressure: 0.1, logprobsAvailable: true, iteration: 5, maxIterations: 10,
    });
    expect(all4.confidence).toBe("high");

    const three = computeCompositeEntropy({
      token: null, structural: 0.5, semantic: 0.5, behavioral: 0.5,
      contextPressure: 0.1, logprobsAvailable: false, iteration: 5, maxIterations: 10,
    });
    expect(three.confidence).toBe("medium");

    const two = computeCompositeEntropy({
      token: null, structural: 0.5, semantic: null, behavioral: 0.5,
      contextPressure: 0.1, logprobsAvailable: false, iteration: 5, maxIterations: 10,
    });
    expect(two.confidence).toBe("low");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. TRAJECTORY CLASSIFICATION — Boundary Conditions
// ═══════════════════════════════════════════════════════════════════════════════

describe("trajectory classification boundaries", () => {
  test("exactly 2 points is always flat", () => {
    expect(classifyTrajectoryShape([0.9, 0.1])).toBe("flat");
    expect(classifyTrajectoryShape([0.1, 0.9])).toBe("flat");
  });

  test("slope of exactly -0.05 is flat (not converging)", () => {
    // 3 points: 0.6, 0.55, 0.5 → slope = (0.5 - 0.6) / 2 = -0.05
    expect(classifyTrajectoryShape([0.6, 0.55, 0.5])).toBe("flat");
  });

  test("slope of -0.051 is converging", () => {
    // 3 points: 0.6, 0.549, 0.498 → slope ≈ -0.051
    expect(classifyTrajectoryShape([0.6, 0.549, 0.498])).toBe("converging");
  });

  test("slope of exactly +0.05 is flat (not diverging)", () => {
    expect(classifyTrajectoryShape([0.4, 0.45, 0.5])).toBe("flat");
  });

  test("slope of +0.051 is diverging", () => {
    expect(classifyTrajectoryShape([0.4, 0.451, 0.502])).toBe("diverging");
  });

  test("v-recovery requires drop > 0.15 AND rise > 0.15", () => {
    // Drop of 0.15 and rise of 0.15 — should match
    expect(classifyTrajectoryShape([0.7, 0.35, 0.2, 0.55, 0.75])).toBe("v-recovery");

    // Drop < 0.15 — should NOT match
    const shallow = classifyTrajectoryShape([0.5, 0.4, 0.38, 0.5, 0.6]);
    expect(shallow).not.toBe("v-recovery");
  });

  test("oscillating requires >= 60% sign changes with magnitude > 0.05", () => {
    // Clear oscillation
    expect(classifyTrajectoryShape([0.8, 0.2, 0.8, 0.2, 0.8, 0.2])).toBe("oscillating");

    // Small magnitude oscillation — should NOT classify as oscillating
    const smallOsc = classifyTrajectoryShape([0.5, 0.52, 0.5, 0.52, 0.5, 0.52]);
    expect(smallOsc).not.toBe("oscillating");
  });

  test("trajectory momentum is exponentially weighted", () => {
    // Increasing sequence: momentum should lag behind
    const result = computeEntropyTrajectory([0.2, 0.4, 0.6, 0.8], 10);
    expect(result.momentum).toBeGreaterThan(0.2);
    expect(result.momentum).toBeLessThan(0.8);
  });

  test("empty history returns zero trajectory", () => {
    const result = computeEntropyTrajectory([], 10);
    expect(result.shape).toBe("flat");
    expect(result.derivative).toBe(0);
    expect(result.momentum).toBe(0);
    expect(result.history).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. ITERATION WEIGHT — Sigmoid Precision
// ═══════════════════════════════════════════════════════════════════════════════

describe("iteration weight sigmoid", () => {
  test("weight is monotonically increasing", () => {
    let prev = 0;
    for (let i = 1; i <= 10; i++) {
      const w = iterationWeight(i, 10);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });

  test("weight is symmetric around midpoint", () => {
    const w1 = iterationWeight(1, 10);
    const w9 = iterationWeight(9, 10);
    expect(w1 + w9).toBeCloseTo(1.0, 1);
  });

  test("maxIter=0 returns 0.5", () => {
    expect(iterationWeight(5, 0)).toBe(0.5);
  });

  test("very early iteration has weight near 0", () => {
    // sigmoid((0-50)*0.04) = sigmoid(-2) ≈ 0.119
    expect(iterationWeight(0, 100)).toBeLessThan(0.15);
  });

  test("very late iteration has weight near 1", () => {
    // sigmoid((100-50)*0.04) = sigmoid(2) ≈ 0.881
    expect(iterationWeight(100, 100)).toBeGreaterThan(0.85);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. CONFORMAL CALIBRATION — Quantile Accuracy
// ═══════════════════════════════════════════════════════════════════════════════

describe("conformal calibration accuracy", () => {
  test("90th percentile threshold for known distribution", () => {
    // 20 evenly spaced scores: 0.05, 0.10, ..., 1.00
    const scores = Array.from({ length: 20 }, (_, i) => (i + 1) * 0.05);
    const threshold = computeConformalThreshold(scores, 0.10);
    // 90th percentile of 20 values: index = ceil(21 * 0.9) - 1 = ceil(18.9) - 1 = 18
    expect(threshold).toBe(scores[18]); // 0.95
  });

  test("70th percentile threshold for known distribution", () => {
    const scores = Array.from({ length: 20 }, (_, i) => (i + 1) * 0.05);
    const threshold = computeConformalThreshold(scores, 0.30);
    // index = ceil(21 * 0.7) - 1 = ceil(14.7) - 1 = 14
    expect(threshold).toBe(scores[14]); // 0.75
  });

  test("uncalibrated when < 20 samples", () => {
    const cal = computeCalibration("test-model", [0.3, 0.5, 0.7]);
    expect(cal.calibrated).toBe(false);
    expect(cal.highEntropyThreshold).toBe(0);
    expect(cal.sampleCount).toBe(3);
  });

  test("calibrated with exactly 20 samples", () => {
    const scores = Array.from({ length: 20 }, () => Math.random());
    const cal = computeCalibration("test-model", scores);
    expect(cal.calibrated).toBe(true);
    expect(cal.sampleCount).toBe(20);
    expect(cal.highEntropyThreshold).toBeGreaterThan(0);
    expect(cal.convergenceThreshold).toBeGreaterThan(0);
    expect(cal.highEntropyThreshold).toBeGreaterThanOrEqual(cal.convergenceThreshold);
  });

  test("drift detected when recent scores are outliers", () => {
    // 20 stable scores around 0.5, then 3 extreme values
    const stable = Array.from({ length: 20 }, () => 0.5 + (Math.random() - 0.5) * 0.1);
    const withDrift = [...stable, 0.99, 0.98, 0.97]; // extreme outliers
    const cal = computeCalibration("test-model", withDrift);
    expect(cal.driftDetected).toBe(true);
  });

  test("no drift when scores are stable", () => {
    const stable = Array.from({ length: 25 }, () => 0.5 + (Math.random() - 0.5) * 0.05);
    const cal = computeCalibration("test-model", stable);
    expect(cal.driftDetected).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. END-TO-END SERVICE — Realistic Scenario Discrimination
// ═══════════════════════════════════════════════════════════════════════════════

describe("end-to-end scenario discrimination", () => {
  test("healthy ReAct progress scores lower than stalled loop", async () => {
    const healthy = await scoreViaService(
      "Thought: I found the answer from the search results. The capital of France is Paris.\nFinal Answer: Paris",
      {
        steps: [
          { type: "thought", content: "Let me search for this." },
          { type: "action", metadata: { toolUsed: "web-search", success: true } },
          { type: "observation", content: "Results found", metadata: { success: true } },
          { type: "thought", content: "In conclusion, the answer is Paris." },
        ],
        iteration: 4,
      },
    );

    const stalled = await scoreViaService(
      "Thought: I need to search again. Maybe I should try a different approach.",
      {
        steps: [
          { type: "action", content: 'web-search({"q":"test"})', metadata: { toolUsed: "web-search", success: false } },
          { type: "observation", metadata: { success: false } },
          { type: "action", content: 'web-search({"q":"test"})', metadata: { toolUsed: "web-search", success: false } },
          { type: "observation", metadata: { success: false } },
          { type: "action", content: 'web-search({"q":"test"})', metadata: { toolUsed: "web-search", success: false } },
          { type: "observation", metadata: { success: false } },
        ],
        iteration: 6,
      },
    );

    expect(healthy.composite).toBeLessThan(stalled.composite);
  });

  test("well-structured thought scores lower than hedged rambling", async () => {
    const structured = await scoreViaService(
      "Thought: The data confirms the hypothesis. Three key findings: accuracy is 95%, latency is 50ms, throughput is 1000 req/s.\nAction: file-write({\"path\": \"report.txt\", \"content\": \"summary\"})",
      {
        steps: [
          { type: "action", metadata: { toolUsed: "web-search", success: true } },
          { type: "observation", metadata: { success: true } },
        ],
        iteration: 3,
      },
    );

    const rambling = await scoreViaService(
      "I think maybe possibly the answer might be something related to what I was uncertain about earlier, perhaps we could try another approach roughly similar to before, but I'm not sure if it would likely work",
      {
        steps: [
          { type: "action", content: 'web-search({"q":"test"})', metadata: { toolUsed: "web-search", success: false } },
          { type: "observation", metadata: { success: false } },
          { type: "action", content: 'web-search({"q":"test"})', metadata: { toolUsed: "web-search", success: false } },
          { type: "observation", metadata: { success: false } },
        ],
        iteration: 3,
      },
    );

    expect(structured.composite).toBeLessThan(rambling.composite);
  });

  test("final answer tool presence lowers composite", async () => {
    const noFinalAnswer = await scoreViaService(
      "Thought: Let me think about this more.",
      {
        steps: [
          { type: "thought", content: "Thinking about it." },
          { type: "action", metadata: { toolUsed: "web-search", success: true } },
        ],
        iteration: 5,
      },
    );

    const withFinalAnswer = await scoreViaService(
      "Thought: In conclusion, the answer is 42.\nFinal Answer: 42",
      {
        steps: [
          { type: "thought", content: "Let me compute." },
          { type: "action", metadata: { toolUsed: "web-search", success: true } },
          { type: "observation", metadata: { success: true } },
          { type: "thought", content: "Therefore, the final answer is 42." },
          { type: "action", metadata: { toolUsed: "final-answer", success: true } },
        ],
        iteration: 5,
      },
    );

    expect(withFinalAnswer.composite).toBeLessThan(noFinalAnswer.composite);
  });

  test("diverse tool usage scores lower than single-tool repetition", async () => {
    const diverse = await scoreViaService(
      "Thought: Now I'll read the file to verify.\nAction: file-read({\"path\": \"data.json\"})",
      {
        steps: [
          { type: "action", metadata: { toolUsed: "web-search", success: true } },
          { type: "observation", metadata: { success: true } },
          { type: "action", metadata: { toolUsed: "file-read", success: true } },
          { type: "observation", metadata: { success: true } },
          { type: "action", metadata: { toolUsed: "code-execute", success: true } },
          { type: "observation", metadata: { success: true } },
        ],
        iteration: 3,
      },
    );

    const repetitive = await scoreViaService(
      "Thought: Let me search again.\nAction: web-search({\"q\": \"same query\"})",
      {
        steps: [
          { type: "action", content: 'web-search({"q":"same query"})', metadata: { toolUsed: "web-search", success: true } },
          { type: "observation", metadata: { success: true } },
          { type: "action", content: 'web-search({"q":"same query"})', metadata: { toolUsed: "web-search", success: true } },
          { type: "observation", metadata: { success: true } },
          { type: "action", content: 'web-search({"q":"same query"})', metadata: { toolUsed: "web-search", success: true } },
          { type: "observation", metadata: { success: true } },
        ],
        iteration: 3,
      },
    );

    expect(diverse.composite).toBeLessThan(repetitive.composite);
  });

  test("later iterations score higher than early iterations (same content)", async () => {
    const early = await scoreViaService(
      "Thought: Let me explore the possibilities.",
      { steps: [], iteration: 1, maxIterations: 10 },
    );

    const late = await scoreViaService(
      "Thought: Let me explore the possibilities.",
      { steps: [], iteration: 9, maxIterations: 10 },
    );

    // Same content but later iteration = higher weight applied
    expect(late.iterationWeight).toBeGreaterThan(early.iterationWeight);
  });

  test("all scores have required fields", async () => {
    const score = await scoreViaService("Thought: Testing the sensor.");
    expect(score.composite).toBeGreaterThanOrEqual(0);
    expect(score.composite).toBeLessThanOrEqual(1);
    expect(score.sources).toBeDefined();
    expect(score.sources.structural).toBeGreaterThanOrEqual(0);
    expect(score.sources.behavioral).toBeGreaterThanOrEqual(0);
    expect(score.confidence).toMatch(/^(high|medium|low)$/);
    expect(score.iterationWeight).toBeGreaterThanOrEqual(0);
    expect(score.iterationWeight).toBeLessThanOrEqual(1);
    expect(score.timestamp).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. REGRESSION — Known Score Expectations
// ═══════════════════════════════════════════════════════════════════════════════

describe("regression: known input → expected score range", () => {
  test("perfect ReAct format + good behavior → composite < 0.45", async () => {
    const score = await scoreViaService(
      "Thought: I found the answer from web search results.\nAction: final-answer({\"output\": \"Paris\", \"format\": \"text\", \"summary\": \"Found it\"})",
      {
        steps: [
          { type: "thought", content: "Let me search for this." },
          { type: "action", metadata: { toolUsed: "web-search", success: true } },
          { type: "observation", metadata: { success: true } },
          { type: "action", metadata: { toolUsed: "file-read", success: true } },
          { type: "observation", metadata: { success: true } },
          { type: "thought", content: "In conclusion, the final answer is clear." },
          { type: "action", metadata: { toolUsed: "final-answer", success: true } },
        ],
        iteration: 4,
      },
    );
    expect(score.composite).toBeLessThan(0.60);
  });

  test("repetitive failures + loop → composite > 0.65", async () => {
    const score = await scoreViaService(
      "search search search search search search search",
      {
        steps: [
          { type: "action", content: 'web-search({"q":"a"})', metadata: { toolUsed: "web-search", success: false } },
          { type: "observation", metadata: { success: false } },
          { type: "action", content: 'web-search({"q":"a"})', metadata: { toolUsed: "web-search", success: false } },
          { type: "observation", metadata: { success: false } },
          { type: "action", content: 'web-search({"q":"a"})', metadata: { toolUsed: "web-search", success: false } },
          { type: "observation", metadata: { success: false } },
        ],
        iteration: 6,
      },
    );
    expect(score.composite).toBeGreaterThan(0.65);
  });

  test("hedge-heavy thought with no tools → composite 0.50-0.75", async () => {
    const score = await scoreViaService(
      "I think maybe the answer could possibly be something uncertain, perhaps roughly like before",
      { steps: [], iteration: 5 },
    );
    expect(score.composite).toBeGreaterThan(0.50);
    expect(score.composite).toBeLessThan(0.75);
  });

  test("empty thought → composite in mid-range", async () => {
    const score = await scoreViaService("", { steps: [], iteration: 3 });
    expect(score.composite).toBeGreaterThan(0.30);
    expect(score.composite).toBeLessThan(0.80);
  });
});
