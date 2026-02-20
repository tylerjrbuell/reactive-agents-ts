// File: src/services/strategy-registry.ts
import { Context, Effect, Layer, Ref } from "effect";
import type { ReasoningResult, ReasoningStrategy } from "../types/index.js";
import type { ReasoningConfig } from "../types/config.js";
import {
  StrategyNotFoundError,
  type ExecutionError,
  type IterationLimitError,
} from "../errors/errors.js";
import type { LLMService } from "@reactive-agents/llm-provider";
import { executeReactive } from "../strategies/reactive.js";
import { executeReflexion } from "../strategies/reflexion.js";

// ─── Strategy function type ───

export type StrategyFn = (input: {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
}) => Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
>;

// ─── Service Tag ───

export class StrategyRegistry extends Context.Tag("StrategyRegistry")<
  StrategyRegistry,
  {
    readonly get: (
      name: ReasoningStrategy,
    ) => Effect.Effect<StrategyFn, StrategyNotFoundError>;

    readonly register: (
      name: ReasoningStrategy,
      fn: StrategyFn,
    ) => Effect.Effect<void>;

    readonly list: () => Effect.Effect<readonly ReasoningStrategy[]>;
  }
>() {}

// ─── Live Layer (Phase 1: reactive only) ───

export const StrategyRegistryLive = Layer.effect(
  StrategyRegistry,
  Effect.gen(function* () {
    // Ref-based mutable map of strategies
    const registryRef = yield* Ref.make<Map<string, StrategyFn>>(
      new Map<string, StrategyFn>([
        ["reactive", executeReactive],
        ["reflexion", executeReflexion],
      ]),
    );

    return {
      get: (name) =>
        Effect.gen(function* () {
          const registry = yield* Ref.get(registryRef);
          const fn = registry.get(name);
          if (!fn) {
            return yield* Effect.fail(
              new StrategyNotFoundError({ strategy: name }),
            );
          }
          return fn;
        }),

      register: (name, fn) =>
        Ref.update(registryRef, (m) => {
          const next = new Map(m);
          next.set(name, fn);
          return next;
        }),

      list: () =>
        Ref.get(registryRef).pipe(
          Effect.map((m) => Array.from(m.keys()) as ReasoningStrategy[]),
        ),
    };
  }),
);
