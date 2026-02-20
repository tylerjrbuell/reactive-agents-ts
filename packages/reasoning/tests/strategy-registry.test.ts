// File: tests/strategy-registry.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  StrategyRegistry,
  StrategyRegistryLive,
} from "../src/services/strategy-registry.js";
import { StrategyNotFoundError } from "../src/errors/errors.js";

describe("StrategyRegistry", () => {
  it("should have reactive strategy registered by default", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* StrategyRegistry;
      const strategies = yield* registry.list();
      expect(strategies).toContain("reactive");
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(StrategyRegistryLive)),
    );
  });

  it("should retrieve registered strategy", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* StrategyRegistry;
      const fn = yield* registry.get("reactive");
      expect(typeof fn).toBe("function");
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(StrategyRegistryLive)),
    );
  });

  it("should fail with StrategyNotFoundError for unknown strategy", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* StrategyRegistry;
      return yield* registry.get("tree-of-thought");
    });

    const result = await Effect.runPromiseExit(
      program.pipe(Effect.provide(StrategyRegistryLive)),
    );

    // Should have failed
    expect(result._tag).toBe("Failure");
  });

  it("should allow registering custom strategies", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* StrategyRegistry;

      // Register a custom strategy
      const customFn = () =>
        Effect.succeed({
          strategy: "reflexion" as const,
          steps: [],
          output: "custom result",
          metadata: {
            duration: 0,
            cost: 0,
            tokensUsed: 0,
            stepsCount: 0,
            confidence: 1,
          },
          status: "completed" as const,
        });

      yield* registry.register("reflexion", customFn as any);

      const strategies = yield* registry.list();
      expect(strategies).toContain("reflexion");

      const fn = yield* registry.get("reflexion");
      expect(typeof fn).toBe("function");
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(StrategyRegistryLive)),
    );
  });
});
