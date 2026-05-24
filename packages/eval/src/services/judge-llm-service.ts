// JudgeLLMService — frozen judge per Rule 4 of 00-RESEARCH-DISCIPLINE.md.
//
// The eval framework MUST use a judge that does not share a code path with the
// system being measured. Using the SUT's own LLMService for scoring means the
// judge sees the same providers, drivers, healing pipeline, and adapters as
// the agent under test — any bug in the SUT can corrupt the verdict, and any
// improvement is double-counted.
//
// Stage 5 W9 fix (FIX-21): the prior eval-service.ts resolved `LLMService`
// directly, which violated all three Rule-4 requirements (fixed model FAIL,
// code-path isolation FAIL, code-SHA pinning N/A). This Tag splits the
// concerns: `LLMService` is the SUT's provider stack; `JudgeLLMService` is
// the frozen reference. Consumers wire the judge separately, often pointed
// at a different provider/model entirely (e.g. claude-haiku scoring a cogito
// run).

import { Context, Effect, Layer } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { CompletionRequest, CompletionResponse, LLMErrors } from "@reactive-agents/llm-provider";

export interface JudgeLLMServiceShape {
  readonly complete: (request: CompletionRequest) => Effect.Effect<CompletionResponse, LLMErrors>;
}

/**
 * Frozen-judge LLM service. Distinct from `@reactive-agents/llm-provider`'s
 * `LLMService` so the eval framework's scoring path cannot share a code path
 * with the system under test (Rule 4 of 00-RESEARCH-DISCIPLINE.md).
 */
export class JudgeLLMService extends Context.Tag("JudgeLLMService")<
  JudgeLLMService,
  JudgeLLMServiceShape
>() {}

/**
 * Convenience Layer that derives a `JudgeLLMService` from the in-scope
 * `LLMService`. Use this in DEMOS, SMOKE WITNESSES, and TEST runs where
 * Rule 4 isolation isn't required (e.g. example 16 eval-framework smoke
 * uses the same test-provider scenario for both the SUT and the judge).
 *
 * Production eval that must respect Rule 4 (judge isolated from SUT)
 * should provide its own `JudgeLLMService` Layer pointed at a different
 * provider/model — do NOT use this helper.
 *
 * Closes smoke L1 finding (`Service not found: JudgeLLMService` when a
 * single-provider build is used for both SUT and judge).
 */
export const JudgeFromLLMServiceLive: Layer.Layer<JudgeLLMService, never, LLMService> =
  Layer.effect(
    JudgeLLMService,
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return JudgeLLMService.of({ complete: llm.complete });
    }),
  );
