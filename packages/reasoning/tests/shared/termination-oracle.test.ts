import { describe, test, expect } from "bun:test";
import {
  evaluateTermination,
  normalizedLevenshtein,
  pendingToolCallEvaluator,
  entropyConvergenceEvaluator,
  reactiveControllerEarlyStopEvaluator,
  contentStabilityEvaluator,
  llmEndTurnEvaluator,
  finalAnswerRegexEvaluator,
  completionGapEvaluator,
  defaultEvaluators,
  type TerminationContext,
  type TerminationSignalEvaluator,
} from "../../src/strategies/shared/termination-oracle.js";

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

// ── normalizedLevenshtein ────────────────────────────────────────────────────

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

// ── PendingToolCall evaluator ────────────────────────────────────────────────

describe("pendingToolCallEvaluator", () => {
  test("tool request present → continue high", () => {
    const ctx = makeCtx({ toolRequest: { tool: "web-search", input: '{"query":"test"}' } });
    const result = pendingToolCallEvaluator.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("continue");
    expect(result!.confidence).toBe("high");
    expect(result!.reason).toBe("tool_call_pending");
  });

  test("no tool request → null", () => {
    const ctx = makeCtx({ toolRequest: null });
    expect(pendingToolCallEvaluator.evaluate(ctx)).toBeNull();
  });
});

// ── EntropyConvergence evaluator ─────────────────────────────────────────────

describe("entropyConvergenceEvaluator", () => {
  const convergingTrajectory = {
    shape: "converging" as const,
    derivative: -0.1,
    momentum: 0.5,
  };
  const flatTrajectory = {
    shape: "flat" as const,
    derivative: 0,
    momentum: 0.0,
  };

  test("converging + end_turn → exit high", () => {
    const ctx = makeCtx({
      entropy: { composite: 0.3, trajectory: convergingTrajectory },
      trajectory: convergingTrajectory,
      stopReason: "end_turn",
      thought: "The answer is 42.",
    });
    const result = entropyConvergenceEvaluator.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("exit");
    expect(result!.confidence).toBe("high");
    expect(result!.reason).toBe("entropy_converged");
  });

  test("flat trajectory → null", () => {
    const ctx = makeCtx({
      entropy: { composite: 0.5, trajectory: flatTrajectory },
      trajectory: flatTrajectory,
      stopReason: "end_turn",
    });
    expect(entropyConvergenceEvaluator.evaluate(ctx)).toBeNull();
  });

  test("no entropy → null", () => {
    const ctx = makeCtx({ stopReason: "end_turn" });
    expect(entropyConvergenceEvaluator.evaluate(ctx)).toBeNull();
  });

  test("stop reason not end_turn → null", () => {
    const ctx = makeCtx({
      entropy: { composite: 0.3, trajectory: convergingTrajectory },
      trajectory: convergingTrajectory,
      stopReason: "max_tokens",
    });
    expect(entropyConvergenceEvaluator.evaluate(ctx)).toBeNull();
  });
});

// ── ReactiveControllerEarlyStop evaluator ────────────────────────────────────

describe("reactiveControllerEarlyStopEvaluator", () => {
  test("early-stop decision → exit high", () => {
    const ctx = makeCtx({
      controllerDecisions: [{ decision: "early-stop", reason: "loop detected" }],
      thought: "I think I have the answer.",
    });
    const result = reactiveControllerEarlyStopEvaluator.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("exit");
    expect(result!.confidence).toBe("high");
    expect(result!.reason).toContain("controller_early_stop");
    expect(result!.reason).toContain("loop detected");
  });

  test("no decisions → null", () => {
    const ctx = makeCtx({ controllerDecisions: undefined });
    expect(reactiveControllerEarlyStopEvaluator.evaluate(ctx)).toBeNull();
  });

  test("non-early-stop decision → null", () => {
    const ctx = makeCtx({
      controllerDecisions: [{ decision: "compress", reason: "context too large" }],
    });
    expect(reactiveControllerEarlyStopEvaluator.evaluate(ctx)).toBeNull();
  });

  test("empty decisions array → null", () => {
    const ctx = makeCtx({ controllerDecisions: [] });
    expect(reactiveControllerEarlyStopEvaluator.evaluate(ctx)).toBeNull();
  });
});

// ── ContentStability evaluator ───────────────────────────────────────────────

