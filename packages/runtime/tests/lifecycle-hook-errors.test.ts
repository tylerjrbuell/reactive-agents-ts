import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents, ReactiveAgentBuilder } from "../src/builder.js";
import type { LifecycleHook } from "../src/types.js";
import { RegistrationHarness } from "@reactive-agents/core";

/**
 * Regression coverage for HS-14 / issue #74.
 *
 * `builder.ts:794,807` previously wrapped lifecycle hook invocations in
 * `.catch(() => undefined)` + outer `try{}catch{}`, silently discarding any
 * error thrown by a user-supplied hook handler. After the fix, the harness
 * wrappers route any escaping hook error through `withErrorHandler` (when set)
 * or `console.warn` (fallback) — never silently disappear.
 *
 * These tests drive the wrappers directly via the harness registration path
 * because the kernel/runner phase-hook fire site (runner.ts:683) is bypassed
 * when the test provider short-circuits the reactive loop — exercising the
 * wrapper through a real agent.run() doesn't reliably hit the formerly-
 * swallowing code path. Direct invocation pins the unit under test.
 */
describe("lifecycle hook error routing (HS-14 / #74)", () => {
  let warnSpy: ReturnType<typeof captureConsoleWarn>;

  beforeEach(() => {
    warnSpy = captureConsoleWarn();
  });

  afterEach(() => {
    warnSpy.restore();
  });

  function collectRegistrations(builder: ReactiveAgentBuilder): {
    before: Array<{ phase: string; fn: (ctx: { phase: string; iteration: number; state: unknown }) => Promise<unknown> | unknown }>;
    after: Array<{ phase: string; fn: (ctx: { phase: string; iteration: number; state: unknown }) => Promise<unknown> | unknown }>;
    onError: Array<{ phase: string; fn: (err: unknown, ctx: { phase: string; iteration: number; state: unknown }) => Promise<unknown> | unknown }>;
  } {
    const reg = new RegistrationHarness();
    const regs = (builder as unknown as { _harnessRegistrations: Array<(h: unknown) => void> })._harnessRegistrations;
    for (const fn of regs) fn(reg as unknown as Parameters<typeof fn>[0]);
    const collected = (reg as unknown as { _collected: ReadonlyArray<{ kind: string; phase: string; fn: unknown }> })._collected;
    return {
      before: collected.filter((r) => r.kind === "before") as Array<{ phase: string; fn: (ctx: { phase: string; iteration: number; state: unknown }) => Promise<unknown> }>,
      after: collected.filter((r) => r.kind === "after") as Array<{ phase: string; fn: (ctx: { phase: string; iteration: number; state: unknown }) => Promise<unknown> }>,
      onError: collected.filter((r) => r.kind === "onError") as Array<{ phase: string; fn: (err: unknown, ctx: { phase: string; iteration: number; state: unknown }) => Promise<unknown> }>,
    };
  }

  it("before-hook: throwing handler routes to withErrorHandler (no longer swallowed)", async () => {
    const captured: Array<{ err: Error; phase: string }> = [];
    const throwingHook: LifecycleHook = {
      phase: "think",
      timing: "before",
      handler: () => {
        throw new Error("user hook exploded");
      },
    };
    const builder = ReactiveAgents.create()
      .withName("hook-err")
      .withProvider("test")
      .withErrorHandler((err, ctx) => {
        captured.push({ err: err as Error, phase: ctx.phase });
      })
      .withHook(throwingHook);

    const { before } = collectRegistrations(builder);
    const target = before.find((r) => r.phase === "think");
    expect(target).toBeDefined();

    await target!.fn({ phase: "think", iteration: 0, state: {} });

    expect(captured.length).toBe(1);
    expect(captured[0]!.err.message).toBe("user hook exploded");
    expect(captured[0]!.phase).toBe("think");
  });

  it("after-hook: throwing handler routes to withErrorHandler", async () => {
    const captured: Error[] = [];
    const throwingHook: LifecycleHook = {
      phase: "act",
      timing: "after",
      handler: () => {
        throw new Error("after-hook boom");
      },
    };
    const builder = ReactiveAgents.create()
      .withName("hook-err-after")
      .withProvider("test")
      .withErrorHandler((err) => {
        captured.push(err as Error);
      })
      .withHook(throwingHook);

    const { after } = collectRegistrations(builder);
    const target = after.find((r) => r.phase === "act");
    expect(target).toBeDefined();

    await target!.fn({ phase: "act", iteration: 0, state: {} });

    expect(captured.length).toBe(1);
    expect(captured[0]!.message).toBe("after-hook boom");
  });

  it("on-error hook: throwing handler routes to withErrorHandler", async () => {
    const captured: Error[] = [];
    const throwingHook: LifecycleHook = {
      phase: "act",
      timing: "on-error",
      handler: () => {
        throw new Error("on-error hook exploded");
      },
    };
    const builder = ReactiveAgents.create()
      .withName("hook-err-onerror")
      .withProvider("test")
      .withErrorHandler((err) => {
        captured.push(err as Error);
      })
      .withHook(throwingHook);

    const { onError } = collectRegistrations(builder);
    const target = onError.find((r) => r.phase === "act");
    expect(target).toBeDefined();

    await target!.fn(new Error("original engine error"), {
      phase: "act",
      iteration: 0,
      state: {},
    });

    expect(captured.length).toBe(1);
    expect(captured[0]!.message).toBe("on-error hook exploded");
  });

  it("falls back to console.warn when no error handler registered", async () => {
    const throwingHook: LifecycleHook = {
      phase: "think",
      timing: "before",
      handler: () => {
        throw new Error("silent no more");
      },
    };
    const builder = ReactiveAgents.create()
      .withName("hook-err-warn")
      .withProvider("test")
      .withHook(throwingHook);

    const { before } = collectRegistrations(builder);
    await before.find((r) => r.phase === "think")!.fn({
      phase: "think",
      iteration: 0,
      state: {},
    });

    const matched = warnSpy.calls.some((args) =>
      args.some((a) =>
        typeof a === "string"
          ? a.includes("lifecycle hook") || a.includes("silent no more")
          : a instanceof Error && a.message === "silent no more",
      ),
    );
    expect(matched).toBe(true);
  });

  it("async hook rejection also routes (not just sync throw)", async () => {
    const captured: Error[] = [];
    const asyncThrowingHook: LifecycleHook = {
      phase: "think",
      timing: "before",
      // Returns a rejecting promise — used to be silently dropped by .catch(() => undefined)
      handler: () =>
        Effect.promise(async () => {
          throw new Error("async hook rejected");
        }) as unknown as ReturnType<LifecycleHook["handler"]>,
    };
    // Simpler: return a rejecting Promise directly. Type-cast since handler
    // signature says Effect but the production wrapper only awaits.
    const directHook: LifecycleHook = {
      phase: "think",
      timing: "before",
      handler: (() => Promise.reject(new Error("async hook rejected"))) as unknown as LifecycleHook["handler"],
    };
    const builder = ReactiveAgents.create()
      .withName("hook-err-async")
      .withProvider("test")
      .withErrorHandler((err) => {
        captured.push(err as Error);
      })
      .withHook(directHook);

    const { before } = collectRegistrations(builder);
    await before.find((r) => r.phase === "think")!.fn({
      phase: "think",
      iteration: 0,
      state: {},
    });

    expect(captured.length).toBe(1);
    expect(captured[0]!.message).toBe("async hook rejected");
    // ensure unused var doesn't warn under TS noUnusedLocals
    void asyncThrowingHook;
  });

  it("a normal (non-throwing) hook routes its return value cleanly (no regression)", async () => {
    let invoked = 0;
    const normalHook: LifecycleHook = {
      phase: "think",
      timing: "before",
      handler: ((_ctx: unknown) => {
        invoked += 1;
        return Effect.succeed(_ctx);
      }) as unknown as LifecycleHook["handler"],
    };
    const builder = ReactiveAgents.create()
      .withName("hook-normal")
      .withProvider("test")
      .withHook(normalHook);

    const { before } = collectRegistrations(builder);
    await before.find((r) => r.phase === "think")!.fn({
      phase: "think",
      iteration: 0,
      state: {},
    });

    expect(invoked).toBe(1);
    expect(warnSpy.calls.length).toBe(0);
  });
});

function captureConsoleWarn() {
  const original = console.warn;
  const calls: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    calls.push(args);
  };
  return {
    calls,
    restore() {
      console.warn = original;
    },
  };
}
