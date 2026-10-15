// Run: bun test packages/runtime/tests/guardrail-output-screen.test.ts --timeout 30000
//
// Wave 6.2 — `GuardrailService.checkOutput` had no caller: the GUARDRAIL phase
// screens only the INPUT, so a run could exfiltrate PII it legitimately
// retrieved and ship it as its answer. The engine post-arm now screens the
// final output (fail CLOSED on violations + event; fail OPEN with an event on
// service errors — never silent).
//
// RED-ON-CUT: delete the post-arm output screen and the violation arm passes
// with success:true (the leak ships).
import { describe, expect, it } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { ExecutionEngine, ExecutionEngineLive, LifecycleHookRegistryLive } from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: { [k: string]: unknown }) => Effect.Effect<{
    output: unknown;
    status: "completed" | "failed" | "partial";
    steps?: readonly { id: string; type: string; content: string }[];
    metadata: { cost: number; tokensUsed: number; stepsCount: number };
  }>;
}>("ReasoningService");

const mockReasoning = (content: string): Layer.Layer<any, any> =>
  Layer.succeed(ReasoningServiceTag, {
    execute: (_params: { [k: string]: unknown }) =>
      Effect.succeed({
        output: content,
        status: "completed" as const,
        steps: [{ id: "step-1", type: "thought", content }],
        metadata: { cost: 0.001, tokensUsed: 30, stepsCount: 1 },
      }),
  });

const mockGuardrail = (checkOutput: (text: string) => Effect.Effect<any, any>): Layer.Layer<any, any> =>
  Layer.succeed(
    Context.GenericTag<{
      check: (text: string) => Effect.Effect<any, any>;
      checkOutput: (text: string) => Effect.Effect<any, any>;
      getConfig: () => Effect.Effect<any, any>;
    }>("GuardrailService"),
    {
      check: (_text) => Effect.succeed({ passed: true, violations: [], score: 1, checkedAt: new Date() }),
      checkOutput,
      getConfig: () => Effect.succeed({}),
    },
  );

const mockTask = {
  id: "task-001" as any,
  agentId: "agent-001" as any,
  type: "query" as const,
  input: { question: "Summarize the customer record." },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: { tags: [] },
  createdAt: new Date(),
};

const makeTestLayer = (
  reasoningLayer: Layer.Layer<any, any>,
  guardrailLayer: Layer.Layer<any, any>,
) => {
  const config = { ...defaultReactiveAgentsConfig("agent-001"), enableGuardrails: true };
  const hookLayer = LifecycleHookRegistryLive;
  const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(hookLayer));
  return Layer.mergeAll(hookLayer, engineLayer, reasoningLayer, guardrailLayer);
};

describe("6.2 final-output guardrail screen", () => {
  it("clean output passes through untouched", async () => {
    let screened: string | undefined;
    const testLayer = makeTestLayer(
      mockReasoning("The customer record is on file."),
      mockGuardrail((text) => {
        screened = text;
        return Effect.succeed({ passed: true, violations: [], score: 1, checkedAt: new Date() });
      }),
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );
    expect((result as { success: boolean }).success).toBe(true);
    expect(screened).toContain("on file");
  });

  it("PII violation fails the run closed (the leak does not ship)", async () => {
    const testLayer = makeTestLayer(
      mockReasoning("The SSN is 123-45-6789."),
      mockGuardrail(() =>
        Effect.succeed({
          passed: false,
          violations: [{ type: "pii", severity: "high", message: "SSN detected" }],
          score: 0,
          checkedAt: new Date(),
        }),
      ),
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask).pipe(Effect.either);
      }).pipe(Effect.provide(testLayer)),
    );
    expect(result._tag).toBe("Left");
  });
});
