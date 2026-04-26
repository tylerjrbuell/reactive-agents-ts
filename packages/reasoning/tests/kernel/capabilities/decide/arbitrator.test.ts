// Run: bun test packages/reasoning/tests/kernel/capabilities/decide/arbitrator.test.ts --timeout 15000
//
// Sprint 3.3 — Arbitrator unit tests. Pin the contract by which the
// Arbitrator resolves TerminationIntents into Verdicts. These tests are
// the structural foundation cf-24 builds on; if they pass, the 9 termination
// sites can be wired with confidence in the resolution semantics.

import { describe, it, expect } from "bun:test";
import {
  arbitrate,
  applyTermination,
  arbitrateAndApply,
  arbitrationContextFromState,
  type TerminationIntent,
  type Verdict,
  type ArbitrationContext,
} from "../../../../src/kernel/capabilities/decide/arbitrator.js";
import type { KernelState } from "../../../../src/kernel/state/kernel-state.js";

const baseCtx: ArbitrationContext = {
  iteration: 1,
  task: "test",
  steps: [],
  toolsUsed: new Set(),
  requiredTools: [],
};

const baseState: KernelState = {
  taskId: "t",
  strategy: "reactive",
  kernelType: "react",
  steps: [],
  toolsUsed: new Set(),
  scratchpad: new Map(),
  iteration: 0,
  tokens: 0,
  cost: 0,
  status: "thinking",
  output: null,
  error: null,
  llmCalls: 0,
  meta: {},
  controllerDecisionLog: [],
  messages: [],
  pendingGuidance: undefined,
  consecutiveLowDeltaCount: 0,
  readyToAnswerNudgeCount: 0,
  lastMetaToolCall: undefined,
  consecutiveMetaToolCount: 0,
} as KernelState;

// ── arbitrate(): per-intent resolution ────────────────────────────────────────

describe("arbitrate — max-iterations", () => {
  it("returns exit-failure regardless of context", () => {
    const v = arbitrate(
      { kind: "max-iterations", output: "" },
      { ...baseCtx, maxIterations: 12 },
    );
    expect(v.action).toBe("exit-failure");
    if (v.action === "exit-failure") {
      expect(v.error).toContain("12");
      expect(v.terminatedBy).toBe("max_iterations");
    }
  });

  it("preserves output on max-iterations exit", () => {
    const v = arbitrate(
      { kind: "max-iterations", output: "best effort answer" },
      baseCtx,
    );
    if (v.action === "exit-failure") {
      expect(v.output).toBe("best effort answer");
    }
  });
});

describe("arbitrate — kernel-error", () => {
  it("returns exit-failure with kernel_error terminatedBy", () => {
    const v = arbitrate(
      { kind: "kernel-error", error: "LLM stream broke" },
      baseCtx,
    );
    expect(v.action).toBe("exit-failure");
    if (v.action === "exit-failure") {
      expect(v.error).toBe("LLM stream broke");
      expect(v.terminatedBy).toBe("kernel_error");
    }
  });
});

describe("arbitrate — controller-early-stop", () => {
  it("returns exit-success — controller's deliberate decision is trusted", () => {
    const v = arbitrate(
      { kind: "controller-early-stop", output: "wrap-up", reason: "entropy_converged" },
      baseCtx,
    );
    expect(v.action).toBe("exit-success");
    if (v.action === "exit-success") {
      expect(v.output).toBe("wrap-up");
      expect(v.terminatedBy).toContain("controller_early_stop");
      expect(v.terminatedBy).toContain("entropy_converged");
    }
  });
});

describe("arbitrate — fast-path-completed", () => {
  it("returns exit-success when no controller activity", () => {
    const v = arbitrate({ kind: "fast-path-completed", output: "Paris" }, baseCtx);
    expect(v.action).toBe("exit-success");
    if (v.action === "exit-success") {
      expect(v.terminatedBy).toBe("fast_path");
    }
  });

  it("VETOES success when controller showed pathological activity", () => {
    const v = arbitrate(
      { kind: "fast-path-completed", output: "Paris" },
      {
        ...baseCtx,
        controllerDecisionLog: ["stall-detect: stuck", "stall-detect: stuck"],
      },
    );
    expect(v.action).toBe("exit-failure");
    if (v.action === "exit-failure") {
      expect(v.terminatedBy).toBe("controller_signal_veto");
      expect(v.error).toContain("stall-detect");
    }
  });
});

