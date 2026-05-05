# Kernel Optimization & Intelligent Termination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scattered exit logic in the ReAct kernel with a scored signal pipeline (Termination Oracle), add trace-aware output assembly, make reactive intelligence default-on, and fix sub-agent/prompt/metrics issues — all to improve cross-provider benchmark pass rates.

**Architecture:** The termination oracle is a pure function that evaluates typed signal evaluators against a read-only context snapshot. It replaces the if/else waterfall in `handleThinking` with a composable, testable pipeline. Output assembly extracts code blocks from the execution trace when the final answer is a summary. The execution engine gains proportional post-processing based on entropy-derived task complexity.

**Tech Stack:** TypeScript, Effect-TS, bun:test, existing reactive-intelligence entropy sensor + controller

**Spec:** `docs/superpowers/specs/2026-03-20-kernel-optimization-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/reasoning/src/strategies/shared/termination-oracle.ts` | TerminationContext, SignalVerdict, TerminationDecision types, evaluateTermination resolver, all 8 built-in signal evaluators, normalizedLevenshtein utility, FINAL_ANSWER_RE constant (exported) |
| `packages/reasoning/src/strategies/shared/output-assembly.ts` | OutputAssemblyContext, AssembledOutput types, assembleOutput function, extractCodeBlocks utility |
| `packages/reasoning/tests/shared/termination-oracle.test.ts` | Unit tests for each evaluator + oracle resolution + regression scenarios |
| `packages/reasoning/tests/shared/output-assembly.test.ts` | Unit tests for assembly logic + code block extraction |

### Modified Files

| File | What Changes |
|------|-------------|
| `packages/reasoning/src/strategies/shared/react-kernel.ts` | handleThinking exit logic replaced by oracle call; priorThought threaded; post-action FA check → oracle; llmCalls counter |
| `packages/reasoning/src/strategies/shared/kernel-runner.ts` | Entropy scoring reorder (before exit checks); controller decisions passed to kernel context |
| `packages/reasoning/src/strategies/shared/kernel-state.ts` | Add `priorThought?: string` and `llmCalls: number` to KernelState |
| `packages/reasoning/src/strategies/shared/tool-utils.ts` | Replace `hasFinalAnswer` regex with expanded `FINAL_ANSWER_RE`; update `extractFinalAnswer` to use it |
| `packages/runtime/src/builder.ts` | `_enableReactiveIntelligence` default `true`; boolean overload on `withReactiveIntelligence` |
| `packages/reactive-intelligence/src/types.ts` | Controller defaults `true`; telemetry default `false` |
| `packages/runtime/src/execution-engine.ts` | Proportional pipeline — conditional memory-flush/debrief based on TaskComplexity |
| `packages/tools/src/skills/final-answer.ts` | Add code-inclusion instruction to tool description |
| `packages/tools/src/adapters/agent-tool-adapter.ts` | Accept `string \| object` input; fix name propagation |
| `packages/prompts/src/templates/reasoning/react-thought.ts` | Add anti-conversational instruction |
| `packages/prompts/src/templates/reasoning/react-thought-local.ts` | Add anti-conversational instruction |
| `packages/prompts/src/templates/reasoning/react-system-local.ts` | Strengthen termination nudge |
| `test.ts` | Add TIME_MULTIPLIER for provider-aware budgets |

---

## Task 1: Termination Oracle — Types & Resolver

**Files:**
- Create: `packages/reasoning/src/strategies/shared/termination-oracle.ts`
- Test: `packages/reasoning/tests/shared/termination-oracle.test.ts`

- [ ] **Step 1: Create type definitions**

Create `packages/reasoning/src/strategies/shared/termination-oracle.ts` with all types:

```typescript
import type { ReasoningStep } from "../../types/index.js";
import type { ToolSchema } from "./tool-utils.js";
import { FINAL_ANSWER_RE } from "./tool-utils.js";
export { FINAL_ANSWER_RE };

// ── Local structural types ──────────────────────────────────────────────
// These mirror shapes from @reactive-agents/reactive-intelligence without
// creating a cross-package dependency. The reasoning package deliberately
// avoids depending on reactive-intelligence (see service-utils.ts).

export interface ToolRequest {
  readonly tool: string;
  readonly input: string;
}

/** Subset of ControllerDecision from reactive-intelligence. */
export interface ReactiveDecision {
  readonly decision: "early-stop" | "compress" | "switch-strategy";
  readonly reason: string;
}

/** Subset of EntropyTrajectory from reactive-intelligence. */
export interface EntropyTrajectory {
  readonly history?: readonly number[];
  readonly shape: "converging" | "flat" | "diverging" | "v-recovery" | "oscillating";
  readonly derivative: number;
  readonly momentum: number;
}

/** Subset of EntropyScore from reactive-intelligence (composite + trajectory). */
export interface EntropyScoreLike {
  readonly composite: number;
  readonly trajectory?: EntropyTrajectory;
}

export interface TerminationContext {
  readonly thought: string;
  readonly thinking?: string;
  readonly stopReason: string;
  readonly toolRequest: ToolRequest | null;
  readonly iteration: number;
  readonly steps: readonly ReasoningStep[];
  readonly priorThought?: string;
  readonly entropy?: EntropyScoreLike;
  readonly trajectory?: EntropyTrajectory;
  readonly controllerDecisions?: readonly ReactiveDecision[];
  readonly toolsUsed: ReadonlySet<string>;
  readonly requiredTools: readonly string[];
  readonly allToolSchemas: readonly ToolSchema[];
  readonly redirectCount: number;
  readonly priorFinalAnswerAttempts: number;
  readonly taskDescription: string;
}

export interface SignalVerdict {
  readonly action: "exit" | "redirect" | "continue";
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
  readonly output?: string;
}

export interface TerminationSignalEvaluator {
  readonly name: string;
  readonly evaluate: (ctx: TerminationContext) => SignalVerdict | null;
}

export interface TerminationDecision {
  readonly shouldExit: boolean;
  readonly action: "exit" | "redirect" | "continue";
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
  readonly evaluator: string;
  readonly output?: string;
  readonly allVerdicts: ReadonlyArray<{ evaluator: string; verdict: SignalVerdict }>;
}
```

- [ ] **Step 2: Implement resolver function**

Add to the same file, below the types:

