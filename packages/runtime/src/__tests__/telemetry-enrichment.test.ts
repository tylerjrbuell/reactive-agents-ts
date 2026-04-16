import { describe, test, expect } from "bun:test";
import {
  buildTrajectoryFingerprint,
  abstractifyToolName,
  firstConvergenceIteration,
  peakContextPressure,
  deriveTaskComplexity,
  deriveFailurePattern,
  deriveThoughtToActionRatio,
  entropyVariance,
  entropyOscillationCount,
  finalCompositeEntropy,
  entropyAreaUnderCurve,
  type EntropyEntry,
} from "../telemetry-enrichment.js";

// ─── Helpers ───

function makeEntry(shape: string, contextPressure = 0.3): EntropyEntry {
  return {
    iteration: 1,
    composite: 0.5,
    sources: { token: null, structural: 0.5, semantic: null, behavioral: 0.5, contextPressure },
    trajectory: { derivative: 0, shape, momentum: 0 },
    confidence: "medium",
  };
}

// ─── buildTrajectoryFingerprint ───

describe("buildTrajectoryFingerprint", () => {
  test("empty log returns undefined", () => {
    expect(buildTrajectoryFingerprint([])).toBeUndefined();
  });

  test("single shape", () => {
    expect(buildTrajectoryFingerprint([makeEntry("flat")])).toBe("flat-1");
  });

  test("run-length encodes repeated shapes", () => {
    const log = [makeEntry("flat"), makeEntry("flat"), makeEntry("converging"), makeEntry("converging"), makeEntry("converging")];
    expect(buildTrajectoryFingerprint(log)).toBe("flat-2:converging-3");
  });

  test("alternating shapes are not merged", () => {
    const log = [makeEntry("flat"), makeEntry("converging"), makeEntry("flat")];
    expect(buildTrajectoryFingerprint(log)).toBe("flat-1:converging-1:flat-1");
  });

  test("v-recovery trajectory", () => {
    const log = [makeEntry("flat"), makeEntry("diverging"), makeEntry("v-recovery"), makeEntry("v-recovery"), makeEntry("converging")];
    expect(buildTrajectoryFingerprint(log)).toBe("flat-1:diverging-1:v-recovery-2:converging-1");
  });
});

// ─── abstractifyToolName ───

describe("abstractifyToolName", () => {
  test("search tools", () => {
    expect(abstractifyToolName("web-search")).toBe("search");
    expect(abstractifyToolName("tavily-search")).toBe("search");
    expect(abstractifyToolName("google-lookup")).toBe("search");
    expect(abstractifyToolName("query-db")).toBe("search");
  });

  test("write tools", () => {
    expect(abstractifyToolName("write-file")).toBe("write");
    expect(abstractifyToolName("save-document")).toBe("write");
    expect(abstractifyToolName("create-file")).toBe("write");
    expect(abstractifyToolName("edit-content")).toBe("write");
  });

  test("read tools", () => {
    expect(abstractifyToolName("read-file")).toBe("read");
    expect(abstractifyToolName("web-fetch")).toBe("read");
    expect(abstractifyToolName("get-page")).toBe("read");
    expect(abstractifyToolName("list-dir")).toBe("read");
  });

  test("compute tools", () => {
    expect(abstractifyToolName("bash")).toBe("compute");
    expect(abstractifyToolName("code-exec")).toBe("compute");
    expect(abstractifyToolName("python-run")).toBe("compute");
    expect(abstractifyToolName("calculate-sum")).toBe("compute");
  });

  test("communicate tools", () => {
    expect(abstractifyToolName("send-email")).toBe("communicate");
    expect(abstractifyToolName("slack-notify")).toBe("communicate");
    expect(abstractifyToolName("post-webhook")).toBe("communicate");
    expect(abstractifyToolName("message-user")).toBe("communicate");
  });

  test("framework meta-tools fall through to unknown", () => {
    expect(abstractifyToolName("activate_skill")).toBe("unknown");
    expect(abstractifyToolName("final-answer")).toBe("unknown");
    expect(abstractifyToolName("context-status")).toBe("unknown");
    expect(abstractifyToolName("task-complete")).toBe("unknown");
  });

  test("case-insensitive matching", () => {
    expect(abstractifyToolName("WebSearch")).toBe("search");
    expect(abstractifyToolName("WRITE_FILE")).toBe("write");
  });

  test("search takes priority over write when name contains both", () => {
    // "search" checked before "write" — "search-and-write" → search
    expect(abstractifyToolName("search-and-write")).toBe("search");
  });
});

// ─── firstConvergenceIteration ───

