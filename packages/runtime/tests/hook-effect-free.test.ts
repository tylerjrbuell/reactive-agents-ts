import { describe, it, expect } from "bun:test";
import { Effect, Cause } from "effect";
import { LifecycleHookRegistry, LifecycleHookRegistryLive } from "../src/hooks.js";
import { HookError } from "../src/errors.js";
import type { ExecutionContext, LifecycleHook } from "../src/types.js";

const ctx = (iteration: number) =>
  ({ phase: "think", iteration } as unknown as ExecutionContext);

// Run a single hook through the real registry and return the resulting ctx.
const runHook = (hook: LifecycleHook, input: ExecutionContext) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const reg = yield* LifecycleHookRegistry;
      yield* reg.register(hook);
      return yield* reg.run(hook.phase, hook.timing, input);
    }).pipe(Effect.provide(LifecycleHookRegistryLive)),
  );

describe("effect-free lifecycle hooks — registry path", () => {
  it("plain sync handler returning a modified ctx replaces the context", async () => {
    const hook: LifecycleHook = {
      phase: "think",
      timing: "after",
      handler: (c) => ({ ...c, iteration: 99 }) as ExecutionContext,
    };
    const out = await runHook(hook, ctx(1));
    expect((out as { iteration: number }).iteration).toBe(99);
  });

  it("plain sync handler returning void leaves the context unchanged", async () => {
    const input = ctx(1);
    const hook: LifecycleHook = {
      phase: "think",
      timing: "after",
      handler: () => {
        /* observe only */
      },
    };
    const out = await runHook(hook, input);
    expect(out).toBe(input);
  });

  it("async handler returning a modified ctx is awaited", async () => {
    const hook: LifecycleHook = {
      phase: "think",
      timing: "after",
      handler: async (c) => ({ ...c, iteration: 7 }) as ExecutionContext,
    };
    const out = await runHook(hook, ctx(1));
    expect((out as { iteration: number }).iteration).toBe(7);
  });

  it("legacy Effect handler still works (regression)", async () => {
    const hook: LifecycleHook = {
      phase: "think",
      timing: "after",
      handler: (c) => Effect.succeed({ ...c, iteration: 42 } as ExecutionContext),
    };
    const out = await runHook(hook, ctx(1));
    expect((out as { iteration: number }).iteration).toBe(42);
  });

  it("throwing handler fails the run as HookError", async () => {
    const hook: LifecycleHook = {
      phase: "think",
      timing: "after",
      handler: () => {
        throw new Error("hook boom");
      },
    };
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const reg = yield* LifecycleHookRegistry;
        yield* reg.register(hook);
        return yield* reg.run("think", "after", ctx(1));
      }).pipe(Effect.provide(LifecycleHookRegistryLive)),
    );
    expect(exit._tag).toBe("Failure");
    // The thrown error must be wrapped as a HookError (registry mapError),
    // not leak the raw Error — this pins the documented contract.
    if (exit._tag === "Failure") {
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      expect(failure._tag === "Some" && failure.value instanceof HookError).toBe(true);
    }
  });
});