```typescript
function confidenceRank(c: "high" | "medium" | "low"): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}

export function evaluateTermination(
  ctx: TerminationContext,
  evaluators: readonly TerminationSignalEvaluator[],
): TerminationDecision {
  const verdicts: Array<{ evaluator: string; verdict: SignalVerdict }> = [];

  for (const ev of evaluators) {
    const verdict = ev.evaluate(ctx);
    if (!verdict) continue;

    verdicts.push({ evaluator: ev.name, verdict });

    // Short-circuit: high-confidence exit
    if (verdict.action === "exit" && verdict.confidence === "high") {
      return { shouldExit: true, ...verdict, evaluator: ev.name, allVerdicts: verdicts };
    }
    // Short-circuit: high-confidence continue (e.g., tool call pending)
    if (verdict.action === "continue" && verdict.confidence === "high") {
      return { shouldExit: false, ...verdict, evaluator: ev.name, allVerdicts: verdicts };
    }
  }

  const exits = verdicts
    .filter((v) => v.verdict.action === "exit")
    .sort((a, b) => confidenceRank(b.verdict.confidence) - confidenceRank(a.verdict.confidence));
  const redirects = verdicts
    .filter((v) => v.verdict.action === "redirect")
    .sort((a, b) => confidenceRank(b.verdict.confidence) - confidenceRank(a.verdict.confidence));

  const bestExit = exits[0];
  const bestRedirect = redirects[0];

  if (bestExit && bestRedirect) {
    if (confidenceRank(bestExit.verdict.confidence) >= confidenceRank(bestRedirect.verdict.confidence)) {
      return { shouldExit: true, ...bestExit.verdict, evaluator: bestExit.evaluator, allVerdicts: verdicts };
    }
    return { shouldExit: false, ...bestRedirect.verdict, evaluator: bestRedirect.evaluator, allVerdicts: verdicts };
  }
  if (bestExit) {
    return { shouldExit: true, ...bestExit.verdict, evaluator: bestExit.evaluator, allVerdicts: verdicts };
  }
  if (bestRedirect) {
    return { shouldExit: false, ...bestRedirect.verdict, evaluator: bestRedirect.evaluator, allVerdicts: verdicts };
  }

  return {
    shouldExit: false, action: "continue", confidence: "low",
    reason: "no_exit_signal", evaluator: "none", allVerdicts: verdicts,
  };
}
```

- [ ] **Step 3: Write resolver unit tests**

Create `packages/reasoning/tests/shared/termination-oracle.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { evaluateTermination, type TerminationContext, type TerminationSignalEvaluator } from "../../src/strategies/shared/termination-oracle.js";

// Helper to build minimal context with overrides
function makeCtx(overrides: Partial<TerminationContext> = {}): TerminationContext {
  return {
    thought: "The answer is 4.",
    stopReason: "end_turn",
    toolRequest: null,
    iteration: 1,
    steps: [],
    toolsUsed: new Set(),
    requiredTools: [],
    allToolSchemas: [],
    redirectCount: 0,
    priorFinalAnswerAttempts: 0,
    taskDescription: "What is 2+2?",
    ...overrides,
  };
}

// Stub evaluators for resolver logic testing
const exitHigh: TerminationSignalEvaluator = {
  name: "exit-high",
  evaluate: () => ({ action: "exit", confidence: "high", reason: "test", output: "done" }),
};
const exitMedium: TerminationSignalEvaluator = {
  name: "exit-medium",
  evaluate: () => ({ action: "exit", confidence: "medium", reason: "test", output: "done" }),
};
const continueHigh: TerminationSignalEvaluator = {
  name: "continue-high",
  evaluate: () => ({ action: "continue", confidence: "high", reason: "tool_pending" }),
};
const redirectMedium: TerminationSignalEvaluator = {
  name: "redirect-medium",
  evaluate: () => ({ action: "redirect", confidence: "medium", reason: "gap" }),
};
const noop: TerminationSignalEvaluator = {
  name: "noop",
  evaluate: () => null,
};

describe("evaluateTermination resolver", () => {
  test("high-confidence exit short-circuits", () => {
    const result = evaluateTermination(makeCtx(), [noop, exitHigh, exitMedium]);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("exit-high");
    expect(result.allVerdicts).toHaveLength(1); // short-circuited, noop returned null
  });

  test("high-confidence continue short-circuits", () => {
    const result = evaluateTermination(makeCtx(), [continueHigh, exitMedium]);
    expect(result.shouldExit).toBe(false);
    expect(result.evaluator).toBe("continue-high");
  });

  test("medium exit beats medium redirect", () => {
    const result = evaluateTermination(makeCtx(), [redirectMedium, exitMedium]);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("exit-medium");
  });

  test("all null evaluators → no_exit_signal", () => {
    const result = evaluateTermination(makeCtx(), [noop, noop]);
    expect(result.shouldExit).toBe(false);
    expect(result.reason).toBe("no_exit_signal");
  });

  test("empty evaluator list → no_exit_signal", () => {
    const result = evaluateTermination(makeCtx(), []);
    expect(result.shouldExit).toBe(false);
  });

  test("allVerdicts captures all non-null verdicts", () => {
    const result = evaluateTermination(makeCtx(), [noop, exitMedium, redirectMedium]);
    expect(result.allVerdicts).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/reasoning && bun test tests/shared/termination-oracle.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 5: Add re-export to shared index**

In `packages/reasoning/src/strategies/shared/index.ts`, add:

```typescript
export * from "./termination-oracle.js";
```

- [ ] **Step 6: Commit**

```
git add packages/reasoning/src/strategies/shared/termination-oracle.ts packages/reasoning/src/strategies/shared/index.ts packages/reasoning/tests/shared/termination-oracle.test.ts
git commit -m "feat(reasoning): add termination oracle types and resolver"
```

---

## Task 2: Signal Evaluators

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/termination-oracle.ts`
- Modify: `packages/reasoning/tests/shared/termination-oracle.test.ts`

- [ ] **Step 1: Implement normalizedLevenshtein utility**

Add to `termination-oracle.ts`:

```typescript
/** Normalized Levenshtein similarity (0-1, 1 = identical). No external dependencies. */
export function normalizedLevenshtein(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  // Standard DP Levenshtein distance
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) { matrix[i]![j] = j; continue; }
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return 1 - matrix[a.length]![b.length]! / maxLen;
}
```

- [ ] **Step 2: Write Levenshtein tests**

Add to `termination-oracle.test.ts`:

