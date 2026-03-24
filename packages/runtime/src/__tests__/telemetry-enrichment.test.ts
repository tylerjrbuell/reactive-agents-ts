import { describe, test, expect } from "bun:test";
import {
  buildTrajectoryFingerprint,
  abstractifyToolName,
  firstConvergenceIteration,
  peakContextPressure,
  deriveTaskComplexity,
  deriveFailurePattern,
  deriveThoughtToActionRatio,
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