describe("arbitrate — agent-final-answer (Verdict-Override pattern)", () => {
  it("returns exit-success when no controller veto fires", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "the answer" },
      baseCtx,
    );
    expect(v.action).toBe("exit-success");
    if (v.action === "exit-success") {
      expect(v.terminatedBy).toBe("final_answer:tool");
    }
  });

  it("preserves the via discriminator in terminatedBy (tool / regex / end-turn)", () => {
    for (const via of ["tool", "regex", "end-turn"] as const) {
      const v = arbitrate(
        { kind: "agent-final-answer", via, output: "x" },
        baseCtx,
      );
      if (v.action === "exit-success") {
        expect(v.terminatedBy).toBe(`final_answer:${via}`);
      }
    }
  });

  it("VETOES agent's success claim when ≥2 stall-detect with no escalation", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "best effort" },
      {
        ...baseCtx,
        controllerDecisionLog: [
          "stall-detect: low entropy delta",
          "stall-detect: still stuck",
        ],
      },
    );
    expect(v.action).toBe("exit-failure");
    if (v.action === "exit-failure") {
      expect(v.terminatedBy).toBe("controller_signal_veto");
      expect(v.error).toContain("2 stall-detect");
    }
  });

  it("VETOES on ≥3 tool-inject without escalation", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "" },
      {
        ...baseCtx,
        controllerDecisionLog: [
          "tool-inject: more",
          "tool-inject: more",
          "tool-inject: more",
        ],
      },
    );
    expect(v.action).toBe("exit-failure");
    if (v.action === "exit-failure") {
      expect(v.error).toContain("3 tool-inject");
    }
  });

  it("VETOES on stall + high entropy combination", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "" },
      {
        ...baseCtx,
        controllerDecisionLog: ["stall-detect: stuck"],
        entropyComposite: 0.7,
      },
    );
    expect(v.action).toBe("exit-failure");
  });

  it("does NOT veto when switch-strategy already fired (controller escalated)", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "answer" },
      {
        ...baseCtx,
        controllerDecisionLog: [
          "stall-detect: stuck",
          "stall-detect: stuck",
          "switch-strategy: escalating to plan-execute",
        ],
      },
    );
    expect(v.action).toBe("exit-success");
  });

  it("does NOT veto on benign single stall-detect with low entropy", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "answer" },
      {
        ...baseCtx,
        controllerDecisionLog: ["stall-detect: tiny delta"],
        entropyComposite: 0.15,
      },
    );
    expect(v.action).toBe("exit-success");
  });
});

describe("arbitrate — loop-detected", () => {
  it("returns exit-success when loop detected without veto", () => {
    const v = arbitrate(
      { kind: "loop-detected", output: "stopped looping", reason: "3 identical thoughts" },
      baseCtx,
    );
    expect(v.action).toBe("exit-success");
    if (v.action === "exit-success") {
      expect(v.terminatedBy).toContain("loop_detected");
      expect(v.terminatedBy).toContain("3 identical thoughts");
    }
  });

  it("VETOES loop exit when controller signals also pathological", () => {
    const v = arbitrate(
      { kind: "loop-detected", output: "", reason: "repeated" },
      {
        ...baseCtx,
        controllerDecisionLog: ["stall-detect: stuck", "stall-detect: stuck"],
      },
    );
    expect(v.action).toBe("exit-failure");
    if (v.action === "exit-failure") {
      expect(v.terminatedBy).toBe("loop_detected_with_veto");
    }
  });
});

describe("arbitrate — oracle-decision passthrough", () => {
  it("converts oracle 'fail' verdict to exit-failure", () => {
    const v = arbitrate(
      {
        kind: "oracle-decision",
        decision: {
          shouldExit: true,
          action: "fail",
          confidence: "high",
          reason: "controller veto fired",
          evaluator: "ControllerSignalVeto",
          allVerdicts: [],
        },
        output: "would-be answer",
      },
      baseCtx,
    );
    expect(v.action).toBe("exit-failure");
    if (v.action === "exit-failure") {
      expect(v.terminatedBy).toBe("ControllerSignalVeto");
      expect(v.error).toContain("controller veto");
    }
  });

  it("converts oracle 'exit' verdict to exit-success", () => {
    const v = arbitrate(
      {
        kind: "oracle-decision",
        decision: {
          shouldExit: true,
          action: "exit",
          confidence: "medium",
          reason: "llm_end_turn",
          evaluator: "LLMEndTurn",
          allVerdicts: [],
          output: "the answer",
        },
        output: "fallback",
      },
      baseCtx,
    );
    expect(v.action).toBe("exit-success");
    if (v.action === "exit-success") {
      expect(v.output).toBe("the answer");
    }
  });

  it("returns continue when oracle says continue", () => {
    const v = arbitrate(
      {
        kind: "oracle-decision",
        decision: {
          shouldExit: false,
          action: "continue",
          confidence: "low",
          reason: "no_signal",
          evaluator: "none",
          allVerdicts: [],
        },
        output: "",
      },
      baseCtx,
    );
    expect(v.action).toBe("continue");
  });
});

// ── applyTermination(): Verdict → KernelState ────────────────────────────────