```typescript
import { normalizedLevenshtein } from "../../src/strategies/shared/termination-oracle.js";

describe("normalizedLevenshtein", () => {
  test("identical strings → 1.0", () => {
    expect(normalizedLevenshtein("hello", "hello")).toBe(1);
  });
  test("empty strings → 1.0", () => {
    expect(normalizedLevenshtein("", "")).toBe(1);
  });
  test("completely different → low score", () => {
    expect(normalizedLevenshtein("abc", "xyz")).toBeLessThan(0.1);
  });
  test("similar strings → high score", () => {
    expect(normalizedLevenshtein("The capital of France is Paris.", "The capital of France is Paris!")).toBeGreaterThan(0.9);
  });
  test("one empty → 0", () => {
    expect(normalizedLevenshtein("hello", "")).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd packages/reasoning && bun test tests/shared/termination-oracle.test.ts`
Expected: All pass (resolver tests + Levenshtein tests).

- [ ] **Step 4: Implement all 8 signal evaluators**

Add to `termination-oracle.ts`. Import `extractFinalAnswer` from `./tool-utils.js` (will update in Task 5 to use shared regex).

```typescript
import { extractFinalAnswer } from "./tool-utils.js";

// ── Built-in Signal Evaluators ──────────────────────────────────────────────

export const pendingToolCallEvaluator: TerminationSignalEvaluator = {
  name: "PendingToolCall",
  evaluate: (ctx) => {
    if (ctx.toolRequest) return { action: "continue", confidence: "high", reason: "tool_call_pending" };
    return null;
  },
};

export const finalAnswerToolEvaluator: TerminationSignalEvaluator = {
  name: "FinalAnswerTool",
  evaluate: (ctx) => {
    // This evaluator is a placeholder for integration.
    // The final-answer tool accept/reject logic stays in handleActing.
    // When handleActing accepts, it transitions to "done" directly.
    // This evaluator fires for post-action oracle calls where the thought
    // contained a final-answer tool reference that was deferred.
    return null;
  },
};

export const entropyConvergenceEvaluator: TerminationSignalEvaluator = {
  name: "EntropyConvergence",
  evaluate: (ctx) => {
    if (!ctx.entropy || !ctx.trajectory) return null;
    if (ctx.stopReason !== "end_turn") return null;

    const converging = ctx.trajectory.shape === "converging" && ctx.trajectory.derivative < -0.05;
    if (converging && ctx.thought.trim().length > 0) {
      return { action: "exit", confidence: "high", reason: "entropy_converged", output: ctx.thought.trim() };
    }
    return null;
  },
};

export const reactiveControllerEarlyStopEvaluator: TerminationSignalEvaluator = {
  name: "ReactiveControllerEarlyStop",
  evaluate: (ctx) => {
    if (!ctx.controllerDecisions) return null;
    const earlyStop = ctx.controllerDecisions.find((d) => d.decision === "early-stop");
    if (!earlyStop) return null;
    return { action: "exit", confidence: "high", reason: `controller_early_stop: ${earlyStop.reason}`, output: ctx.thought.trim() };
  },
};

export const contentStabilityEvaluator: TerminationSignalEvaluator = {
  name: "ContentStability",
  evaluate: (ctx) => {
    if (!ctx.priorThought || ctx.toolRequest) return null;
    const current = ctx.thought.trim();
    const prior = ctx.priorThought.trim();
    if (current.length === 0 || prior.length === 0) return null;

    if (current === prior) {
      return { action: "exit", confidence: "high", reason: "content_stable", output: current };
    }
    if (normalizedLevenshtein(current, prior) > 0.85) {
      return { action: "exit", confidence: "medium", reason: "content_stable", output: current };
    }
    return null;
  },
};

export const llmEndTurnEvaluator: TerminationSignalEvaluator = {
  name: "LLMEndTurn",
  evaluate: (ctx) => {
    if (ctx.stopReason !== "end_turn") return null;
    if (ctx.thought.trim().length === 0) return null;
    const remainingRequired = ctx.requiredTools.filter((t) => !ctx.toolsUsed.has(t));
    if (remainingRequired.length > 0) return null;
    return { action: "exit", confidence: "medium", reason: "llm_end_turn", output: ctx.thought.trim() };
  },
};

export const finalAnswerRegexEvaluator: TerminationSignalEvaluator = {
  name: "FinalAnswerRegex",
  evaluate: (ctx) => {
    const thought = ctx.thought;
    const thinking = ctx.thinking ?? "";
    if (!FINAL_ANSWER_RE.test(thought) && !FINAL_ANSWER_RE.test(thinking)) return null;

    const extracted = extractFinalAnswer(thought) || extractFinalAnswer(thinking);
    if (!extracted || extracted.trim().length === 0) return null;
    return { action: "exit", confidence: "medium", reason: "final_answer_regex", output: extracted.trim() };
  },
};

export const completionGapEvaluator: TerminationSignalEvaluator = {
  name: "CompletionGap",
  evaluate: (ctx) => {
    // Completion gap logic is injected at integration time since it depends
    // on detectCompletionGaps from react-kernel.ts. This evaluator is
    // a factory target — the kernel passes a configured instance.
    // Default: no opinion.
    if (ctx.redirectCount >= 1) return null;
    return null;
  },
};

/** Default evaluator chain — ordered for short-circuit performance. */
export const defaultEvaluators: readonly TerminationSignalEvaluator[] = [
  pendingToolCallEvaluator,
  finalAnswerToolEvaluator,
  entropyConvergenceEvaluator,
  reactiveControllerEarlyStopEvaluator,
  contentStabilityEvaluator,
  llmEndTurnEvaluator,
  finalAnswerRegexEvaluator,
  completionGapEvaluator,
];
```

- [ ] **Step 5: Write evaluator unit tests**

Add to `termination-oracle.test.ts`:

