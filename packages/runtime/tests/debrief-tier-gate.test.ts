// Run: bun test packages/runtime/tests/debrief-tier-gate.test.ts --timeout 15000
//
// Cost honesty (v0.12) — tier-aware debrief skip. The rich LLM debrief synthesis
// is the single largest per-run overhead and, on the local tier, failed ~52% of
// the time (max_tokens / empty) while burning ~825 tok + ~6s per task (GH #143).
// On the local tier we keep the deterministic fallback record but skip the LLM
// synthesis entirely — proven here by zero LLM calls on a NON-trivial task
// (long output) where only the tier gate can be responsible for the skip.
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import {
  synthesizeAndStoreDebrief,
  type DebriefSynthesisDeps,
} from "../src/engine/finalize/debrief-synthesis.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../src/types.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

function makeCountingLLM() {
  let calls = 0;
  const layer = Layer.succeed(LLMService, {
    complete: () => {
      calls += 1;
      return Effect.succeed({
        content: JSON.stringify({ summary: "synth", keyFindings: [], errorsEncountered: [], lessonsLearned: [], caveats: "" }),
        stopReason: "end_turn",
        toolCalls: [],
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75, estimatedCost: 0 },
        model: "test",
      });
    },
    completeStructured: <A>() => {
      calls += 1;
      return Effect.succeed({ summary: "ok", rootCauses: [], keyInsights: [], retrySuggestions: [] } as A);
    },
    stream: () => Effect.die(new Error("not used")),
    embed: () => Effect.succeed([]),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => ({ provider: "test", model: "test", contextWindow: 8000 }),
    getStructuredOutputCapabilities: () => ({ nativeStructuredOutput: false }),
    capabilities: { nativeStructuredOutput: false, streaming: false, toolUse: false },
  } as never);
  return { layer, getCalls: () => calls };
}

// Non-trivial output (>100 chars) so the GH #143 trivial gate does NOT fire —
// the tier gate is then the only thing that can skip LLM synthesis.
const LONG_OUTPUT =
  "This is a deliberately long answer that exceeds one hundred characters so the trivial-task debrief gate does not short-circuit the synthesis path on its own.";

function makeDeps(tier: "local" | "mid" | "large" | undefined): DebriefSynthesisDeps {
  const config = defaultReactiveAgentsConfig("a-1", { enableMemory: true }) as ReactiveAgentsConfig;
  const withTier = {
    ...config,
    contextProfile: { ...(config.contextProfile ?? {}), tier },
  } as ReactiveAgentsConfig;
  const ctx = {
    taskId: "t-1" as never,
    agentId: "a-1" as never,
    sessionId: "s-1",
    phase: "complete" as const,
    iteration: 3,
    maxIterations: 10,
    tokensUsed: 100,
    cost: 0,
    startedAt: new Date(),
    agentState: "running",
    selectedStrategy: "reactive",
    messages: [],
    toolResults: [],
    metadata: {
      taskComplexity: "complex",
      reasoningResult: { output: LONG_OUTPUT, status: "completed", metadata: { cost: 0, tokensUsed: 0, stepsCount: 0, terminatedBy: "end_turn" } },
      reasoningSteps: [],
    } as ExecutionContext["metadata"],
  } as ExecutionContext;
  const task = {
    id: "t-1" as never,
    agentId: "a-1" as never,
    type: "query" as const,
    input: { question: "non-trivial" },
    priority: "medium" as const,
    status: "pending" as const,
    metadata: { tags: [] },
    createdAt: new Date(),
  };
  return {
    ctx,
    task,
    config: withTier,
    eb: null,
    rr: { output: LONG_OUTPUT, status: "completed", metadata: { terminatedBy: "end_turn" } },
    terminatedByRaw: "end_turn",
    sanitizedOutput: LONG_OUTPUT,
    outputForSuccess: LONG_OUTPUT,
    hasSubstantiveOutput: true,
    toolCallLog: [],
    rationaleLog: [],
  };
}

describe("debrief-synthesis tier-aware skip (cost honesty, v0.12)", () => {
  it("local tier + non-trivial task → fallback debrief built, ZERO LLM calls", async () => {
    const { layer, getCalls } = makeCountingLLM();
    const result = await Effect.runPromise(
      synthesizeAndStoreDebrief(makeDeps("local")).pipe(Effect.provide(layer)),
    );
    expect(result.debrief).toBeDefined();
    expect(result.debriefTokensUsed).toBe(0);
    expect(getCalls()).toBe(0);
  }, 15000);

  it("mid tier + non-trivial task → LLM synthesis runs (control)", async () => {
    const { layer, getCalls } = makeCountingLLM();
    await Effect.runPromise(
      synthesizeAndStoreDebrief(makeDeps("mid")).pipe(Effect.provide(layer)),
    );
    expect(getCalls()).toBeGreaterThanOrEqual(1);
  }, 15000);
});
