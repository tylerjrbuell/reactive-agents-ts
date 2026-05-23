// Run: bun test packages/reasoning/src/kernel/capabilities/decide/arbitrator.budget.test.ts --timeout 15000
//
// Issue #128 — Budget pre-intent guard regression tests.
//
// Pins the contract:
//   1. budget.status==='exceeded' + agent-final-answer → exit-failure
//      (pre-guard DOMINATES intent.kind — agent self-claimed success loses)
//   2. budget.status==='exceeded' + max-iterations    → terminatedBy is
//      'budget_exceeded', NOT 'max_iterations' (pre-guard discriminator)
//   3. budget.status==='ok'  + agent-final-answer    → exit-success
//      (backward-compat — pre-guard is a no-op when budget is healthy)
//   4. no budget on ctx     + agent-final-answer    → exit-success
//      (backward-compat — pre-guard is a no-op when no limits declared)
//   5. arbitrationContextFromState reads state.meta.budgetLimits and
//      synthesizes a BudgetSignal from state.tokens / state.cost.
//   6. computeBudgetSignal returns 'warning' band ≥80% by default.
//
// Co-located alongside arbitrator.ts so this file lives inside the
// kernel-warden authority boundary (packages/reasoning/src/kernel/**).

import { describe, it, expect } from "bun:test";
import {
  arbitrate,
  arbitrationContextFromState,
  computeBudgetSignal,
  type ArbitrationContext,
  type BudgetSignal,
} from "./arbitrator.js";
import type { KernelState } from "../../state/kernel-state.js";

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

const exceededBudget: BudgetSignal = {
  tokensUsed: 5000,
  costUsd: 0.50,
  tokenLimit: 1000,
  status: "exceeded",
  reason: "tokens 5000 ≥ tokenLimit 1000",
};

// ── (1) Pre-guard wins over agent-final-answer ─────────────────────────────
describe("arbitrate — budget pre-guard dominates agent-final-answer", () => {
  it("returns exit-failure with terminatedBy='budget_exceeded' even on final-answer intent", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "the answer" },
      { ...baseCtx, budget: exceededBudget },
    );
    expect(v.action).toBe("exit-failure");
    if (v.action === "exit-failure") {
      expect(v.terminatedBy).toBe("budget_exceeded");
      expect(v.error).toContain("budget_exceeded");
      // Output is salvaged from the intent (best-effort answer preserved
      // alongside the failure status per arbitrator contract).
      expect(v.output).toBe("the answer");
    }
  });

  it("returns exit-failure on regex via discriminator too", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "regex", output: "regex answer" },
      { ...baseCtx, budget: exceededBudget },
    );
    expect(v.action).toBe("exit-failure");
    if (v.action === "exit-failure") {
      expect(v.terminatedBy).toBe("budget_exceeded");
      expect(v.output).toBe("regex answer");
    }
  });
});

// ── (2) Pre-guard wins over max-iterations ─────────────────────────────────
describe("arbitrate — budget pre-guard dominates max-iterations", () => {
  it("returns terminatedBy='budget_exceeded' NOT 'max_iterations' when both apply", () => {
    const v = arbitrate(
      { kind: "max-iterations", output: "" },
      { ...baseCtx, budget: exceededBudget, maxIterations: 10 },
    );
    expect(v.action).toBe("exit-failure");
    if (v.action === "exit-failure") {
      // The discriminator — budget always wins.
      expect(v.terminatedBy).toBe("budget_exceeded");
      expect(v.terminatedBy).not.toBe("max_iterations");
    }
  });
});

// ── (3) Pre-guard wins over kernel-error (different exit-failure reason) ──
describe("arbitrate — budget pre-guard dominates kernel-error", () => {
  it("returns budget_exceeded reason, not the kernel error reason", () => {
    const v = arbitrate(
      { kind: "kernel-error", error: "LLM stream broke" },
      { ...baseCtx, budget: exceededBudget },
    );
    expect(v.action).toBe("exit-failure");
    if (v.action === "exit-failure") {
      expect(v.terminatedBy).toBe("budget_exceeded");
      // kernel-error has no `output` field — pre-guard must not synthesize one.
      expect(v.output).toBeUndefined();
      // Error message is the budget reason, NOT "LLM stream broke".
      expect(v.error).toContain("budget_exceeded");
      expect(v.error).not.toContain("LLM stream broke");
    }
  });
});