```typescript
import {
  pendingToolCallEvaluator,
  entropyConvergenceEvaluator,
  reactiveControllerEarlyStopEvaluator,
  contentStabilityEvaluator,
  llmEndTurnEvaluator,
  finalAnswerRegexEvaluator,
} from "../../src/strategies/shared/termination-oracle.js";

describe("PendingToolCall evaluator", () => {
  test("tool request present → continue high", () => {
    const v = pendingToolCallEvaluator.evaluate(makeCtx({ toolRequest: { tool: "web-search", input: "{}" } }));
    expect(v?.action).toBe("continue");
    expect(v?.confidence).toBe("high");
  });
  test("no tool request → null", () => {
    expect(pendingToolCallEvaluator.evaluate(makeCtx())).toBeNull();
  });
});

describe("EntropyConvergence evaluator", () => {
  test("converging trajectory + end_turn → exit high", () => {
    const v = entropyConvergenceEvaluator.evaluate(makeCtx({
      entropy: { composite: 0.3 } as any,
      trajectory: { shape: "converging", derivative: -0.1, momentum: -0.2 },
    }));
    expect(v?.action).toBe("exit");
    expect(v?.confidence).toBe("high");
  });
  test("flat trajectory → null", () => {
    const v = entropyConvergenceEvaluator.evaluate(makeCtx({
      entropy: { composite: 0.5 } as any,
      trajectory: { shape: "flat", derivative: 0.0, momentum: 0.0 },
    }));
    expect(v).toBeNull();
  });
  test("no entropy → null", () => {
    expect(entropyConvergenceEvaluator.evaluate(makeCtx())).toBeNull();
  });
  test("stop reason not end_turn → null", () => {
    const v = entropyConvergenceEvaluator.evaluate(makeCtx({
      stopReason: "tool_call",
      entropy: { composite: 0.3 } as any,
      trajectory: { shape: "converging", derivative: -0.1, momentum: -0.2 },
    }));
    expect(v).toBeNull();
  });
});

describe("ReactiveControllerEarlyStop evaluator", () => {
  test("early-stop decision → exit high", () => {
    const v = reactiveControllerEarlyStopEvaluator.evaluate(makeCtx({
      controllerDecisions: [{ decision: "early-stop", reason: "converged" }],
    }));
    expect(v?.action).toBe("exit");
    expect(v?.confidence).toBe("high");
  });
  test("no decisions → null", () => {
    expect(reactiveControllerEarlyStopEvaluator.evaluate(makeCtx())).toBeNull();
  });
  test("non-early-stop decision → null", () => {
    const v = reactiveControllerEarlyStopEvaluator.evaluate(makeCtx({
      controllerDecisions: [{ decision: "compress", reason: "pressure" }],
    }));
    expect(v).toBeNull();
  });
});

describe("ContentStability evaluator", () => {
  test("identical thoughts → exit high", () => {
    const v = contentStabilityEvaluator.evaluate(makeCtx({
      thought: "The capital of France is Paris.",
      priorThought: "The capital of France is Paris.",
    }));
    expect(v?.action).toBe("exit");
    expect(v?.confidence).toBe("high");
  });
  test("very similar thoughts → exit medium", () => {
    const v = contentStabilityEvaluator.evaluate(makeCtx({
      thought: "The capital of France is Paris.",
      priorThought: "The capital of France is Paris!",
    }));
    expect(v?.action).toBe("exit");
    expect(v?.confidence).toBe("medium");
  });
  test("different thoughts → null", () => {
    const v = contentStabilityEvaluator.evaluate(makeCtx({
      thought: "Python is great for ML.",
      priorThought: "The capital of France is Paris.",
    }));
    expect(v).toBeNull();
  });
  test("tool request pending → null even if stable", () => {
    const v = contentStabilityEvaluator.evaluate(makeCtx({
      thought: "same", priorThought: "same",
      toolRequest: { tool: "search", input: "{}" },
    }));
    expect(v).toBeNull();
  });
  test("no prior thought → null", () => {
    expect(contentStabilityEvaluator.evaluate(makeCtx())).toBeNull();
  });
});

describe("LLMEndTurn evaluator", () => {
  test("end_turn + non-empty + no required tools → exit medium", () => {
    const v = llmEndTurnEvaluator.evaluate(makeCtx({ thought: "4" }));
    expect(v?.action).toBe("exit");
    expect(v?.confidence).toBe("medium");
  });
  test("end_turn at iteration 0 → still exits (no iteration gate)", () => {
    const v = llmEndTurnEvaluator.evaluate(makeCtx({ iteration: 0, thought: "Yes" }));
    expect(v?.action).toBe("exit");
  });
  test("empty thought → null", () => {
    expect(llmEndTurnEvaluator.evaluate(makeCtx({ thought: "" }))).toBeNull();
  });
  test("required tools remaining → null", () => {
    const v = llmEndTurnEvaluator.evaluate(makeCtx({
      requiredTools: ["web-search"],
      toolsUsed: new Set(),
    }));
    expect(v).toBeNull();
  });
  test("stop reason not end_turn → null", () => {
    expect(llmEndTurnEvaluator.evaluate(makeCtx({ stopReason: "max_tokens" }))).toBeNull();
  });
});

describe("FinalAnswerRegex evaluator", () => {
  test("FINAL ANSWER: text → exit medium", () => {
    const v = finalAnswerRegexEvaluator.evaluate(makeCtx({ thought: "FINAL ANSWER: 42" }));
    expect(v?.action).toBe("exit");
    expect(v?.output).toBe("42");
  });
  test("**Final Answer**: text → exit medium", () => {
    const v = finalAnswerRegexEvaluator.evaluate(makeCtx({ thought: "**Final Answer**: Paris" }));
    expect(v?.action).toBe("exit");
  });
  test("**Final Answer** text (no colon) → exit medium", () => {
    const v = finalAnswerRegexEvaluator.evaluate(makeCtx({ thought: "**Final Answer** 105" }));
    expect(v?.action).toBe("exit");
  });
  test("no match → null", () => {
    expect(finalAnswerRegexEvaluator.evaluate(makeCtx({ thought: "I think the answer is 42" }))).toBeNull();
  });
  test("match in thinking field → exit", () => {
    const v = finalAnswerRegexEvaluator.evaluate(makeCtx({
      thought: "Let me think...",
      thinking: "FINAL ANSWER: done",
    }));
    expect(v?.action).toBe("exit");
  });
});
```

- [ ] **Step 6: Run all oracle tests**

Run: `cd packages/reasoning && bun test tests/shared/termination-oracle.test.ts`
Expected: All tests pass (~30+ test cases).

- [ ] **Step 7: Commit**

```
git add packages/reasoning/src/strategies/shared/termination-oracle.ts packages/reasoning/tests/shared/termination-oracle.test.ts
git commit -m "feat(reasoning): implement signal evaluators for termination oracle"
```

---

## Task 3: Oracle Regression Tests

**Files:**
- Modify: `packages/reasoning/tests/shared/termination-oracle.test.ts`

These tests reproduce the exact benchmark failures from the cross-provider analysis.

- [ ] **Step 1: Write regression tests**

Add to `termination-oracle.test.ts`:

