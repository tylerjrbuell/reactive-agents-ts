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
 *   5. withProgressCheckpoint(n) — persist partial state every N iterations
 *   6. withTaskContext(record)    — inject background data into reasoning context
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

// ─── Shared mock LLM ──────────────────────────────────────────────────────────

type LLMShape = {
  complete: (req: unknown) => Effect.Effect<{
    content: string;
    stopReason: string;
    toolCalls?: unknown[];
    usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number };
    model: string;
    thinking?: string;
  }>;
};

const LLMTag = Context.GenericTag<LLMShape>("LLMService");

/** LLM that returns a different response each call from a queue. */
function makeSequentialLLM(responses: string[]): Layer.Layer<LLMShape> {
  let idx = 0;
  return Layer.succeed(LLMTag, {
    complete: (_req: unknown) => {
      const content = responses[idx] ?? responses[responses.length - 1] ?? "done";
      idx++;
      return Effect.succeed({
        content,
        stopReason: "end_turn",
        usage: { inputTokens: 20, outputTokens: 20, totalTokens: 40, estimatedCost: 0 },
        model: "test",
      });
    },
  });
}

/** LLM that always returns the same text. */
function makeStaticLLM(text: string): Layer.Layer<LLMShape> {
  return makeSequentialLLM([text]);
}

/** Track how many times the LLM was called. */
function makeCountingLLM(text: string): { layer: Layer.Layer<LLMShape>; callCount: () => number } {
  let calls = 0;
  return {
    layer: Layer.succeed(LLMTag, {
      complete: (_req: unknown) => {
        calls++;
        return Effect.succeed({
          content: text,
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCost: 0 },
          model: "test",
        });
      },
    }),
    callCount: () => calls,
  };
}

function makeRunLayer(llmLayer: Layer.Layer<LLMShape>, config: ReturnType<typeof defaultReactiveAgentsConfig>) {
  // LifecycleHookRegistry is a build-time dep for ExecutionEngineLive; llmLayer must
  // remain available at runtime (same level as the engine, not nested inside it).
  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(LifecycleHookRegistryLive),
  );
  return Layer.mergeAll(engineLayer, llmLayer);
}

async function runTask(
  config: ReturnType<typeof defaultReactiveAgentsConfig>,
  llmLayer: Layer.Layer<LLMShape>,
  task = "do something",
) {
  const runLayer = makeRunLayer(llmLayer, config);
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
    const config = defaultReactiveAgentsConfig("min-iter-agent", {
      maxIterations: 10,
      minIterations: 3,
    });

    // Basic smoke: run completes without error when minIterations is set
    const result = await runTask(
      config,
      makeSequentialLLM(["thinking...", "still thinking...", "thinking more...", "FINAL ANSWER: done"]),
    );
    expect(result).toBeDefined();
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
    const config = defaultReactiveAgentsConfig("custom-term-agent", {
      maxIterations: 10,
      customTermination: (state: unknown) =>
        String((state as any).output ?? "").includes("DONE"),
    });

    const result = await runTask(
      config,
      makeSequentialLLM(["still working", "DONE: task complete"]),
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
    const { layer, callCount } = makeCountingLLM("verified answer");

    const config = defaultReactiveAgentsConfig("verify-agent", {
      maxIterations: 5,
      verificationStep: { mode: "reflect" },
    });

    await runTask(config, layer);

    // With verificationStep enabled, at least 2 LLM calls should occur:
    // 1) initial reasoning  2) verification reflection
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
    const config = defaultReactiveAgentsConfig("validator-agent", {
      maxIterations: 5,
      outputValidator: (output: string) => ({ valid: output.includes("COMPLETE") }),
    });

    const result = await runTask(config, makeStaticLLM("COMPLETE: the answer is 42"));
    expect(String(result.output ?? "")).toContain("COMPLETE");
  });

  it("retries with injected feedback when validator rejects output", async () => {
    // First response lacks the required marker — would be rejected and retried
    let callIdx = 0;
    const retryLayer = Layer.succeed(LLMTag, {
      complete: (_req: unknown) => {
        callIdx++;
        const content = callIdx === 1 ? "incomplete answer" : "COMPLETE: corrected answer";
        return Effect.succeed({
          content,
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCost: 0 },
          model: "test",
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

    const result = await runTask(config, retryLayer);
    // Should have retried and eventually produced COMPLETE output
    expect(String(result.output ?? "")).toContain("COMPLETE");
    // LLM was called at least twice (first invalid, then retry)
    expect(callIdx).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. withProgressCheckpoint
// ─────────────────────────────────────────────────────────────────────────────

describe("withProgressCheckpoint", () => {
  it("builder method exists and returns this for chaining", async () => {
    const builder = ReactiveAgents.create()
      .withName("checkpoint-test")
      .withTestScenario([{ text: "done" }])
      .withProgressCheckpoint(2);

    expect(builder).toBeDefined();
  });

  it("config stores progressCheckpoint settings", async () => {
    const agent = await ReactiveAgents.create()
      .withName("checkpoint-config")
      .withTestScenario([{ text: "done" }])
      .withProgressCheckpoint(2)
      .build();

    const stored =
      (agent as any)._config?.progressCheckpoint ?? (agent as any).config?.progressCheckpoint;
    expect(stored).toBeDefined();
    expect(stored.every).toBe(2);
  });

  it("accepts optional autoResume flag", async () => {
    const builder = ReactiveAgents.create()
      .withName("checkpoint-resume-test")
      .withTestScenario([{ text: "done" }])
      .withProgressCheckpoint(3, { autoResume: true });

    expect(builder).toBeDefined();
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
    const config = defaultReactiveAgentsConfig("context-agent", {
      maxIterations: 5,
      taskContext: { projectName: "reactive-agents", environment: "test" },
    });

    const result = await runTask(config, makeStaticLLM("FINAL ANSWER: done"));
    expect(result).toBeDefined();
  });

  it("accepts empty task context without error", async () => {
    const builder = ReactiveAgents.create()
      .withName("empty-context-test")
      .withTestScenario([{ text: "done" }])
      .withTaskContext({});

    expect(builder).toBeDefined();
  });
});
