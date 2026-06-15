import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { normalizeHookResult } from "../src/hooks-normalize.js";
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

  it("sync throw → fails the effect with the thrown error", async () => {
    const eff = normalizeHookResult(() => { throw new Error("boom"); }, baseCtx);
    const exit = await Effect.runPromiseExit(eff);
    expect(exit._tag).toBe("Failure");
  });

  it("rejected Promise → fails the effect", async () => {
    const eff = normalizeHookResult(() => Promise.reject(new Error("nope")), baseCtx);
    const exit = await Effect.runPromiseExit(eff);
    expect(exit._tag).toBe("Failure");
  });

  it("failed Effect → fails the effect (back-compat)", async () => {
    const eff = normalizeHookResult(() => Effect.fail(new Error("eff-fail")), baseCtx);
    const exit = await Effect.runPromiseExit(eff);
    expect(exit._tag).toBe("Failure");
  });
});