describe("firstConvergenceIteration", () => {
  test("empty log returns null", () => {
    expect(firstConvergenceIteration([])).toBeNull();
  });

  test("never converges returns null", () => {
    const log = [makeEntry("flat"), makeEntry("flat"), makeEntry("diverging")];
    expect(firstConvergenceIteration(log)).toBeNull();
  });

  test("converges at first iteration returns 1", () => {
    const log = [makeEntry("converging"), makeEntry("converging")];
    expect(firstConvergenceIteration(log)).toBe(1);
  });

  test("returns 1-based index of first converging entry", () => {
    const log = [makeEntry("flat"), makeEntry("flat"), makeEntry("converging"), makeEntry("converging")];
    expect(firstConvergenceIteration(log)).toBe(3);
  });
});

// ─── peakContextPressure ───

describe("peakContextPressure", () => {
  test("empty log returns undefined", () => {
    expect(peakContextPressure([])).toBeUndefined();
  });

  test("single entry returns its pressure", () => {
    expect(peakContextPressure([makeEntry("flat", 0.45)])).toBe(0.45);
  });

  test("returns max across all entries", () => {
    const log = [makeEntry("flat", 0.3), makeEntry("flat", 0.85), makeEntry("converging", 0.6)];
    expect(peakContextPressure(log)).toBe(0.85);
  });
});

// ─── deriveTaskComplexity ───

describe("deriveTaskComplexity", () => {
  test("trivial: 0 tools, 1 real iteration, no strategy switch", () => {
    expect(deriveTaskComplexity(1, 0, false, 0.2)).toBe("trivial");
  });

  test("trivial: 0 tools, 0 real iterations (chat run)", () => {
    expect(deriveTaskComplexity(0, 0, false, undefined)).toBe("trivial");
  });

  test("moderate: 2 tools, 3 iterations, no strategy switch", () => {
    expect(deriveTaskComplexity(3, 2, false, 0.4)).toBe("moderate");
  });

  test("moderate: 1 tool, 2 iterations", () => {
    expect(deriveTaskComplexity(2, 1, false, 0.3)).toBe("moderate");
  });

  test("complex: 3-5 tools, 4-6 iterations, no strategy switch, low pressure", () => {
    expect(deriveTaskComplexity(5, 4, false, 0.5)).toBe("complex");
  });

  test("expert: strategy switched", () => {
    expect(deriveTaskComplexity(2, 2, true, 0.3)).toBe("expert");
  });

  test("expert: more than 5 tool calls", () => {
    expect(deriveTaskComplexity(4, 6, false, 0.3)).toBe("expert");
  });

  test("expert: more than 6 real iterations", () => {
    expect(deriveTaskComplexity(7, 3, false, 0.3)).toBe("expert");
  });

  test("expert: context pressure > 0.8", () => {
    expect(deriveTaskComplexity(2, 2, false, 0.85)).toBe("expert");
  });

  test("expert thresholds: boundary at exactly 6 iterations is complex, 7 is expert", () => {
    expect(deriveTaskComplexity(6, 3, false, 0.5)).toBe("complex");
    expect(deriveTaskComplexity(7, 3, false, 0.5)).toBe("expert");
  });
});

// ─── deriveFailurePattern ───

describe("deriveFailurePattern", () => {
  test("success returns undefined", () => {
    expect(deriveFailurePattern("success", "final_answer_tool", [], 0.5)).toBeUndefined();
  });

  test("context pressure > 0.95 → context-overflow", () => {
    expect(deriveFailurePattern("failure", "end_turn", [], 0.96)).toBe("context-overflow");
    expect(deriveFailurePattern("partial", "max_iterations", [], 0.97)).toBe("context-overflow");
  });

  test("max_iterations without high pressure → loop-detected", () => {
    expect(deriveFailurePattern("partial", "max_iterations", [], 0.5)).toBe("loop-detected");
  });

  test("max_iterations with exactly 0.95 pressure → loop-detected (not context-overflow)", () => {
    expect(deriveFailurePattern("partial", "max_iterations", [], 0.95)).toBe("loop-detected");
  });

  test("guardrail error → guardrail-halt", () => {
    expect(deriveFailurePattern("failure", "end_turn", ["Guardrail triggered"], 0.3)).toBe("guardrail-halt");
  });

  test("timeout error → timeout", () => {
    expect(deriveFailurePattern("failure", "end_turn", ["timeout exceeded"], 0.3)).toBe("timeout");
  });

  test("strategy error → strategy-exhausted", () => {
    expect(deriveFailurePattern("failure", "end_turn", ["strategy fallback failed"], 0.3)).toBe("strategy-exhausted");
  });

  test("tool errors → tool-cascade-failure", () => {
    expect(deriveFailurePattern("failure", "end_turn", ["Tool web-search failed"], 0.3)).toBe("tool-cascade-failure");
  });

  test("failure with no recognizable pattern → unknown", () => {
    expect(deriveFailurePattern("failure", "end_turn", ["some other error"], 0.3)).toBe("unknown");
  });

  test("priority: context-overflow checked before loop-detected", () => {
    expect(deriveFailurePattern("partial", "max_iterations", [], 0.99)).toBe("context-overflow");
  });

  test("priority: guardrail checked before tool errors", () => {
    expect(deriveFailurePattern("failure", "end_turn", ["Tool x failed", "Guardrail injection detected"], 0.3)).toBe("guardrail-halt");
  });
});