describe("contentStabilityEvaluator", () => {
  test("identical thoughts → exit high", () => {
    const ctx = makeCtx({
      thought: "The answer is Paris.",
      priorThought: "The answer is Paris.",
      toolRequest: null,
    });
    const result = contentStabilityEvaluator.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("exit");
    expect(result!.confidence).toBe("high");
    expect(result!.reason).toBe("content_stable");
  });

  test("very similar substantive thoughts (>= 100 chars) → exit medium", () => {
    const ctx = makeCtx({
      thought: "The capital of France is Paris, which is a beautiful city known for its art, culture, architecture, and historical landmarks such as the Eiffel Tower.",
      priorThought: "The capital of France is Paris, which is a beautiful city known for its art, culture, architecture, and historical landmarks such as the Eiffel Tower!",
      toolRequest: null,
    });
    const result = contentStabilityEvaluator.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("exit");
    expect(result!.confidence).toBe("medium");
  });

  test("very similar short thoughts (< 100 chars) → null (fuzzy requires length)", () => {
    const ctx = makeCtx({
      thought: "The capital of France is Paris, which is a beautiful city.",
      priorThought: "The capital of France is Paris, which is a beautiful city!",
      toolRequest: null,
    });
    // Short strings skip fuzzy match to avoid false positives
    expect(contentStabilityEvaluator.evaluate(ctx)).toBeNull();
  });

  test("different thoughts → null", () => {
    const ctx = makeCtx({
      thought: "I need to search for the answer.",
      priorThought: "The answer is 42.",
      toolRequest: null,
    });
    expect(contentStabilityEvaluator.evaluate(ctx)).toBeNull();
  });

  test("tool request pending → null", () => {
    const ctx = makeCtx({
      thought: "The answer is Paris.",
      priorThought: "The answer is Paris.",
      toolRequest: { tool: "web-search", input: "{}" },
    });
    expect(contentStabilityEvaluator.evaluate(ctx)).toBeNull();
  });

  test("no prior thought → null", () => {
    const ctx = makeCtx({
      thought: "The answer is 42.",
      priorThought: undefined,
    });
    expect(contentStabilityEvaluator.evaluate(ctx)).toBeNull();
  });
});

// ── LLMEndTurn evaluator ─────────────────────────────────────────────────────

describe("llmEndTurnEvaluator", () => {
  test("end_turn + substantive thought + iteration >= 1 + no required tools → exit medium", () => {
    const ctx = makeCtx({
      stopReason: "end_turn",
      thought: "The answer to this question about the capital of France is Paris, which is well known.",
      iteration: 1,
      requiredTools: [],
      toolsUsed: new Set(),
    });
    const result = llmEndTurnEvaluator.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("exit");
    expect(result!.confidence).toBe("medium");
    expect(result!.reason).toBe("llm_end_turn");
  });

  test("iteration 0 → null (requires at least one prior iteration)", () => {
    const ctx = makeCtx({
      stopReason: "end_turn",
      thought: "The answer to this question about the capital of France is Paris, which is well known.",
      iteration: 0,
      requiredTools: [],
      toolsUsed: new Set(),
    });
    const result = llmEndTurnEvaluator.evaluate(ctx);
    expect(result).toBeNull();
  });

  test("short thought (< 50 chars) → null", () => {
    const ctx = makeCtx({
      stopReason: "end_turn",
      thought: "Done.",
      iteration: 1,
      requiredTools: [],
      toolsUsed: new Set(),
    });
    const result = llmEndTurnEvaluator.evaluate(ctx);
    expect(result).toBeNull();
  });

  test("empty thought → null", () => {
    const ctx = makeCtx({
      stopReason: "end_turn",
      thought: "   ",
    });
    expect(llmEndTurnEvaluator.evaluate(ctx)).toBeNull();
  });

  test("required tools remaining → null", () => {
    const ctx = makeCtx({
      stopReason: "end_turn",
      thought: "The answer is 4.",
      requiredTools: ["web-search"],
      toolsUsed: new Set(),
    });
    expect(llmEndTurnEvaluator.evaluate(ctx)).toBeNull();
  });

  test("not end_turn stop reason → null", () => {
    const ctx = makeCtx({
      stopReason: "max_tokens",
      thought: "The answer is 4.",
    });
    expect(llmEndTurnEvaluator.evaluate(ctx)).toBeNull();
  });

  test("required tools all used + iteration >= 1 + substantive thought → exits", () => {
    const ctx = makeCtx({
      stopReason: "end_turn",
      thought: "Based on the web search results, the answer to the question is definitely 4.",
      iteration: 1,
      requiredTools: ["web-search"],
      toolsUsed: new Set(["web-search"]),
    });
    const result = llmEndTurnEvaluator.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("exit");
  });
});

// ── FinalAnswerRegex evaluator ───────────────────────────────────────────────

