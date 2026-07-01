// Run: bun test packages/runtime/tests/pipeline-skip.test.ts --timeout 15000
//
// Regression net for the runGuardedPhase skip-bypass defect.
//
// runGuardedPhase is called DIRECTLY (not via runPipeline) at several sites:
// pre-loop-dispatch.ts (guardrail/costRoute/strategySelect), execution-engine.ts
// (verify/costTrack/audit/complete), verification-quality-gate.ts (verify-again).
// runPipeline honored phase.skip; runGuardedPhase did NOT — so a config-gated
// phase (e.g. cost-route with modelRouting off) ran its body anyway. That is the
// exact class that produced the streaming-fiber-kill defect (cost-route threw on
// provider "test" and the Effect defect killed the stream daemon fiber). The fix
// makes runGuardedPhase itself honor phase.skip so every direct caller is sealed.
import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import { runGuardedPhase } from "../src/engine/pipeline.js";
import type { Phase } from "../src/engine/phase.js";
import type { PhaseDeps } from "../src/engine/runtime-context.js";
import type { ExecutionContext } from "../src/types.js";

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    taskId: "t-1",
    agentId: "agent-test",
    sessionId: "s-1",
    phase: "verify",
    agentState: "running",
    iteration: 1,
    maxIterations: 10,
    messages: [],
    toolResults: [],
    cost: 0,
    tokensUsed: 0,
    startedAt: new Date(),
    metadata: {},
    ...overrides,
  } as unknown as ExecutionContext;
}

function makeDeps(overrides: Partial<PhaseDeps> = {}): PhaseDeps {
  return {
    task: { id: "t-1", agentId: "agent-test", input: "hi", type: "qa", metadata: {} },
    config: { agentId: "agent-test" } as any,
    hooks: {
      register: () => Effect.succeed(() => {}),
      run: (_p: any, _t: any, c: any) => Effect.succeed(c),
      list: () => Effect.succeed([]),
    } as any,
    obs: null,
    eb: null,
    ks: null,
    guardrail: null,
    behavioral: null,
    tools: null,
    state: {
      cancelledTasks: Ref.unsafeMake(new Set<string>()),
      runningContexts: Ref.unsafeMake(new Map()),
    } as any,
    isNormal: false,
    executionStartMs: Date.now(),
    ...overrides,
  } as PhaseDeps;
}

describe("runGuardedPhase honors phase.skip", () => {
  it("does NOT run the phase body when skip() returns true", async () => {
    let ran = false;
    const phase: Phase = {
      name: "guardrail",
      skip: () => true,
      run: (ctx) =>
        Effect.sync(() => {
          ran = true;
          return ctx;
        }),
    };
    const ctx = makeCtx();
    const out = await Effect.runPromise(
      runGuardedPhase(phase, ctx, makeDeps()) as Effect.Effect<ExecutionContext, never>,
    );

    expect(ran).toBe(false); // body must not execute
    expect(out).toBe(ctx); // context forwarded unchanged
  }, 15000);

  it("swallows a throwing body when skip() is true (the defect: throw → Effect defect → killed fiber)", async () => {
    const phase: Phase = {
      name: "cost-route",
      skip: () => true,
      run: () => Effect.sync(() => {
        throw new TypeError("phase body should never run when skipped");
      }),
    };
    const ctx = makeCtx();
    // Before the fix this threw a defect (TypeError) instead of skipping.
    const out = await Effect.runPromise(
      runGuardedPhase(phase, ctx, makeDeps()) as Effect.Effect<ExecutionContext, never>,
    );
    expect(out).toBe(ctx);
  }, 15000);

  it("DOES run the phase body when skip() returns false", async () => {
    let ran = false;
    const phase: Phase = {
      name: "audit",
      skip: () => false,
      run: (ctx) =>
        Effect.sync(() => {
          ran = true;
          return ctx;
        }),
    };
    const out = await Effect.runPromise(
      runGuardedPhase(phase, makeCtx(), makeDeps()) as Effect.Effect<ExecutionContext, never>,
    );
    expect(ran).toBe(true);
    expect(out).toBeDefined();
  }, 15000);

  it("DOES run the phase body when no skip predicate is defined", async () => {
    let ran = false;
    const phase: Phase = {
      name: "complete",
      run: (ctx) =>
        Effect.sync(() => {
          ran = true;
          return ctx;
        }),
    };
    await Effect.runPromise(
      runGuardedPhase(phase, makeCtx(), makeDeps()) as Effect.Effect<ExecutionContext, never>,
    );
    expect(ran).toBe(true);
  }, 15000);
});