describe("applyTermination", () => {
  it("continue verdict returns state unchanged", () => {
    const v: Verdict = { action: "continue" };
    const out = applyTermination(baseState, v);
    expect(out).toBe(baseState);
  });

  it("exit-success sets status:done with output and terminatedBy", () => {
    const v: Verdict = {
      action: "exit-success",
      output: "answered",
      terminatedBy: "fast_path",
    };
    const out = applyTermination(baseState, v);
    expect(out.status).toBe("done");
    expect(out.output).toBe("answered");
    expect(out.meta.terminatedBy).toBe("fast_path");
  });

  it("exit-failure sets status:failed with error and null output", () => {
    const v: Verdict = {
      action: "exit-failure",
      error: "controller veto",
      terminatedBy: "controller_signal_veto",
    };
    const out = applyTermination(baseState, v);
    expect(out.status).toBe("failed");
    expect(out.error).toBe("controller veto");
    expect(out.output).toBeNull();
    expect(out.meta.terminatedBy).toBe("controller_signal_veto");
  });

  it("exit-failure with output preserves it (for diagnostic surfaces)", () => {
    const v: Verdict = {
      action: "exit-failure",
      error: "veto'd",
      terminatedBy: "veto",
      output: "would-have-been-answer",
    };
    const out = applyTermination(baseState, v);
    expect(out.output).toBe("would-have-been-answer");
  });

  it("escalate sets meta.escalateTo without changing status", () => {
    const v: Verdict = {
      action: "escalate",
      nextStrategy: "plan-execute",
      reason: "tactical interventions exhausted",
    };
    const out = applyTermination(baseState, v);
    expect(out.status).toBe("thinking"); // unchanged
    expect(out.meta.escalateTo).toBe("plan-execute");
    expect(out.meta.escalationReason).toContain("tactical");
  });

  it("merges extraMeta into the resulting meta", () => {
    const v: Verdict = {
      action: "exit-success",
      output: "x",
      terminatedBy: "fast_path",
    };
    const out = applyTermination(baseState, v, { evaluator: "Test", customField: 42 });
    expect(out.meta.terminatedBy).toBe("fast_path");
    expect((out.meta as Record<string, unknown>).evaluator).toBe("Test");
    expect((out.meta as Record<string, unknown>).customField).toBe(42);
  });
});

// ── arbitrateAndApply: convenience entry point ───────────────────────────────

describe("arbitrateAndApply", () => {
  it("composes arbitrate + applyTermination in one call", () => {
    const out = arbitrateAndApply(
      baseState,
      { kind: "agent-final-answer", via: "tool", output: "the answer" },
      baseCtx,
    );
    expect(out.status).toBe("done");
    expect(out.output).toBe("the answer");
  });

  it("vetoed final-answer flows through to status:failed end-to-end", () => {
    const out = arbitrateAndApply(
      baseState,
      { kind: "agent-final-answer", via: "tool", output: "fake answer" },
      {
        ...baseCtx,
        controllerDecisionLog: ["stall-detect: x", "stall-detect: x"],
      },
    );
    expect(out.status).toBe("failed");
    expect(out.error).toContain("controller_signal_veto");
    expect(out.meta.terminatedBy).toBe("controller_signal_veto");
  });
});

// ── arbitrationContextFromState: extraction helper ──────────────────────────

describe("arbitrationContextFromState", () => {
  it("extracts task + steps + toolsUsed + log from state", () => {
    const state: KernelState = {
      ...baseState,
      iteration: 5,
      controllerDecisionLog: ["stall-detect: a", "tool-inject: b"],
      toolsUsed: new Set(["web-search"]),
      meta: {
        ...baseState.meta,
        maxIterations: 10,
      },
    };
    const ctx = arbitrationContextFromState(state, {
      task: "find btc price",
      requiredTools: ["web-search"],
    });
    expect(ctx.iteration).toBe(5);
    expect(ctx.maxIterations).toBe(10);
    expect(ctx.task).toBe("find btc price");
    expect(ctx.toolsUsed.has("web-search")).toBe(true);
    expect(ctx.requiredTools).toEqual(["web-search"]);
    expect(ctx.controllerDecisionLog?.length).toBe(2);
  });

  it("extracts entropy.composite when present in state.meta", () => {
    const state: KernelState = {
      ...baseState,
      meta: {
        ...baseState.meta,
        entropy: { latestScore: { composite: 0.7 } },
      } as KernelState["meta"],
    };
    const ctx = arbitrationContextFromState(state, { task: "x" });
    expect(ctx.entropyComposite).toBe(0.7);
  });

  it("undefined entropy when state.meta.entropy absent", () => {
    const ctx = arbitrationContextFromState(baseState, { task: "x" });
    expect(ctx.entropyComposite).toBeUndefined();
  });

  it("requiredTools defaults to empty array when not provided", () => {
    const ctx = arbitrationContextFromState(baseState, { task: "x" });
    expect(ctx.requiredTools).toEqual([]);
  });
});