// ─── deriveThoughtToActionRatio ───

describe("deriveThoughtToActionRatio", () => {
  test("0 tool calls returns undefined", () => {
    expect(deriveThoughtToActionRatio([{ type: "thought" }, { type: "thought" }], 0)).toBeUndefined();
  });

  test("counts thought, plan, reflection, critique as reasoning steps", () => {
    const steps = [
      { type: "thought" },
      { type: "plan" },
      { type: "reflection" },
      { type: "critique" },
      { type: "action" },
      { type: "observation" },
    ];
    // 4 reasoning steps / 2 tool calls
    expect(deriveThoughtToActionRatio(steps, 2)).toBe(2);
  });

  test("does not count action or observation as reasoning", () => {
    const steps = [{ type: "action" }, { type: "observation" }, { type: "action" }, { type: "observation" }];
    expect(deriveThoughtToActionRatio(steps, 2)).toBe(0);
  });

  test("ratio less than 1 when more tool calls than thoughts", () => {
    const steps = [{ type: "thought" }];
    expect(deriveThoughtToActionRatio(steps, 4)).toBe(0.25);
  });

  test("empty steps with tool calls returns 0", () => {
    expect(deriveThoughtToActionRatio([], 3)).toBe(0);
  });
});

// ─── Shared trace fixtures for new entropy features ───

const flatTrace: EntropyEntry[] = [
  { iteration: 1, composite: 0.5, sources: { token: null, structural: 0.5, semantic: null, behavioral: 0.5, contextPressure: 0.3 }, trajectory: { derivative: 0, shape: "flat", momentum: 0 }, confidence: "high" },
  { iteration: 2, composite: 0.5, sources: { token: null, structural: 0.5, semantic: null, behavioral: 0.5, contextPressure: 0.3 }, trajectory: { derivative: 0, shape: "flat", momentum: 0 }, confidence: "high" },
  { iteration: 3, composite: 0.5, sources: { token: null, structural: 0.5, semantic: null, behavioral: 0.5, contextPressure: 0.3 }, trajectory: { derivative: 0, shape: "flat", momentum: 0 }, confidence: "high" },
];

const oscillatingTrace: EntropyEntry[] = [
  { iteration: 1, composite: 0.3, sources: { token: null, structural: 0.3, semantic: null, behavioral: 0.3, contextPressure: 0.2 }, trajectory: { derivative: +0.3, shape: "rising", momentum: 0 }, confidence: "medium" },
  { iteration: 2, composite: 0.6, sources: { token: null, structural: 0.6, semantic: null, behavioral: 0.6, contextPressure: 0.4 }, trajectory: { derivative: -0.3, shape: "falling", momentum: 0 }, confidence: "medium" },
  { iteration: 3, composite: 0.3, sources: { token: null, structural: 0.3, semantic: null, behavioral: 0.3, contextPressure: 0.2 }, trajectory: { derivative: +0.3, shape: "rising", momentum: 0 }, confidence: "medium" },
  { iteration: 4, composite: 0.6, sources: { token: null, structural: 0.6, semantic: null, behavioral: 0.6, contextPressure: 0.4 }, trajectory: { derivative: -0.3, shape: "falling", momentum: 0 }, confidence: "medium" },
];

const singlePointTrace: EntropyEntry[] = [
  { iteration: 1, composite: 0.7, sources: { token: null, structural: 0.7, semantic: null, behavioral: 0.7, contextPressure: 0.5 }, trajectory: { derivative: 0, shape: "flat", momentum: 0 }, confidence: "high" },
];