```typescript
import { evaluateTermination, defaultEvaluators } from "../../src/strategies/shared/termination-oracle.js";

describe("benchmark regression scenarios", () => {
  test("Gemini '4' at iteration 0 with end_turn → exits", () => {
    const result = evaluateTermination(makeCtx({
      thought: "4",
      stopReason: "end_turn",
      iteration: 0,
    }), defaultEvaluators);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("LLMEndTurn");
  });

  test("GPT-4o-mini 'Paris' repeated 3 times → exits on 2nd via ContentStability", () => {
    const result = evaluateTermination(makeCtx({
      thought: "The capital of France is Paris.",
      priorThought: "The capital of France is Paris.",
      stopReason: "end_turn",
      iteration: 2,
    }), defaultEvaluators);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("ContentStability");
  });

  test("Qwen3 **Final Answer** 105 → exits via regex", () => {
    const result = evaluateTermination(makeCtx({
      thought: "**Final Answer** 105",
      stopReason: "end_turn",
    }), defaultEvaluators);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("FinalAnswerRegex");
  });

  test("Cogito 'Hello! How can I help?' on 'Hi' → exits via LLMEndTurn", () => {
    const result = evaluateTermination(makeCtx({
      thought: "Hello! How can I help you today?",
      stopReason: "end_turn",
      iteration: 0,
      taskDescription: "Hi",
    }), defaultEvaluators);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("LLMEndTurn");
  });

  test("Qwen3 scratchpad repeating after tool completion → exits via ContentStability", () => {
    const result = evaluateTermination(makeCtx({
      thought: "The capital of France is Paris.",
      priorThought: "The capital of France is Paris.",
      stopReason: "end_turn",
      toolsUsed: new Set(["scratchpad-write", "scratchpad-read"]),
      iteration: 5,
    }), defaultEvaluators);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("ContentStability");
  });

  test("entropy converging + end_turn → exits via EntropyConvergence", () => {
    const result = evaluateTermination(makeCtx({
      thought: "The answer is 42.",
      stopReason: "end_turn",
      entropy: { composite: 0.2 } as any,
      trajectory: { shape: "converging", derivative: -0.15, momentum: -0.1 },
    }), defaultEvaluators);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("EntropyConvergence");
  });

  test("tool call pending overrides everything", () => {
    const result = evaluateTermination(makeCtx({
      thought: "FINAL ANSWER: done",
      priorThought: "FINAL ANSWER: done",
      stopReason: "end_turn",
      toolRequest: { tool: "web-search", input: '{"q":"test"}' },
      entropy: { composite: 0.1 } as any,
      trajectory: { shape: "converging", derivative: -0.2, momentum: -0.1 },
    }), defaultEvaluators);
    expect(result.shouldExit).toBe(false);
    expect(result.evaluator).toBe("PendingToolCall");
  });

  test("no reactive intelligence → fallback works via ContentStability + LLMEndTurn", () => {
    // No entropy, no trajectory, no controller decisions
    const result = evaluateTermination(makeCtx({
      thought: "The answer is Paris.",
      stopReason: "end_turn",
      iteration: 1,
    }), defaultEvaluators);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("LLMEndTurn");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/reasoning && bun test tests/shared/termination-oracle.test.ts`
Expected: All pass.

- [ ] **Step 3: Commit**

```
git add packages/reasoning/tests/shared/termination-oracle.test.ts
git commit -m "test(reasoning): add benchmark regression tests for termination oracle"
```

---

## Task 4: Output Assembly

**Files:**
- Create: `packages/reasoning/src/strategies/shared/output-assembly.ts`
- Create: `packages/reasoning/tests/shared/output-assembly.test.ts`

- [ ] **Step 1: Implement output assembly**

Create `packages/reasoning/src/strategies/shared/output-assembly.ts`:

```typescript
import type { ReasoningStep } from "../../types/index.js";
import type { EntropyScoreLike } from "./termination-oracle.js";

export interface OutputAssemblyContext {
  readonly steps: readonly ReasoningStep[];
  readonly finalAnswer: string;
  readonly terminatedBy: string;
  readonly entropyScores?: readonly EntropyScoreLike[];
}

export interface AssembledOutput {
  readonly text: string;
  readonly codeBlocks: readonly string[];
  readonly sources: readonly string[];
}

/** Extract fenced or indented code blocks from text. */
export function extractCodeBlocks(text: string): string[] {
  const fenced = [...text.matchAll(/```[\w]*\n([\s\S]*?)```/g)].map((m) => m[0]);
  if (fenced.length > 0) return fenced;
  const indented = [...text.matchAll(/(?:^|\n)((?:[ ]{4,}[^\n]+\n?)+)/g)].map((m) => m[1]!);
  return indented;
}

/** Check if text contains code blocks. */
function hasCodeBlocks(text: string): boolean {
  return extractCodeBlocks(text).length > 0;
}

/**
 * Assemble final output from execution trace.
 * If the final answer is a short summary but earlier steps contain code,
 * prepend the best code block to the final answer.
 */
export function assembleOutput(ctx: OutputAssemblyContext): AssembledOutput {
  const { finalAnswer, steps, entropyScores } = ctx;

  // Rule 1: Final answer already has code or is substantial → use as-is
  if (hasCodeBlocks(finalAnswer) || finalAnswer.length > 200) {
    return { text: finalAnswer, codeBlocks: extractCodeBlocks(finalAnswer), sources: ["final_answer"] };
  }

  // Rule 2: Look for code blocks in preceding thought steps
  const thoughtSteps = steps.filter((s) => s.type === "thought" && s.content);
  const stepsWithCode: Array<{ index: number; code: string[]; content: string }> = [];

  for (let i = 0; i < thoughtSteps.length; i++) {
    const content = thoughtSteps[i]!.content;
    const code = extractCodeBlocks(content);
    if (code.length > 0) {
      stepsWithCode.push({ index: i, code, content });
    }
  }

  if (stepsWithCode.length === 0) {
    // No code found anywhere → use final answer as-is
    return { text: finalAnswer, codeBlocks: [], sources: ["final_answer"] };
  }

  // Rule 3: Pick best code step — lowest entropy (highest signal) or most recent
  let bestStep = stepsWithCode[stepsWithCode.length - 1]!; // default: most recent
  if (entropyScores && entropyScores.length > 0) {
    let lowestEntropy = Infinity;
    for (const step of stepsWithCode) {
      const score = entropyScores[step.index];
      if (score && score.composite < lowestEntropy) {
        lowestEntropy = score.composite;
        bestStep = step;
      }
    }
  }

  const assembled = bestStep.code.join("\n\n") + "\n\n" + finalAnswer;
  return {
    text: assembled,
    codeBlocks: bestStep.code,
    sources: [`step_${bestStep.index}`, "final_answer"],
  };
}
```

- [ ] **Step 2: Write output assembly tests**

