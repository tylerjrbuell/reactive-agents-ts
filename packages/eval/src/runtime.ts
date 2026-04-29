import { Layer } from "effect";
import { EvalServiceLive } from "./services/eval-service.js";
import { DatasetServiceLive } from "./services/dataset-service.js";

/**
 * createEvalLayer — provides EvalService + DatasetService.
 *
 * Requires: `JudgeLLMService` (from `@reactive-agents/eval`). Per Rule 4 of
 * `00-RESEARCH-DISCIPLINE.md` (frozen judge), the judge MUST be wired
 * separately from the SUT's `LLMService` — distinct provider, distinct code
 * path. Pre-W9 this layer resolved `LLMService` directly, which violated
 * all three Rule-4 isolation requirements.
 *
 * Wire example:
 *     Layer.merge(
 *       createLLMProviderLayer(sutConfig),         // SUT
 *       Layer.succeed(JudgeLLMService, judgeImpl), // judge — separate SDK
 *       createEvalLayer(),
 *     )
 */
export const createEvalLayer = () =>
  Layer.merge(EvalServiceLive, DatasetServiceLive);