const monotonicDecreasingTrace: EntropyEntry[] = [
  { iteration: 1, composite: 0.8, sources: { token: null, structural: 0.8, semantic: null, behavioral: 0.8, contextPressure: 0.6 }, trajectory: { derivative: -0.2, shape: "falling", momentum: 0 }, confidence: "medium" },
  { iteration: 2, composite: 0.6, sources: { token: null, structural: 0.6, semantic: null, behavioral: 0.6, contextPressure: 0.5 }, trajectory: { derivative: -0.2, shape: "falling", momentum: 0 }, confidence: "medium" },
  { iteration: 3, composite: 0.4, sources: { token: null, structural: 0.4, semantic: null, behavioral: 0.4, contextPressure: 0.4 }, trajectory: { derivative: -0.2, shape: "falling", momentum: 0 }, confidence: "high" },
  { iteration: 4, composite: 0.2, sources: { token: null, structural: 0.2, semantic: null, behavioral: 0.2, contextPressure: 0.3 }, trajectory: { derivative: -0.2, shape: "falling", momentum: 0 }, confidence: "high" },
];

// ─── entropyVariance ───

describe("entropyVariance", () => {
  test("empty trace returns 0", () => {
    expect(entropyVariance([])).toBe(0);
  });

  test("flat trace returns 0 (or extremely close)", () => {
    expect(entropyVariance(flatTrace)).toBeCloseTo(0, 10);
  });

  test("oscillating trace returns positive value", () => {
    expect(entropyVariance(oscillatingTrace)).toBeGreaterThan(0);
  });

  test("single-point trace returns 0", () => {
    expect(entropyVariance(singlePointTrace)).toBe(0);
  });

  test("monotonic decreasing trace returns positive value (not zero)", () => {
    expect(entropyVariance(monotonicDecreasingTrace)).toBeGreaterThan(0);
  });

  test("result is never NaN or Infinity for any standard trace shape", () => {
    const traces = [[], flatTrace, oscillatingTrace, singlePointTrace, monotonicDecreasingTrace];
    for (const trace of traces) {
      const v = entropyVariance(trace);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ─── entropyOscillationCount ───

describe("entropyOscillationCount", () => {
  test("empty trace returns 0", () => {
    expect(entropyOscillationCount([])).toBe(0);
  });

  test("flat trace (all zero derivatives) returns 0", () => {
    expect(entropyOscillationCount(flatTrace)).toBe(0);
  });

  test("oscillating trace (+,-,+,-) counts 2 sign flips", () => {
    // Signs: +0.3, -0.3, +0.3, -0.3 → transitions: (+→-), (-→+), (+→-) = 3 flips
    // Wait: first non-zero is +, second is -, that's flip 1; then - to +, flip 2; then + to -, flip 3
    expect(entropyOscillationCount(oscillatingTrace)).toBe(3);
  });

  test("single point returns 0", () => {
    expect(entropyOscillationCount(singlePointTrace)).toBe(0);
  });

  test("monotonic decreasing (all negative) returns 0", () => {
    expect(entropyOscillationCount(monotonicDecreasingTrace)).toBe(0);
  });

  test("zeros are ignored: sign flips counted across non-zero derivatives only", () => {
    const mixedTrace: EntropyEntry[] = [
      { iteration: 1, composite: 0.5, sources: { token: null, structural: 0.5, semantic: null, behavioral: 0.5, contextPressure: 0.3 }, trajectory: { derivative: +0.2, shape: "rising", momentum: 0 }, confidence: "medium" },
      { iteration: 2, composite: 0.5, sources: { token: null, structural: 0.5, semantic: null, behavioral: 0.5, contextPressure: 0.3 }, trajectory: { derivative: 0, shape: "flat", momentum: 0 }, confidence: "medium" },
      { iteration: 3, composite: 0.5, sources: { token: null, structural: 0.5, semantic: null, behavioral: 0.5, contextPressure: 0.3 }, trajectory: { derivative: -0.2, shape: "falling", momentum: 0 }, confidence: "medium" },
    ];
    // zero doesn't break the run: +0.2, 0(skip), -0.2 → 1 flip
    expect(entropyOscillationCount(mixedTrace)).toBe(1);
  });

  test("result is never NaN or Infinity for any standard trace shape", () => {
    const traces = [[], flatTrace, oscillatingTrace, singlePointTrace, monotonicDecreasingTrace];
    for (const trace of traces) {
      const o = entropyOscillationCount(trace);
      expect(Number.isFinite(o)).toBe(true);
    }
  });
});

// ─── finalCompositeEntropy ───

describe("finalCompositeEntropy", () => {
  test("empty trace returns null", () => {
    expect(finalCompositeEntropy([])).toBeNull();
  });

  test("flat trace returns last value (0.5)", () => {
    expect(finalCompositeEntropy(flatTrace)).toBe(0.5);
  });

  test("oscillating trace returns last value (0.6)", () => {
    expect(finalCompositeEntropy(oscillatingTrace)).toBe(0.6);
  });

  test("single-point trace returns its composite value (0.7)", () => {
    expect(finalCompositeEntropy(singlePointTrace)).toBe(0.7);
  });

  test("result is never NaN or Infinity when trace is non-empty", () => {
    const traces = [flatTrace, oscillatingTrace, singlePointTrace, monotonicDecreasingTrace];
    for (const trace of traces) {
      const f = finalCompositeEntropy(trace);
      if (f !== null) expect(Number.isFinite(f)).toBe(true);
    }
  });
});

// ─── entropyAreaUnderCurve ───

describe("entropyAreaUnderCurve", () => {
  test("empty trace returns 0", () => {
    expect(entropyAreaUnderCurve([])).toBe(0);
  });

  test("single-point trace returns 0 (need ≥2 points for trapezoid)", () => {
    expect(entropyAreaUnderCurve(singlePointTrace)).toBe(0);
  });

  test("flat trace at 0.5 for 3 iters → AUC ≈ 1.0", () => {
    // Two trapezoids: [(0.5+0.5)/2 * 1] + [(0.5+0.5)/2 * 1] = 0.5 + 0.5 = 1.0
    expect(entropyAreaUnderCurve(flatTrace)).toBeCloseTo(1.0, 10);
  });

  test("oscillating trace computes correct trapezoidal AUC", () => {
    // Iterations 1→2→3→4, widths all 1
    // Trapezoids: (0.3+0.6)/2*1 + (0.6+0.3)/2*1 + (0.3+0.6)/2*1 = 0.45 + 0.45 + 0.45 = 1.35
    expect(entropyAreaUnderCurve(oscillatingTrace)).toBeCloseTo(1.35, 10);
  });

  test("non-uniform iteration spacing uses iteration delta as width", () => {
    const nonUniformTrace: EntropyEntry[] = [
      { iteration: 1, composite: 0.4, sources: { token: null, structural: 0.4, semantic: null, behavioral: 0.4, contextPressure: 0.3 }, trajectory: { derivative: 0, shape: "flat", momentum: 0 }, confidence: "medium" },
      { iteration: 3, composite: 0.4, sources: { token: null, structural: 0.4, semantic: null, behavioral: 0.4, contextPressure: 0.3 }, trajectory: { derivative: 0, shape: "flat", momentum: 0 }, confidence: "medium" },
      { iteration: 10, composite: 0.4, sources: { token: null, structural: 0.4, semantic: null, behavioral: 0.4, contextPressure: 0.3 }, trajectory: { derivative: 0, shape: "flat", momentum: 0 }, confidence: "medium" },
    ];
    // Trapezoid 1: (0.4+0.4)/2 * (3-1) = 0.4*2 = 0.8
    // Trapezoid 2: (0.4+0.4)/2 * (10-3) = 0.4*7 = 2.8
    // Total: 3.6
    expect(entropyAreaUnderCurve(nonUniformTrace)).toBeCloseTo(3.6, 10);
  });

  test("monotonic decreasing trace has correct AUC", () => {
    // Iterations 1→2→3→4, widths 1, values 0.8,0.6,0.4,0.2
    // (0.8+0.6)/2 + (0.6+0.4)/2 + (0.4+0.2)/2 = 0.7 + 0.5 + 0.3 = 1.5
    expect(entropyAreaUnderCurve(monotonicDecreasingTrace)).toBeCloseTo(1.5, 10);
  });

  test("result is never NaN or Infinity for any standard trace shape", () => {
    const traces = [[], flatTrace, oscillatingTrace, singlePointTrace, monotonicDecreasingTrace];
    for (const trace of traces) {
      const a = entropyAreaUnderCurve(trace);
      expect(Number.isFinite(a)).toBe(true);
    }
  });
});

// ─── entropy feature safety (cross-function) ───

describe("entropy feature safety", () => {
  test("no feature returns NaN or Infinity for any standard trace shape", () => {
    const traces = [[], flatTrace, oscillatingTrace, singlePointTrace, monotonicDecreasingTrace];
    for (const trace of traces) {
      const v = entropyVariance(trace);
      const o = entropyOscillationCount(trace);
      const f = finalCompositeEntropy(trace);
      const a = entropyAreaUnderCurve(trace);
      expect(Number.isFinite(v)).toBe(true);
      expect(Number.isFinite(o)).toBe(true);
      if (f !== null) expect(Number.isFinite(f)).toBe(true);
      expect(Number.isFinite(a)).toBe(true);
    }
  });
});
