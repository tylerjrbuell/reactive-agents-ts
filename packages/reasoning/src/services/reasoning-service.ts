// File: src/services/reasoning-service.ts
import { Context, Effect, Layer } from "effect";
import type {
  ReasoningResult,
  ReasoningStrategy,
} from "../types/index.js";
import type { ReasoningConfig } from "../types/config.js";
import { defaultReasoningConfig } from "../types/config.js";
import { StrategyRegistry, type StrategyFn } from "./strategy-registry.js";
import type { ReasoningErrors } from "../errors/errors.js";
import { LLMService } from "@reactive-agents/llm-provider";

// ─── Service Tag ───

export class ReasoningService extends Context.Tag("ReasoningService")<
  ReasoningService,
  {
    /**
     * Execute reasoning on a task.
     * If `strategy` is provided, uses that strategy directly.
     * Otherwise uses the configured default strategy.
     */
    readonly execute: (params: {
      readonly taskDescription: string;
      readonly taskType: string;
      readonly memoryContext: string;
      readonly availableTools: readonly string[];
      readonly strategy?: ReasoningStrategy;
    }) => Effect.Effect<ReasoningResult, ReasoningErrors>;

    /** Register a custom strategy function. */
    readonly registerStrategy: (
      name: ReasoningStrategy,
      fn: StrategyFn,
    ) => Effect.Effect<void>;
  }
>() {}

// ─── Live Layer ───
// Requires: StrategyRegistry, LLMService

export const ReasoningServiceLive = (
  config: ReasoningConfig = defaultReasoningConfig,
) =>
  Layer.effect(
    ReasoningService,
    Effect.gen(function* () {
      const registry = yield* StrategyRegistry;
      // Capture LLMService at layer construction time so we can provide
      // it to strategy functions when executing them.
      const llmService = yield* LLMService;
      const llmLayer = Layer.succeed(LLMService, llmService);

      return {
        execute: (params) =>
          Effect.gen(function* () {
            // ── Determine which strategy to use ──
            const strategyName: ReasoningStrategy =
              params.strategy ?? config.defaultStrategy;

            // ── Get strategy function from registry ──
            const strategyFn = yield* registry.get(strategyName);

            // ── Execute strategy, providing LLMService ──
            const result = yield* strategyFn({
              ...params,
              config,
            }).pipe(Effect.provide(llmLayer));

            return result;
          }),

        registerStrategy: (name, fn) => registry.register(name, fn),
      };
    }),
  );
