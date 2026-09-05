/**
 * harness-improvements.test.ts
 *
 * TDD: Tests for 6 new builder harness features.
 *
 * RED phase: These tests fail because the builder methods and execution logic
 * do not yet exist. Each test documents the intended behavior so that
 * implementation can be driven by watching tests go green.
 *
 * Features under test:
 *   1. withMinIterations(n)       — block early exit before N tool-using iterations
 *   2. withCustomTermination(fn)  — user-defined done predicate
 *   3. withVerificationStep()     — mandatory reflection pass before completion
 *   4. withOutputValidator(fn)    — structural validation with retry on failure
 *   5. withTaskContext(record)    — inject background data into reasoning context
 *
 * (withProgressCheckpoint was REMOVED in v0.14 — the config dead-ended in a
 * struct and autoResume was never implemented; see DEBT-REGISTER P0-10. Use
 * .withDurableRuns() for real crash-resume.)
 */

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";

// ─── Shared stub ReasoningService (kernel-arm equivalent of the old LLM mocks) ──
//
// The composition-precedence / minIterations / customTermination /
// verificationStep / outputValidator / taskContext tests below used to drive
// `ExecutionEngineLive` with ONLY an `LLMService` mock in the layer — that
// exercised the (now-dead, Move 1, 2026-08-13) inline direct-LLM arm, since
// omitting `ReasoningService` made `reasoningOpt` resolve to `None`. Migrated
// onto the kernel arm's real mechanism: `reasoning-harness-hooks.ts`'s
// withMinIterations / withCustomTermination / withVerificationStep /
// withOutputValidator continuation loops all call
// `reasoningOpt.value.execute()` once per pass — a stub ReasoningService at
// that exact boundary, driven the same call-count/sequential-response way
// the LLM mocks were, preserves each test's actual intent.
type StubReasoningResult = {
  output: unknown;
  status: "completed" | "failed" | "partial";
  steps?: readonly { id: string; type: string; content: string }[];
  metadata: { cost: number; tokensUsed: number; stepsCount: number };
};

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: { [k: string]: unknown }) => Effect.Effect<StubReasoningResult>;
}>("ReasoningService");

/** ReasoningService stub that returns a different response each call from a queue. */
function makeSequentialReasoning(responses: string[]): Layer.Layer<never> {
  let idx = 0;
  return Layer.succeed(ReasoningServiceTag, {
    execute: (_params) => {
      const content = responses[idx] ?? responses[responses.length - 1] ?? "done";
      idx++;
      return Effect.succeed({
        output: content,
        status: "completed" as const,
        steps: [{ id: `step-${idx}`, type: "thought", content }],
        metadata: { cost: 0, tokensUsed: 20, stepsCount: 1 },
      });
    },
  });
}

/** ReasoningService stub that always returns the same text. */
function makeStaticReasoning(text: string): Layer.Layer<never> {
  return makeSequentialReasoning([text]);
}

/** Track how many times ReasoningService.execute() was called. */
function makeCountingReasoning(text: string): { layer: Layer.Layer<never>; callCount: () => number } {
  let calls = 0;
  return {
    layer: Layer.succeed(ReasoningServiceTag, {
      execute: (_params) => {
        calls++;
        return Effect.succeed({
          output: text,
          status: "completed" as const,
          steps: [{ id: `step-${calls}`, type: "thought", content: text }],
          metadata: { cost: 0, tokensUsed: 10, stepsCount: 1 },
        });
      },
    }),
    callCount: () => calls,
  };
}

function makeReasoningRunLayer(reasoningLayer: Layer.Layer<never>, config: ReturnType<typeof defaultReactiveAgentsConfig>) {
  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(LifecycleHookRegistryLive),
  );
  return Layer.mergeAll(engineLayer, reasoningLayer);
}

