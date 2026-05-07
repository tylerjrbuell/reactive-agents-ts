/**
 * Unit tests for the extracted VERIFY phase.
 *
 * The phase is decision-rich:
 *   1. `skip` predicate gates on `config.enableVerification`
 *   2. When skipped (predicate or no service): ctx forwarded unchanged
 *   3. When service present and verifies: ctx gains verificationResult/Score
 *      and agentState transitions to "verifying"
 *   4. When service present but errors: synthetic high-risk fallback result
 *      is recorded (score 0.45, recommendation "review")
 *
 * These tests exercise the phase's `run` function directly. Pipeline-level
 * concerns (lifecycle guard, hook firing, observability) are owned by the
 * pipeline runner and verified by integration tests in execution-engine.ts.
 *
 * Authored 2026-05-07 (TDD RED phase, W23 verify extraction).
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { VerificationService } from "@reactive-agents/verification";
import { verify } from "../src/engine/phases/verify.js";
import type { PhaseDeps } from "../src/engine/runtime-context.js";
import type { ExecutionContext } from "../src/types.js";

// ─── Fixture builders ───

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
    metadata: { lastResponse: "hello" },
    ...overrides,
  } as unknown as ExecutionContext;
}

function makeDeps(overrides: Partial<PhaseDeps> = {}): PhaseDeps {
  return {
    task: { id: "t-1", agentId: "agent-test", input: "What is 2+2?", type: "qa", metadata: {} },
    config: { enableVerification: true, agentId: "agent-test" } as any,
    hooks: { register: () => Effect.succeed(() => {}), run: (_p: any, _t: any, c: any) => Effect.succeed(c), list: () => Effect.succeed([]) } as any,
    obs: null,
    eb: null,
    ks: null,
    guardrail: null,
    behavioral: null,
    tools: null,
    state: { cancelledTasks: null as any, runningContexts: null as any },
    isNormal: false,
    executionStartMs: Date.now(),
    ...overrides,
  } as PhaseDeps;
}

// ─── Mock layers ───

const PassingVerifierLayer = Layer.succeed(
  VerificationService,
  {
    verify: () =>
      Effect.succeed({
        overallScore: 0.92,
        passed: true,
        riskLevel: "low" as const,
        layerResults: [],
        recommendation: "accept" as const,
        verifiedAt: new Date(),
      }),
  } as any,
);

const FailingVerifierLayer = Layer.succeed(
  VerificationService,
  {
    verify: () => Effect.fail(new Error("verifier exploded")),
  } as any,
);

// ─── Tests ───

describe("verify phase", () => {
  it("skip() returns true when enableVerification is false", () => {
    const ctx = makeCtx();
    const deps = makeDeps({ config: { enableVerification: false } as any });
    expect(verify.skip!(ctx, deps)).toBe(true);
  });

  it("skip() returns false when enableVerification is true", () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    expect(verify.skip!(ctx, deps)).toBe(false);
  });

  it("returns ctx unchanged when no VerificationService is wired", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    const result = await Effect.runPromise(verify.run(ctx, deps) as Effect.Effect<ExecutionContext, never, never>);

    expect(result.metadata["verificationResult"]).toBeUndefined();
    expect(result.metadata["verificationScore"]).toBeUndefined();
    expect(result.agentState).toBe(ctx.agentState);
  });

  it("records score + result and transitions state when verifier passes", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    const result = await Effect.runPromise(
      (verify.run(ctx, deps) as Effect.Effect<ExecutionContext, never, never>).pipe(
        Effect.provide(PassingVerifierLayer),
      ) as Effect.Effect<ExecutionContext, never, never>,
    );

    expect(result.agentState).toBe("verifying");
    expect((result.metadata["verificationResult"] as any).passed).toBe(true);
    expect(result.metadata["verificationScore"]).toBe(0.92);
  });

  it("records synthetic high-risk fallback when verifier errors", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    const result = await Effect.runPromise(
      (verify.run(ctx, deps) as Effect.Effect<ExecutionContext, never, never>).pipe(
        Effect.provide(FailingVerifierLayer),
      ) as Effect.Effect<ExecutionContext, never, never>,
    );

    const vr = result.metadata["verificationResult"] as {
      overallScore: number;
      passed: boolean;
      recommendation: string;
      layerResults: ReadonlyArray<{ layerName: string; passed: boolean }>;
    };
    expect(vr.overallScore).toBe(0.45);
    expect(vr.passed).toBe(false);
    expect(vr.recommendation).toBe("review");
    expect(vr.layerResults[0].layerName).toBe("verification_runtime");
    expect(result.metadata["verificationScore"]).toBe(0.45);
  });
});