describe("finalAnswerRegexEvaluator", () => {
  test('"FINAL ANSWER: 42" → exit medium with output "42"', () => {
    const ctx = makeCtx({ thought: "FINAL ANSWER: 42" });
    const result = finalAnswerRegexEvaluator.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("exit");
    expect(result!.confidence).toBe("medium");
    expect(result!.reason).toBe("final_answer_regex");
    expect(result!.output).toBe("42");
  });

  test('"**Final Answer**: Paris" → exit', () => {
    const ctx = makeCtx({ thought: "**Final Answer**: Paris" });
    const result = finalAnswerRegexEvaluator.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("exit");
    // extractFinalAnswer uses /final answer:/i which doesn't match markdown bold,
    // so it falls back to returning the full thought as the output
    expect(result!.output).toContain("Paris");
  });

  test('"**Final Answer** 105" → exit', () => {
    const ctx = makeCtx({ thought: "**Final Answer** 105" });
    const result = finalAnswerRegexEvaluator.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("exit");
    // extractFinalAnswer falls back to full thought when no "final answer:" match
    // The output should contain the number
    expect(result!.output).toBeTruthy();
  });

  test("no match → null", () => {
    const ctx = makeCtx({ thought: "I need to search for more information." });
    expect(finalAnswerRegexEvaluator.evaluate(ctx)).toBeNull();
  });

  test("match in thinking field → exit", () => {
    const ctx = makeCtx({
      thought: "Let me think about this...",
      thinking: "FINAL ANSWER: The capital is Berlin.",
    });
    const result = finalAnswerRegexEvaluator.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("exit");
  });

  test("final answer with multiline output → exit", () => {
    const ctx = makeCtx({ thought: "FINAL ANSWER: Line one\nLine two\nLine three" });
    const result = finalAnswerRegexEvaluator.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.output).toContain("Line one");
  });
});

// ── CompletionGap evaluator ──────────────────────────────────────────────────

describe("completionGapEvaluator", () => {
  test("redirectCount >= 1 → null", () => {
    const ctx = makeCtx({ redirectCount: 1 });
    expect(completionGapEvaluator.evaluate(ctx)).toBeNull();
  });

  test("redirectCount = 0 → null (default no opinion)", () => {
    const ctx = makeCtx({ redirectCount: 0 });
    expect(completionGapEvaluator.evaluate(ctx)).toBeNull();
  });
});

// ── Benchmark regression scenarios ──────────────────────────────────────────

describe("benchmark regression scenarios", () => {
  test("Gemini '4' at iteration 0 with end_turn → continues (too short, iteration 0)", () => {
    const result = evaluateTermination(makeCtx({
      thought: "4",
      stopReason: "end_turn",
      iteration: 0,
    }), defaultEvaluators);
    // Short thought at iteration 0 — no evaluator fires
    expect(result.shouldExit).toBe(false);
    expect(result.evaluator).toBe("none");
  });

  test("Gemini '4' at iteration 1 with prior identical thought → exits via ContentStability", () => {
    const result = evaluateTermination(makeCtx({
      thought: "4",
      priorThought: "4",
      stopReason: "end_turn",
      iteration: 1,
    }), defaultEvaluators);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("ContentStability");
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

  test("Qwen3 **Final Answer** 105 → exits via FinalAnswerRegex", () => {
    const result = evaluateTermination(makeCtx({
      thought: "**Final Answer** 105",
      stopReason: "end_turn",
    }), defaultEvaluators);
    expect(result.shouldExit).toBe(true);
    // FinalAnswerRegex appears before LLMEndTurn in defaultEvaluators and extracts clean output
    expect(result.evaluator).toBe("FinalAnswerRegex");
    expect(result.output).toBe("105");
  });

  test("Cogito 'Hello! How can I help?' on 'Hi' at iteration 0 → continues (short, iteration 0)", () => {
    const result = evaluateTermination(makeCtx({
      thought: "Hello! How can I help you today?",
      stopReason: "end_turn",
      iteration: 0,
      taskDescription: "Hi",
    }), defaultEvaluators);
    // 31 chars < 50 and iteration 0 — LLMEndTurn does not fire
    expect(result.shouldExit).toBe(false);
  });

  test("Cogito 'Hello! How can I help?' on 'Hi' at iteration 1 with prior identical → exits via ContentStability", () => {
    const result = evaluateTermination(makeCtx({
      thought: "Hello! How can I help you today?",
      priorThought: "Hello! How can I help you today?",
      stopReason: "end_turn",
      iteration: 1,
      taskDescription: "Hi",
    }), defaultEvaluators);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("ContentStability");
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

  test("no reactive intelligence → fallback works via LLMEndTurn for substantive response", () => {
    // No entropy, no trajectory, no controller decisions
    const result = evaluateTermination(makeCtx({
      thought: "The answer to the question about the capital of France is Paris.",
      stopReason: "end_turn",
      iteration: 1,
    }), defaultEvaluators);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("LLMEndTurn");
  });

  test("no reactive intelligence → short response at iteration 1 continues", () => {
    const result = evaluateTermination(makeCtx({
      thought: "The answer is Paris.",
      stopReason: "end_turn",
      iteration: 1,
    }), defaultEvaluators);
    // 20 chars < 50 — LLMEndTurn does not fire
    expect(result.shouldExit).toBe(false);
  });
});