Create `packages/reasoning/tests/shared/output-assembly.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { assembleOutput, extractCodeBlocks } from "../../src/strategies/shared/output-assembly.js";
import type { ReasoningStep } from "../../src/types/index.js";

describe("extractCodeBlocks", () => {
  test("extracts fenced code blocks", () => {
    const text = 'Some text\n```typescript\nconst x = 1;\n```\nMore text';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("const x = 1;");
  });

  test("returns empty for no code", () => {
    expect(extractCodeBlocks("Just plain text")).toHaveLength(0);
  });

  test("extracts multiple fenced blocks", () => {
    const text = '```js\na()\n```\nstuff\n```py\nb()\n```';
    expect(extractCodeBlocks(text)).toHaveLength(2);
  });
});

describe("assembleOutput", () => {
  const makeStep = (type: string, content: string): ReasoningStep =>
    ({ type, content, timestamp: Date.now() }) as any;

  test("final answer with code → pass-through", () => {
    const result = assembleOutput({
      finalAnswer: '```js\nfunction isPrime(n) { return true; }\n```\nDone.',
      steps: [],
      terminatedBy: "final_answer",
    });
    expect(result.text).toContain("isPrime");
    expect(result.sources).toEqual(["final_answer"]);
  });

  test("final answer > 200 chars → pass-through", () => {
    const longAnswer = "x".repeat(201);
    const result = assembleOutput({
      finalAnswer: longAnswer,
      steps: [makeStep("thought", "```js\ncode()\n```")],
      terminatedBy: "end_turn",
    });
    expect(result.text).toBe(longAnswer);
  });

  test("short summary + preceding code → code prepended", () => {
    const result = assembleOutput({
      finalAnswer: "The code is complete and correct.",
      steps: [
        makeStep("thought", "Let me write fizzbuzz:\n```js\nfunction fizzbuzz() { /* ... */ }\n```"),
        makeStep("action", "final-answer"),
      ],
      terminatedBy: "final_answer",
    });
    expect(result.text).toContain("fizzbuzz");
    expect(result.text).toContain("The code is complete and correct.");
    expect(result.codeBlocks).toHaveLength(1);
  });

  test("no code anywhere → pass-through", () => {
    const result = assembleOutput({
      finalAnswer: "Paris is the capital.",
      steps: [makeStep("thought", "Thinking about geography...")],
      terminatedBy: "end_turn",
    });
    expect(result.text).toBe("Paris is the capital.");
    expect(result.codeBlocks).toHaveLength(0);
  });

  test("multiple code steps + entropy → lowest entropy preferred", () => {
    const result = assembleOutput({
      finalAnswer: "Done.",
      steps: [
        makeStep("thought", "```js\nv1()\n```"),
        makeStep("thought", "```js\nv2()\n```"),
      ],
      terminatedBy: "end_turn",
      entropyScores: [
        { composite: 0.8 } as any,  // high entropy (step 0)
        { composite: 0.2 } as any,  // low entropy (step 1) — preferred
      ],
    });
    expect(result.text).toContain("v2()");
    expect(result.text).not.toContain("v1()");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd packages/reasoning && bun test tests/shared/output-assembly.test.ts`
Expected: All pass.

- [ ] **Step 4: Add re-export to shared index**

In `packages/reasoning/src/strategies/shared/index.ts`, add:

```typescript
export * from "./output-assembly.js";
```

- [ ] **Step 5: Commit**

```
git add packages/reasoning/src/strategies/shared/output-assembly.ts packages/reasoning/src/strategies/shared/index.ts packages/reasoning/tests/shared/output-assembly.test.ts
git commit -m "feat(reasoning): add trace-aware output assembly with code block preservation"
```

---

## Task 5: Expand FINAL ANSWER Regex in tool-utils.ts

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/tool-utils.ts`

- [ ] **Step 1: Add expanded regex and update hasFinalAnswer/extractFinalAnswer**

In `packages/reasoning/src/strategies/shared/tool-utils.ts`, add the expanded regex constant near the top (after existing imports), and update the two functions:

```typescript
/** Expanded regex matching FINAL ANSWER with optional markdown bold and various colon forms. */
export const FINAL_ANSWER_RE = /(?:\*{0,2})final\s*answer(?:\*{0,2})\s*[:：]?\s*/i;

export function hasFinalAnswer(thought: string): boolean {
  return FINAL_ANSWER_RE.test(thought);
}

export function extractFinalAnswer(thought: string): string {
  const match = thought.match(new RegExp(FINAL_ANSWER_RE.source + "([\\s\\S]*)", "i"));
  return match ? match[1]!.trim() : thought;
}
```

- [ ] **Step 2: Run existing tool-utils tests to verify no regression**

Run: `cd packages/reasoning && bun test`
Expected: All existing tests pass. The expanded regex is a superset of the old one.

- [ ] **Step 3: Commit**

```
git add packages/reasoning/src/strategies/shared/tool-utils.ts
git commit -m "feat(reasoning): expand FINAL ANSWER regex to match markdown variants"
```

---

## Task 6: KernelState Changes + Kernel Integration

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/kernel-state.ts`
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts`

- [ ] **Step 1: Add priorThought and llmCalls to KernelState**

In `packages/reasoning/src/strategies/shared/kernel-state.ts`, add to the `KernelState` interface after the `meta` field (around line 44):

```typescript
  // Termination oracle support
  readonly priorThought?: string;
  readonly llmCalls: number;