// ── (4) Backward compatibility — budget=ok or absent ──────────────────────
describe("arbitrate — backward compatibility (no budget exceedance)", () => {
  it("budget.status='ok' + agent-final-answer → exit-success (existing semantics)", () => {
    const okBudget: BudgetSignal = {
      tokensUsed: 100,
      costUsd: 0.01,
      tokenLimit: 1000,
      status: "ok",
    };
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "ok answer" },
      { ...baseCtx, budget: okBudget },
    );
    expect(v.action).toBe("exit-success");
    if (v.action === "exit-success") {
      expect(v.output).toBe("ok answer");
      expect(v.terminatedBy).toBe("final_answer_tool");
    }
  });

  it("budget.status='warning' + agent-final-answer → exit-success (warning does NOT terminate)", () => {
    const warnBudget: BudgetSignal = {
      tokensUsed: 850,
      costUsd: 0.085,
      tokenLimit: 1000,
      status: "warning",
      reason: "tokens 850 ≥ 80% of 1000",
    };
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "ok answer" },
      { ...baseCtx, budget: warnBudget },
    );
    // Warning is informational only — pre-guard only fires on 'exceeded'.
    expect(v.action).toBe("exit-success");
  });

  it("no budget on ctx + agent-final-answer → exit-success (pre-guard is no-op)", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "no-limits answer" },
      baseCtx,
    );
    expect(v.action).toBe("exit-success");
    if (v.action === "exit-success") {
      expect(v.output).toBe("no-limits answer");
      expect(v.terminatedBy).toBe("final_answer_tool");
    }
  });
});

// ── (5) arbitrationContextFromState wiring ─────────────────────────────────
describe("arbitrationContextFromState — derives BudgetSignal from state.meta.budgetLimits", () => {
  it("omits budget when no limits declared", () => {
    const ctx = arbitrationContextFromState(baseState, { task: "x" });
    expect(ctx.budget).toBeUndefined();
  });

  it("computes BudgetSignal from state.tokens + state.cost vs declared limits", () => {
    const stateWithLimits: KernelState = {
      ...baseState,
      tokens: 5000,
      cost: 0,
      meta: { budgetLimits: { tokenLimit: 1000 } },
    };
    const ctx = arbitrationContextFromState(stateWithLimits, { task: "x" });
    expect(ctx.budget).toBeDefined();
    expect(ctx.budget?.status).toBe("exceeded");
    expect(ctx.budget?.tokensUsed).toBe(5000);
    expect(ctx.budget?.tokenLimit).toBe(1000);
  });

  it("end-to-end: state.meta.budgetLimits → arbitrationContextFromState → arbitrate vetoes final-answer", () => {
    const stateOverBudget: KernelState = {
      ...baseState,
      tokens: 2000,
      cost: 0,
      meta: { budgetLimits: { tokenLimit: 1000 } },
    };
    const ctx = arbitrationContextFromState(stateOverBudget, { task: "x" });
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "tried" },
      ctx,
    );
    expect(v.action).toBe("exit-failure");
    if (v.action === "exit-failure") {
      expect(v.terminatedBy).toBe("budget_exceeded");
      expect(v.output).toBe("tried");
    }
  });
});

// ── (6) computeBudgetSignal pure-function semantics ───────────────────────
describe("computeBudgetSignal — pure helper", () => {
  it("returns undefined when no limits declared", () => {
    const sig = computeBudgetSignal({ tokensUsed: 100, costUsd: 1 });
    expect(sig).toBeUndefined();
  });

  it("returns undefined when limits is empty object", () => {
    const sig = computeBudgetSignal({ tokensUsed: 100, costUsd: 1, limits: {} });
    expect(sig).toBeUndefined();
  });

  it("status='ok' when usage under 80% of limits", () => {
    const sig = computeBudgetSignal({
      tokensUsed: 100,
      costUsd: 0,
      limits: { tokenLimit: 1000 },
    });
    expect(sig?.status).toBe("ok");
  });

  it("status='warning' at ≥80% of declared limit (default ratio)", () => {
    const sig = computeBudgetSignal({
      tokensUsed: 800,
      costUsd: 0,
      limits: { tokenLimit: 1000 },
    });
    expect(sig?.status).toBe("warning");
    expect(sig?.reason).toContain("80%");
  });

  it("status='exceeded' at ≥100% of declared tokenLimit", () => {
    const sig = computeBudgetSignal({
      tokensUsed: 1000,
      costUsd: 0,
      limits: { tokenLimit: 1000 },
    });
    expect(sig?.status).toBe("exceeded");
  });

  it("status='exceeded' at ≥100% of declared costLimit", () => {
    const sig = computeBudgetSignal({
      tokensUsed: 0,
      costUsd: 1.5,
      limits: { costLimit: 1.0 },
    });
    expect(sig?.status).toBe("exceeded");
    expect(sig?.reason).toContain("cost");
  });

  it("honors custom warningRatio override", () => {
    const sig = computeBudgetSignal({
      tokensUsed: 500,
      costUsd: 0,
      limits: { tokenLimit: 1000, warningRatio: 0.5 },
    });
    expect(sig?.status).toBe("warning");
  });
});
