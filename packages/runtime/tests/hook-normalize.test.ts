import { describe, it, expect } from "bun:test";
import { Effect, Cause, Exit } from "effect";
import { normalizeHookResult, runHookResultForSideEffect } from "../src/hooks-normalize.js";
import type { ExecutionContext } from "../src/types.js";

// Minimal ExecutionContext stand-in — only identity matters for these tests.
const baseCtx = { phase: "think", iteration: 1 } as unknown as ExecutionContext;
const nextCtx = { phase: "think", iteration: 2 } as unknown as ExecutionContext;

const run = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(eff);

describe("normalizeHookResult", () => {
  it("plain ctx return → yields that ctx", async () => {
    const out = await run(normalizeHookResult(() => nextCtx, baseCtx));
    expect(out).toBe(nextCtx);
  });

  it("void/undefined return → yields the original ctx unchanged", async () => {
    const out = await run(normalizeHookResult(() => undefined, baseCtx));
    expect(out).toBe(baseCtx);
  });

  it("Promise<ctx> return → awaits and yields it", async () => {
    const out = await run(normalizeHookResult(() => Promise.resolve(nextCtx), baseCtx));
    expect(out).toBe(nextCtx);
  });

  it("Promise<void> return → yields the original ctx", async () => {
    const out = await run(normalizeHookResult(() => Promise.resolve(undefined), baseCtx));
    expect(out).toBe(baseCtx);
  });

  it("Effect<ctx> return → runs it and yields it (back-compat)", async () => {
    const out = await run(normalizeHookResult(() => Effect.succeed(nextCtx), baseCtx));
    expect(out).toBe(nextCtx);
  });

  // Extract the failure value from an Exit, asserting it failed first.
  const failValue = (exit: Exit.Exit<unknown, unknown>): unknown => {
    expect(exit._tag).toBe("Failure");
    if (exit._tag !== "Failure") return undefined;
    const opt = Cause.failureOption(exit.cause);
    expect(opt._tag).toBe("Some");
    return opt._tag === "Some" ? opt.value : undefined;
  };

  it("sync throw → fails with the original thrown error as the cause", async () => {
    const eff = normalizeHookResult(() => { throw new Error("boom"); }, baseCtx);
    const cause = failValue(await Effect.runPromiseExit(eff));
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toBe("boom");
  });

  it("rejected Promise → fails with the rejection error as the cause", async () => {
    const eff = normalizeHookResult(() => Promise.reject(new Error("nope")), baseCtx);
    const cause = failValue(await Effect.runPromiseExit(eff));
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toBe("nope");
  });

  it("failed Effect → fails with the original error as the cause (back-compat)", async () => {
    const eff = normalizeHookResult(() => Effect.fail(new Error("eff-fail")), baseCtx);
    const cause = failValue(await Effect.runPromiseExit(eff));
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toBe("eff-fail");
  });
});

describe("runHookResultForSideEffect", () => {
  it("awaits a Promise return", async () => {
    let ran = false;
    await runHookResultForSideEffect(
      Promise.resolve().then(() => { ran = true; }),
    );
    expect(ran).toBe(true);
  });

  it("runs an Effect return (legacy form executes for side effects)", async () => {
    let ran = false;
    await runHookResultForSideEffect(
      Effect.sync(() => { ran = true; return nextCtx; }),
    );
    expect(ran).toBe(true);
  });

  it("plain/void return resolves without throwing", async () => {
    // Reaching the end without either await rejecting is the assertion.
    await runHookResultForSideEffect(nextCtx);
    await runHookResultForSideEffect(undefined);
  });

  it("a rejected Promise propagates (caller surfaces it)", async () => {
    await expect(
      runHookResultForSideEffect(Promise.reject(new Error("x"))),
    ).rejects.toThrow("x");
  });

  it("a failed Effect propagates (caller surfaces it)", async () => {
    // Effect.runPromise rejects with a FiberFailure (an Error subclass) — assert
    // a real error surfaces, symmetric with the rejected-Promise case above.
    await expect(
      runHookResultForSideEffect(Effect.fail(new Error("y"))),
    ).rejects.toBeInstanceOf(Error);
  });
});