```

Find the `createInitialState` or equivalent factory function and ensure `llmCalls: 0` is set as default. If there's a spread pattern that constructs initial state, add `llmCalls: 0` there.

- [ ] **Step 2: Integrate oracle into handleThinking**

In `packages/reasoning/src/strategies/shared/react-kernel.ts`, in the `handleThinking` function:

1. After the LLM call returns (where `thoughtResponse` is set), increment `llmCalls`:
   ```typescript
   state = transitionState(state, { llmCalls: (state.llmCalls ?? 0) + 1 });
   ```

2. Build the `TerminationContext` from the current state and call the oracle. Replace the existing exit logic blocks (the `hasFinalAnswer` check at ~line 508 and the `end_turn` check at ~line 546) with:

   ```typescript
   import { evaluateTermination, defaultEvaluators, type TerminationContext } from "./termination-oracle.js";
   import { assembleOutput } from "./output-assembly.js";

   // Build oracle context
   const oracleCtx: TerminationContext = {
     thought: thought.trim(),
     thinking: thinking?.trim(),
     stopReason: thoughtResponse.stopReason ?? "end_turn",
     toolRequest,
     iteration: state.iteration,
     steps: state.steps,
     priorThought: state.priorThought,
     entropy: (state.meta.entropy as any)?.latestScore,
     trajectory: (state.meta.entropy as any)?.latestTrajectory,
     controllerDecisions: (state.meta.controllerDecisions as any[]) ?? undefined,
     toolsUsed: state.toolsUsed,
     requiredTools: (state.meta.requiredTools as string[]) ?? [],
     allToolSchemas: input.availableToolSchemas ?? [],
     redirectCount: (state.meta.redirectCount as number) ?? 0,
     priorFinalAnswerAttempts: (state.meta.priorFinalAnswerAttempts as number) ?? 0,
     taskDescription: input.task,
   };

   const decision = evaluateTermination(oracleCtx, defaultEvaluators);

   if (decision.shouldExit && decision.output) {
     const assembled = assembleOutput({
       steps: state.steps,
       finalAnswer: decision.output,
       terminatedBy: decision.reason,
       entropyScores: (state.meta.entropy as any)?.entropyHistory,
     });
     return transitionState(state, {
       status: "done" as const,
       output: assembled.text,
       priorThought: thought.trim(),
       meta: {
         ...state.meta,
         terminatedBy: decision.reason,
         evaluator: decision.evaluator,
         allVerdicts: decision.allVerdicts,
       },
     });
   }

   if (decision.action === "redirect") {
     // Inject completion gap feedback — preserve existing redirect logic
     return transitionState(state, {
       priorThought: thought.trim(),
       meta: { ...state.meta, redirectCount: ((state.meta.redirectCount as number) ?? 0) + 1 },
     });
   }

   // Continue — update priorThought for next iteration's stability check
   state = transitionState(state, { priorThought: thought.trim() });
   ```

3. Keep the `parseBareToolCall` guard that checks if a "final answer" is actually a tool call — this runs BEFORE the oracle (it modifies `toolRequest`).

4. Keep `handleActing`'s `final-answer` tool logic as-is. For the post-action FA check (lines ~878-903), replace with an oracle call using the stored `lastThought`.

- [ ] **Step 3: Run full reasoning test suite**

Run: `cd packages/reasoning && bun test`
Expected: All existing tests pass. Some tests may need minor updates if they assert on exact `state.meta` shape.

- [ ] **Step 4: Commit**

```
git add packages/reasoning/src/strategies/shared/kernel-state.ts packages/reasoning/src/strategies/shared/react-kernel.ts
git commit -m "feat(reasoning): integrate termination oracle into handleThinking"
```

---

## Task 7: Entropy Scoring Reorder in kernel-runner.ts

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/kernel-runner.ts`

- [ ] **Step 1: Reorder entropy scoring and pass controller decisions to kernel context**

In `kernel-runner.ts`, in the main loop:

1. After the kernel step produces a new state (the `transition` call), move the entropy scoring block (currently ~lines 142-194) to run immediately after.
2. After entropy scoring, run the reactive controller evaluation (currently ~lines 197-243).
3. Instead of setting `state.meta.earlyStopSignaled`, store the controller decisions on `state.meta.controllerDecisions` so the oracle can consume them:

   ```typescript
   // After entropy scoring:
   if (controllerDecisions.length > 0) {
     state = transitionState(state, {
       meta: { ...state.meta, controllerDecisions },
     });
   }
   ```

4. Remove the `earlyStopSignaled` flag logic in `react-kernel.ts` (the prompt injection at ~line 340 that appends "You have enough information. Produce your FINAL ANSWER now.") — the oracle now handles this directly.

- [ ] **Step 2: Run full reasoning test suite**

Run: `cd packages/reasoning && bun test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```
git add packages/reasoning/src/strategies/shared/kernel-runner.ts packages/reasoning/src/strategies/shared/react-kernel.ts
git commit -m "feat(reasoning): reorder entropy scoring before exit checks in kernel runner"
```

---

## Task 8: Prompt Improvements

**Files:**
- Modify: `packages/tools/src/skills/final-answer.ts`
- Modify: `packages/prompts/src/templates/reasoning/react-thought.ts`
- Modify: `packages/prompts/src/templates/reasoning/react-thought-local.ts`
- Modify: `packages/prompts/src/templates/reasoning/react-system-local.ts`

- [ ] **Step 1: Update final-answer tool description**

In `packages/tools/src/skills/final-answer.ts`, find the tool description string and append:

```
When your task involves code generation, your output field MUST contain the actual complete code — not a description of the code or a reference to code you wrote earlier.
```

- [ ] **Step 2: Add anti-conversational instruction to thought prompts**

In `packages/prompts/src/templates/reasoning/react-thought.ts` and `react-thought-local.ts`, add to the instruction block:

```
Do NOT ask follow-up questions like "Would you like me to continue?" or "Shall I proceed?". Complete the task fully in your response.
```

- [ ] **Step 3: Strengthen local tier system prompt**

In `packages/prompts/src/templates/reasoning/react-system-local.ts`, update the system prompt to:

```
You are a helpful assistant that uses tools when needed.
When you have your answer, you MUST either:
- Use the final-answer tool, OR
- Write "FINAL ANSWER:" followed by your complete response
Do not repeat your answer multiple times. Answer once, then stop.
```

- [ ] **Step 4: Add plan-execute output budget hint**

In `packages/reasoning/src/strategies/shared/plan-prompts.ts`, find the analysis step prompt (the prompt used when dispatching individual plan steps for analysis). Add to the instruction block:

```
Keep your analysis focused and concise. Aim for completeness, not exhaustiveness.
```

- [ ] **Step 5: Run tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```
git add packages/tools/src/skills/final-answer.ts packages/prompts/src/templates/reasoning/react-thought.ts packages/prompts/src/templates/reasoning/react-thought-local.ts packages/prompts/src/templates/reasoning/react-system-local.ts packages/reasoning/src/strategies/shared/plan-prompts.ts
git commit -m "feat(prompts): improve termination instructions and anti-conversational guidance"
```

---

## Task 9: Sub-Agent Fixes

**Files:**
- Modify: `packages/tools/src/adapters/agent-tool-adapter.ts`

- [ ] **Step 1: Fix input parameter schema**

In `agent-tool-adapter.ts`, find where the static sub-agent tool validates or processes the `input` parameter. Add normalization:

```typescript
const normalizedInput = typeof rawInput === "string"
  ? { query: rawInput }
  : rawInput;