async function runTaskReasoning(
  config: ReturnType<typeof defaultReactiveAgentsConfig>,
  reasoningLayer: Layer.Layer<never>,
  task = "do something",
) {
  const runLayer = makeReasoningRunLayer(reasoningLayer, config);
  return Effect.runPromise(
    ExecutionEngine.pipe(
      Effect.flatMap((engine) =>
        engine.execute({
          id: `task-${Date.now()}` as any,
          agentId: config.agentId as any,
          input: task,
          type: "query" as const,
          priority: "medium" as const,
          status: "pending" as const,
          metadata: { tags: [] },
          createdAt: new Date(),
        } as any),
      ),
      Effect.provide(runLayer),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Composition precedence: minIterations × customTermination × verificationStep
// ─────────────────────────────────────────────────────────────────────────────
//
// All three controls gate completion. Their interaction was undefined-by-test
// (each was only tested in isolation). This pins the precedence CONTRACT so a
// regression that reorders the controls — letting an early customTermination
// skip the minIterations floor, or dropping the verification pass — goes RED.
// Verified behavior: the minIterations floor OVERRIDES an early customTermination
// stop, and verificationStep runs a reflect pass ON TOP of the floor.

describe("composition precedence (minIterations × customTermination × verificationStep)", () => {
  const sawDone = (state: unknown) => String((state as { output?: unknown }).output ?? "").includes("DONE");

  it("minIterations floor overrides an early customTermination; verification runs on top", async () => {
    // Migrated off the dead inline arm onto the kernel arm's equivalent
    // mechanism (reasoning-harness-hooks.ts's withCustomTermination /
    // withMinIterations / withVerificationStep continuation loops, each
    // calling ReasoningService.execute() once per pass).
    //
    // The stub says "DONE" on every call, so customTermination is satisfied
    // immediately (alone it would stop at 1 call — see the
    // withCustomTermination suite).
    const floorOnly = makeCountingReasoning("DONE");
    await runTaskReasoning(
      defaultReactiveAgentsConfig("compose-floor", {
        maxIterations: 10,
        minIterations: 3,
        customTermination: sawDone,
      }),
      floorOnly.layer,
    );

    const floorPlusVerify = makeCountingReasoning("DONE");
    await runTaskReasoning(
      defaultReactiveAgentsConfig("compose-floor-verify", {
        maxIterations: 10,
        minIterations: 3,
        customTermination: sawDone,
        verificationStep: { mode: "reflect" },
      }),
      floorPlusVerify.layer,
    );

    // Precedence 1: the floor wins over the early stop (≥3, not 1).
    expect(floorOnly.callCount()).toBeGreaterThanOrEqual(3);
    // Precedence 2: verificationStep adds a pass ON TOP of the floor.
    expect(floorPlusVerify.callCount()).toBeGreaterThan(floorOnly.callCount());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. withMinIterations
// ─────────────────────────────────────────────────────────────────────────────

describe("withMinIterations", () => {
  it("builder method exists and returns this for chaining", async () => {
    const builder = ReactiveAgents.create()
      .withName("min-iter-test")
      .withTestScenario([{ text: "result" }])
      .withMinIterations(3);

    expect(builder).toBeDefined();
  });

  it("config stores minIterations value", async () => {
    const agent = await ReactiveAgents.create()
      .withName("min-iter-config")
      .withTestScenario([{ text: "result" }])
      .withMinIterations(3)
      .build();

    expect((agent as any)._config?.minIterations ?? (agent as any).config?.minIterations).toBe(3);
  });

  it("does not terminate before N iterations when using fast-path", async () => {
    // Migrated off the dead inline arm onto the kernel arm's withMinIterations
    // continuation loop (reasoning-harness-hooks.ts). The stub ReasoningService
    // returns a final-looking answer on the FIRST call, which would normally
    // let the run stop after one pass. withMinIterations(3) must block that
    // early exit and keep calling ReasoningService.execute() until at least N
    // passes have run. We count execute() calls as a proxy for iterations.
    const { layer, callCount } = makeCountingReasoning("FINAL ANSWER: done");

    const config = defaultReactiveAgentsConfig("min-iter-agent", {
      maxIterations: 10,
      minIterations: 3,
    });

    await runTaskReasoning(config, layer);

    // Gutting withMinIterations to a no-op would make this 1 call → RED.
    expect(callCount()).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. withCustomTermination
// ─────────────────────────────────────────────────────────────────────────────

describe("withCustomTermination", () => {
  it("builder method exists and returns this for chaining", async () => {
    const builder = ReactiveAgents.create()
      .withName("custom-term-test")
      .withTestScenario([{ text: "SUCCESS: task complete" }])
      .withCustomTermination((state: unknown) => String((state as any).output ?? "").includes("SUCCESS"));

    expect(builder).toBeDefined();
  });

  it("config stores customTermination function", async () => {
    const fn = (_state: unknown) => true;
    const agent = await ReactiveAgents.create()
      .withName("custom-term-config")
      .withTestScenario([{ text: "done" }])
      .withCustomTermination(fn)
      .build();

    const stored = (agent as any)._config?.customTermination ?? (agent as any).config?.customTermination;
    expect(typeof stored).toBe("function");
  });

  it("terminates when predicate returns true based on output content", async () => {
    // Migrated off the dead inline arm onto the kernel arm's
    // withCustomTermination continuation loop (reasoning-harness-hooks.ts):
    // the predicate is checked against `ctx.metadata.lastResponse` after each
    // ReasoningService.execute() pass, same semantics as the inline arm's
    // per-iteration check.
    const config = defaultReactiveAgentsConfig("custom-term-agent", {
      maxIterations: 10,
      customTermination: (state: unknown) =>
        String((state as any).output ?? "").includes("DONE"),
    });

    const result = await runTaskReasoning(
      config,
      makeSequentialReasoning(["still working", "DONE: task complete"]),
    );
    expect(String(result.output ?? "")).toContain("DONE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. withVerificationStep
// ─────────────────────────────────────────────────────────────────────────────

describe("withVerificationStep", () => {
  it("builder method exists and returns this for chaining", async () => {
    const builder = ReactiveAgents.create()
      .withName("verify-test")
      .withTestScenario([{ text: "answer" }, { text: "PASS" }])
      .withVerificationStep({ mode: "reflect" });

    expect(builder).toBeDefined();
  });

  it("config stores verificationStep settings", async () => {
    const agent = await ReactiveAgents.create()
      .withName("verify-config")
      .withTestScenario([{ text: "answer" }, { text: "PASS" }])
      .withVerificationStep({ mode: "reflect" })
      .build();

    const stored =
      (agent as any)._config?.verificationStep ?? (agent as any).config?.verificationStep;
    expect(stored).toBeDefined();
    expect(stored.mode).toBe("reflect");
  });

  it("runs an additional LLM call for reflect-mode verification after initial answer", async () => {
    // Migrated off the dead inline arm onto the kernel arm's reflect-mode
    // verification pass (reasoning-harness-hooks.ts) — a second
    // ReasoningService.execute() call judging the first pass's output.
    const { layer, callCount } = makeCountingReasoning("verified answer");

    const config = defaultReactiveAgentsConfig("verify-agent", {
      maxIterations: 5,
      verificationStep: { mode: "reflect" },
    });

    await runTaskReasoning(config, layer);

    // With verificationStep enabled, at least 2 ReasoningService calls should
    // occur: 1) initial reasoning  2) verification reflection
    expect(callCount()).toBeGreaterThanOrEqual(2);
  });

  it("supports custom verification prompt", async () => {
    const builder = ReactiveAgents.create()
      .withName("verify-prompt-test")
      .withTestScenario([{ text: "answer" }, { text: "PASS" }])
      .withVerificationStep({
        mode: "reflect",
        prompt: "Review this output: does it fully answer the task?",
      });

    expect(builder).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. withOutputValidator
// ─────────────────────────────────────────────────────────────────────────────

describe("withOutputValidator", () => {
  it("builder method exists and returns this for chaining", async () => {
    const builder = ReactiveAgents.create()
      .withName("validator-test")
      .withTestScenario([{ text: "COMPLETE: result" }])
      .withOutputValidator((output: string) => ({
        valid: output.includes("COMPLETE"),
        feedback: "Response must include COMPLETE marker",
      }));

    expect(builder).toBeDefined();
  });

  it("config stores outputValidator function", async () => {
    const validator = (output: string) => ({ valid: output.length > 10 });
    const agent = await ReactiveAgents.create()
      .withName("validator-config")
      .withTestScenario([{ text: "COMPLETE: a sufficiently long answer here" }])
      .withOutputValidator(validator)
      .build();

    const stored =
      (agent as any)._config?.outputValidator ?? (agent as any).config?.outputValidator;
    expect(typeof stored).toBe("function");
  });

  it("accepts output that passes validation without retry", async () => {
    // Migrated off the dead inline arm onto the kernel arm's
    // withOutputValidator retry loop (reasoning-harness-hooks.ts).
    const config = defaultReactiveAgentsConfig("validator-agent", {
      maxIterations: 5,
      outputValidator: (output: string) => ({ valid: output.includes("COMPLETE") }),
    });

    const result = await runTaskReasoning(config, makeStaticReasoning("COMPLETE: the answer is 42"));
    expect(String(result.output ?? "")).toContain("COMPLETE");
  });

  it("retries with injected feedback when validator rejects output", async () => {
    // Migrated off the dead inline arm. First ReasoningService.execute() call
    // lacks the required marker — reasoning-harness-hooks.ts's
    // withOutputValidator loop retries with the validator's feedback injected
    // into initialMessages, same shape as the inline arm's retry.
    let callIdx = 0;
    const retryLayer = Layer.succeed(ReasoningServiceTag, {
      execute: (_params) => {
        callIdx++;
        const content = callIdx === 1 ? "incomplete answer" : "COMPLETE: corrected answer";
        return Effect.succeed({
          output: content,
          status: "completed" as const,
          steps: [{ id: `step-${callIdx}`, type: "thought", content }],
          metadata: { cost: 0, tokensUsed: 10, stepsCount: 1 },
        });
      },
    });

    const config = defaultReactiveAgentsConfig("validator-retry-agent", {
      maxIterations: 5,
      outputValidator: (output: string) => ({
        valid: output.includes("COMPLETE"),
        feedback: "Response must include COMPLETE marker",
      }),
    });

    const result = await runTaskReasoning(config, retryLayer);
    // Should have retried and eventually produced COMPLETE output
    expect(String(result.output ?? "")).toContain("COMPLETE");
    // ReasoningService was called at least twice (first invalid, then retry)
    expect(callIdx).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. withProgressCheckpoint — REMOVED v0.14 (DEBT-REGISTER P0-10)
// ─────────────────────────────────────────────────────────────────────────────

describe("withProgressCheckpoint (removed v0.14)", () => {
  it("stays removed — the config dead-ended and autoResume was never implemented", () => {
    const proto = Object.getPrototypeOf(ReactiveAgents.create());
    expect(Object.getOwnPropertyNames(proto)).not.toContain("withProgressCheckpoint");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. withTaskContext
// ─────────────────────────────────────────────────────────────────────────────

describe("withTaskContext", () => {
  it("builder method exists and returns this for chaining", async () => {
    const builder = ReactiveAgents.create()
      .withName("context-test")
      .withTestScenario([{ text: "done" }])
      .withTaskContext({ projectName: "reactive-agents", environment: "production" });

    expect(builder).toBeDefined();
  });

  it("config stores taskContext record", async () => {
    const ctx = { projectName: "reactive-agents", version: "1.0.0" };
    const agent = await ReactiveAgents.create()
      .withName("context-config")
      .withTestScenario([{ text: "done" }])
      .withTaskContext(ctx)
      .build();

    const stored =
      (agent as any)._config?.taskContext ?? (agent as any).config?.taskContext;
    expect(stored).toBeDefined();
    expect(stored.projectName).toBe("reactive-agents");
    expect(stored.version).toBe("1.0.0");
  });

  it("run completes successfully when taskContext is configured", async () => {
    // Migrated off the dead inline arm onto the kernel arm.
    const config = defaultReactiveAgentsConfig("context-agent", {
      maxIterations: 5,
      taskContext: { projectName: "reactive-agents", environment: "test" },
    });

    const result = await runTaskReasoning(config, makeStaticReasoning("FINAL ANSWER: done"));
    expect(result).toBeDefined();
  });

  it("kernel-arm execution injects taskContext into the ReasoningService memoryContext", async () => {
    // Migrated off the dead inline arm (Move 1, 2026-08-13). The inline path
    // injected taskContext into a direct-LLM system message via
    // formatTaskContextForChat ("## Task / session grounding" header); the
    // kernel arm's equivalent mechanism is reasoning-think.ts:162-167, which
    // prepends a "--- Task Context ---" block onto `memoryContext` before it
    // reaches `reasoningService.execute()`. Same feature (static taskContext
    // reaches the model even without prior chat history), different carrier.
    let capturedMemoryContext = "";
    const reasoningLayer = Layer.succeed(ReasoningServiceTag, {
      execute: (params: { memoryContext?: string; [k: string]: unknown }) => {
        capturedMemoryContext = params.memoryContext ?? "";
        return Effect.succeed({
          output: "ack",
          status: "completed" as const,
          steps: [],
          metadata: { cost: 0, tokensUsed: 1, stepsCount: 0 },
        });
      },
    });
    const config = defaultReactiveAgentsConfig("task-ctx-kernel-arm", {
      maxIterations: 3,
      taskContext: { cortexPriorRun: "RUN_CONTEXT_INJECTION_MARKER" },
    });
    await runTaskReasoning(config, reasoningLayer, "hello");
    expect(capturedMemoryContext).toContain("RUN_CONTEXT_INJECTION_MARKER");
    expect(capturedMemoryContext).toContain("--- Task Context ---");
  });

  it("accepts empty task context without error", async () => {
    const builder = ReactiveAgents.create()
      .withName("empty-context-test")
      .withTestScenario([{ text: "done" }])
      .withTaskContext({});

    expect(builder).toBeDefined();
  });
});
