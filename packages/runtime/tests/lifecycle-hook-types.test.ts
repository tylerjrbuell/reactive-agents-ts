/**
 * `.withHook()` handler types match what each phase receives.
 *
 * The type assertions are checked by `tsc --noEmit` (package typecheck): a
 * `@ts-expect-error` that stops erroring fails the typecheck. The runtime
 * case pins that a kernel-fired hook receives the kernel state it is typed
 * with (it used to receive only `{ phase, iteration }`).
 */
import { describe, expect, expectTypeOf, it } from "bun:test";
import type { KernelStateLike } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/index.js";
import type {
  ExecutionContext,
  KernelTurnErrorHookContext,
  KernelTurnHookContext,
  LifecycleHook,
} from "../src/index.js";
import { invokeUserHookSafely } from "../src/builder/api-surface.js";

const state: KernelStateLike = {
  taskId: "t-1",
  strategy: "reactive",
  kernelType: "react",
  steps: [],
  toolsUsed: new Set(["web-search"]),
  iteration: 2,
  tokens: 10,
  status: "thinking",
  output: null,
  error: null,
  meta: {},
};

describe("LifecycleHook handler types", () => {
  it("types a per-turn act hook as the kernel turn context or the engine context", () => {
    const hook: LifecycleHook = {
      phase: "act",
      timing: "after",
      handler: (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<KernelTurnHookContext | ExecutionContext>();
        expectTypeOf(ctx.iteration).toEqualTypeOf<number>();
        // @ts-expect-error metadata exists only on the engine firing; narrow first.
        void ctx.metadata;
        // @ts-expect-error toolResults exists only on the engine firing; narrow first.
        void ctx.toolResults;
        if ("metadata" in ctx) {
          expectTypeOf(ctx).toEqualTypeOf<ExecutionContext>();
          return;
        }
        expectTypeOf(ctx.state).toEqualTypeOf<Readonly<KernelStateLike>>();
      },
    };
    expect(hook.phase).toBe("act");
  });

  it("types a per-turn on-error hook without kernel state", () => {
    const hook: LifecycleHook = {
      phase: "think",
      timing: "on-error",
      handler: (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<KernelTurnErrorHookContext | ExecutionContext>();
        if ("metadata" in ctx) return;
        // @ts-expect-error the kernel error path carries no state snapshot.
        void ctx.state;
      },
    };
    expect(hook.timing).toBe("on-error");
  });

  it("types an engine-phase hook with the full ExecutionContext", () => {
    const hook: LifecycleHook = {
      phase: "complete",
      timing: "after",
      handler: (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<ExecutionContext>();
        void ctx.metadata;
      },
    };
    expect(hook.phase).toBe("complete");
  });
});

describe("kernel-fired hook context", () => {
  it("passes the kernel state to a before/after hook", async () => {
    let seen: KernelTurnHookContext | ExecutionContext | undefined;
    const hook: LifecycleHook = {
      phase: "act",
      timing: "after",
      handler: (ctx) => {
        seen = ctx;
      },
    };
    const builder = ReactiveAgents.create().withName("hook-ctx-state");
    await invokeUserHookSafely(builder, hook, { phase: "act", iteration: 2, state });
    expect(seen).toEqual({ phase: "act", iteration: 2, state });
  });

  it("passes no state to an on-error hook", async () => {
    let seen: KernelTurnErrorHookContext | ExecutionContext | undefined;
    const hook: LifecycleHook = {
      phase: "act",
      timing: "on-error",
      handler: (ctx) => {
        seen = ctx;
      },
    };
    const builder = ReactiveAgents.create().withName("hook-ctx-error");
    await invokeUserHookSafely(builder, hook, { phase: "act", iteration: 1 });
    expect(seen).toEqual({ phase: "act", iteration: 1 });
  });
});