```

Update the tool's parameter description to indicate it accepts string or object.

- [ ] **Step 2: Fix name propagation for static sub-agents**

Find where the sub-agent log prefix is constructed (look for `[sub-agent:` in the file). Ensure the static sub-agent's `name` field from `SubAgentConfig` is passed through. The dynamic sub-agent path already works — match that pattern.

- [ ] **Step 3: Tighten sub-agent defaults**

Find where `createLightRuntime` is called or where sub-agent runtime options are assembled. Set tighter defaults:

```typescript
const subAgentDefaults = {
  maxIterations: 3,
  enableMemory: false,
  enableDebrief: false,
  enableReactiveIntelligence: true,
};
```

Ensure user-configured `SubAgentConfig` values override these defaults.

- [ ] **Step 4: Run tools tests**

Run: `cd packages/tools && bun test`
Expected: All pass.

- [ ] **Step 5: Commit**

```
git add packages/tools/src/adapters/agent-tool-adapter.ts
git commit -m "fix(tools): accept string input for sub-agents, fix name propagation, tighten defaults"
```

---

## Task 10: Reactive Intelligence Default-On

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Modify: `packages/reactive-intelligence/src/types.ts`

- [ ] **Step 1: Change builder default**

In `packages/runtime/src/builder.ts`, find `_enableReactiveIntelligence` (line ~793):

Change: `private _enableReactiveIntelligence: boolean = false;`
To: `private _enableReactiveIntelligence: boolean = true;`

Add the boolean overload to `withReactiveIntelligence`:

```typescript
withReactiveIntelligence(enabled: boolean): this;
withReactiveIntelligence(options?: Partial<ReactiveIntelligenceConfig>): this;
withReactiveIntelligence(arg?: boolean | Partial<ReactiveIntelligenceConfig>): this {
  if (typeof arg === "boolean") {
    this._enableReactiveIntelligence = arg;
    return this;
  }
  this._enableReactiveIntelligence = true;
  if (arg) this._reactiveIntelligenceOptions = arg;
  return this;
}
```

- [ ] **Step 2: Enable controller features by default**

In `packages/reactive-intelligence/src/types.ts`, update `defaultReactiveIntelligenceConfig`:

```typescript
controller: {
  earlyStop: true,
  contextCompression: true,
  strategySwitch: true,
  branching: false,
  causalAttribution: false,
},
telemetry: false,
```

- [ ] **Step 3: Run full test suite and fix any breakage**

Run: `bun test`

Some tests may fail due to unexpected entropy fields in `state.meta`. Fix by either:
- Asserting on specific fields rather than exact meta shape
- Explicitly disabling RI in tests that need deterministic state: `.withReactiveIntelligence(false)`

- [ ] **Step 4: Add test for boolean overload**

Add a test (in the existing builder tests or a dedicated file) verifying `withReactiveIntelligence(false)` disables RI:

```typescript
test("withReactiveIntelligence(false) disables RI", () => {
  const builder = ReactiveAgents.create().withReactiveIntelligence(false);
  const config = builder.toConfig();
  expect(config.enableReactiveIntelligence).toBe(false);
});
```

- [ ] **Step 5: Commit**

```
git add packages/runtime/src/builder.ts packages/reactive-intelligence/src/types.ts
git commit -m "feat(runtime): make reactive intelligence default-on, telemetry opt-in"
```

---

## Task 11: Proportional Pipeline

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`

- [ ] **Step 1: Add TaskComplexity classification**

Add near the top of the execution engine or in a utilities section:

```typescript
type TaskComplexity = "trivial" | "moderate" | "complex";

function classifyComplexity(
  iteration: number,
  entropy: { composite: number } | undefined,
  toolCallCount: number,
  terminatedBy: string,
): TaskComplexity {
  if (iteration <= 1 && toolCallCount === 0 && terminatedBy !== "max_iterations") return "trivial";
  if (toolCallCount <= 2 && iteration <= 3 && (entropy ? entropy.composite < 0.4 : true)) return "moderate";
  return "complex";
}
```

- [ ] **Step 2: Add conditional memory-flush**

In the memory-flush phase (around line 2122), add the complexity check at the top:

```typescript
const complexity = classifyComplexity(
  iterationCount,
  latestEntropyScore,
  toolCallCount,
  terminatedBy,
);

if (complexity === "trivial") {
  // Skip memory-flush entirely
} else if (complexity === "moderate") {
  // Fire-and-forget: fork the flush as a daemon fiber
  yield* Effect.forkDaemon(memoryFlushEffect);
} else {
  // Full blocking pipeline
  yield* memoryFlushEffect;
}
```

Apply the same pattern to the debrief phase — skip for trivial and moderate.

- [ ] **Step 3: Surface complexity and llmCalls on AgentResult.metrics**

In the execution engine, after the reasoning phase completes (where `reasoningResult` is available), extract the values from the result metadata and pass them through to `AgentResult.metrics`:

```typescript
// Extract from reasoning result metadata
const llmCalls = reasoningResult?.metadata?.llmCalls ?? 0;
const iterationCount = reasoningResult?.metadata?.stepsCount ?? 0;
const toolCallCount = /* count from tool execution phase or state.toolsUsed.size */;
const terminatedBy = reasoningResult?.metadata?.terminatedBy ?? "unknown";
const latestEntropyScore = reasoningResult?.metadata?.entropy?.latestScore;

// Add to AgentResult.metrics
metrics.complexity = complexity;
metrics.llmCalls = llmCalls;
```

- [ ] **Step 4: Run tests**

Run: `bun test`
Expected: All pass.

- [ ] **Step 5: Commit**

```
git add packages/runtime/src/execution-engine.ts
git commit -m "feat(runtime): proportional post-processing based on task complexity"
```

---

## Task 12: Metrics & Test Harness

**Files:**
- Modify: `test.ts`

- [ ] **Step 1: Add provider-aware time multipliers**

In `test.ts`, add near the top:

```typescript
const TIME_MULTIPLIER: Record<string, number> = {
  anthropic: 1.0,
  openai: 1.0,
  gemini: 1.0,
  ollama: 3.0,
  litellm: 1.5,
};
```

Where time budget is checked, apply the multiplier:

```typescript
const adjustedMax = test.maxExpectedMs * (TIME_MULTIPLIER[provider] ?? 1.0);
```

Update the results reporting to show both raw time and adjusted pass/fail.

- [ ] **Step 2: Commit**

```
git add test.ts
git commit -m "feat(benchmarks): add provider-aware time budget multipliers"
```

---

## Task 13: Full Integration Test & Build Verification

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All 2,491+ tests pass.

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: All 22 packages build successfully.

- [ ] **Step 3: Run benchmark suite against at least one provider to verify improvement**

Run: `bun run test.ts` (with one available provider)
Compare results against baseline pass rates from the spec.

- [ ] **Step 4: Final commit if any fixes were needed**

Stage only the specific files that were fixed (avoid `git add -A` which could stage unrelated files):

```
git add <specific files that were fixed>
git commit -m "fix: integration fixes for kernel optimization"
```
