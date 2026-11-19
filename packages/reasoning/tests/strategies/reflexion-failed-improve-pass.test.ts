// Run: bun test packages/reasoning/tests/strategies/reflexion-failed-improve-pass.test.ts --timeout 20000
//
// QA N3 (wiki/Research/Harness-Reports/2026-11-19-v0.19-qa-strategy-matrix.md,
// gemini run 01M7T4DTX245N6AYNV59TMQ7J5): the critique judged the draft
// UNSATISFIED (truncated, values missing), the final improve pass's model call
// failed (a provider 400), and reflexion carried the rejected draft through the
// failed pass (`improvePass.output || s.response`). The result was `partial`
// with that draft and `terminatedBy: "end_turn"`, which the runtime's
// partial-with-output lane turned into `success`, while the trace said
// `llm_error`.
//
// The shared substrate now owns that ending (`answer-pass-error.ts`): a Result
// whose answering pass ended on a provider error, holding an answer the
// strategy never accepted, fails with output "" and the cause on `error`, and
// the claim names `llm_error` so the result agrees with the trace. An answer
// the strategy's own check accepted still ships.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { createToolsLayer, ToolService } from "@reactive-agents/tools";
import { ReasoningService, ReasoningServiceLive } from "../../src/services/reasoning-service.js";
import { StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { applyAnswerPassError, answerPassErrorClaim } from "../../src/strategies/substrate/answer-pass-error.js";
import type { PassResult } from "../../src/kernel/loop/run-pass.js";
import { initialKernelState, type KernelState } from "../../src/kernel/state/kernel-state.js";

const popTool = {
  name: "city-population",
  description: "Look up the population of one city",
  parameters: [{ name: "city", type: "string" as const, description: "City name", required: true }],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};
const popSchema = { name: popTool.name, description: popTool.description, parameters: popTool.parameters };

const config = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reflexion: { ...defaultReasoningConfig.strategies.reflexion, maxRetries: 1 },
  },
};

const PROVIDER_400 = "400 Function call is missing a thought_signature in functionCall parts.";
const TRUNCATED_DRAFT = "FINAL ANSWER: Tokyo 13960000, Paris 2";

/** Generate: one tool call, then a truncated draft. Critique: UNSATISFIED. Improve: the provider 400s (repeats). */
const TURNS: TestTurn[] = [
  { toolCall: { id: "p1", name: popTool.name, args: { city: "Tokyo" } } },
  { text: TRUNCATED_DRAFT },
  { text: "UNSATISFIED: the response is truncated and Paris is missing its population." },
  { error: PROVIDER_400 },
];

describe("reflexion: a failed final improve pass never ships the rejected draft (QA N3)", () => {
  it("fails with output \"\", the cause on error, and terminatedBy llm_error", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(popTool, (args) => Effect.succeed({ city: String(args.city), population: 13960000 }));
      const reasoning = yield* ReasoningService;
      return yield* reasoning.execute({
        taskDescription: "Look up the population of Tokyo and Paris with city-population and report both.",
        taskType: "research",
        memoryContext: "",
        availableTools: [popTool.name],
        availableToolSchemas: [popSchema],
        strategy: "reflexion",
        taskId: "n3-reflexion",
      });
    });
    const base = Layer.mergeAll(TestLLMServiceLayer(TURNS), createToolsLayer(), StrategyRegistryLive, EventBusLive);
    const result = await Effect.runPromise(program.pipe(Effect.provide(Layer.provideMerge(ReasoningServiceLive(config), base))));

    expect(result.status).toBe("failed");
    expect(result.output ?? "").toBe("");
    expect(result.metadata.terminatedBy).toBe("llm_error");
    expect(String(result.error ?? "")).toContain("final model call failed");
  }, 20000);
});

describe("answer-pass-error: the substrate rule (seam)", () => {
  const passEnded = (terminatedBy: string, status: KernelState["status"]): PassResult => {
    const base = initialKernelState({ maxIterations: 4, strategy: "reflexion", kernelType: "react", taskId: "seam" });
    const state: KernelState = { ...base, status, error: "boom", meta: { ...base.meta, terminatedBy } };
    return { state, output: null, tokens: 0, inputTokens: 0, outputTokens: 0, cost: 0, steps: [], messages: [], hadToolCalls: false };
  };
  const failedPass = passEnded("llm_error", "failed");
  const cleanPass = passEnded("final_answer", "done");

  it("fails an unaccepted answer held through a provider-failed answering pass", () => {
    const end = applyAnswerPassError({ output: "draft", status: "partial" as const, basedOn: failedPass });
    expect(end.status).toBe("failed");
    expect(end.output).toBe("");
    expect(end.error).toContain("(boom)");
  });

  it("keeps an answer the strategy's own check accepted", () => {
    const end = applyAnswerPassError({ output: "draft", status: "completed" as const, basedOn: failedPass, answerAccepted: true });
    expect(end.status).toBe("completed");
    expect(end.output).toBe("draft");
  });

  it("leaves a clean answering pass alone", () => {
    const end = applyAnswerPassError({ output: "draft", status: "partial" as const, basedOn: cleanPass });
    expect(end).toEqual({ output: "draft", status: "partial", basedOn: cleanPass });
  });

  it("claims llm_error for a non-completed answer of a failed pass; final_answer only when completed", () => {
    expect(answerPassErrorClaim("failed", failedPass)).toBe("llm_error");
    expect(answerPassErrorClaim("partial", failedPass)).toBe("llm_error");
    expect(answerPassErrorClaim("completed", failedPass)).toBe("final_answer");
    expect(answerPassErrorClaim("partial", cleanPass)).toBe("end_turn");
  });
});
