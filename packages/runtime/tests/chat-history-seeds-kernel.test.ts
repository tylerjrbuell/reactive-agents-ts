import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

// ── Tool-capable chat must seed the kernel with prior conversation turns ──
//
// Regression: `ReactiveAgent.chat(..., { useTools:true })` runs a full kernel
// via `run()`. Before this fix the kernel only saw the current message — chat
// history was dropped, so tool-enabled chat answered as if it had no memory of
// earlier turns. The fix threads history through `task.metadata.context.
// conversationHistory` → reasoning-think → kernel `initialMessages`. This pins
// that the engine forwards a history-prepended `initialMessages` to the
// ReasoningService.

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: {
    initialMessages?: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
    [k: string]: unknown;
  }) => Effect.Effect<{
    output: unknown;
    status: string;
    steps?: readonly { id: string; type: string; content: string }[];
    metadata: { cost: number; tokensUsed: number; stepsCount: number };
  }>;
}>("ReasoningService");

const taskWithHistory = {
  id: "task-chs-001" as any,
  agentId: "agent-chs" as any,
  type: "query" as const,
  input: { question: "What did I just ask you?" },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: {
    tags: [],
    context: {
      conversationHistory: [
        { role: "user", content: "My name is Ada." },
        { role: "assistant", content: "Nice to meet you, Ada." },
        // Defensive: malformed entries must be dropped, not crash.
        { role: "system", content: "ignored" },
        { role: "user", content: 42 },
        null,
      ],
    },
  },
  createdAt: new Date(),
};

describe("Tool-capable chat seeds kernel with conversation history", () => {
  it("forwards history-prepended initialMessages to ReasoningService.execute()", async () => {
    const capturedParams: Array<{
      initialMessages?: readonly { readonly role: string; readonly content: string }[];
    }> = [];

    const stubReasoning = {
      execute: (params: any) => {
        capturedParams.push(params);
        return Effect.succeed({
          output: "You said your name is Ada.",
          status: "completed",
          steps: [{ id: "s-1", type: "thought", content: "recalled from history" }],
          metadata: { cost: 0, tokensUsed: 20, stepsCount: 1 },
        });
      },
    };
    const MockReasoning = Layer.succeed(ReasoningServiceTag, stubReasoning);

    const config = defaultReactiveAgentsConfig("agent-chs", {});
    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(hookLayer));
    const testLayer = Layer.mergeAll(hookLayer, engineLayer, MockReasoning);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(taskWithHistory);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(capturedParams.length).toBeGreaterThan(0);
    const seeded = capturedParams[0]!.initialMessages ?? [];

    // Valid history (2 turns) prepended, malformed entries dropped, current task last.
    expect(seeded).toEqual([
      { role: "user", content: "My name is Ada." },
      { role: "assistant", content: "Nice to meet you, Ada." },
      { role: "user", content: "What did I just ask you?" },
    ]);

    expect(result.success).toBe(true);
  });

  it("seeds only the task when no history is present", async () => {
    const capturedParams: Array<{
      initialMessages?: readonly { readonly role: string; readonly content: string }[];
    }> = [];
    const stubReasoning = {
      execute: (params: any) => {
        capturedParams.push(params);
        return Effect.succeed({
          output: "ok",
          status: "completed",
          steps: [],
          metadata: { cost: 0, tokensUsed: 5, stepsCount: 0 },
        });
      },
    };
    const config = defaultReactiveAgentsConfig("agent-chs2", {});
    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(hookLayer));
    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      Layer.succeed(ReasoningServiceTag, stubReasoning),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute({
          id: "task-chs-002" as any,
          agentId: "agent-chs2" as any,
          type: "query" as const,
          input: { question: "Hello there" },
          priority: "medium" as const,
          status: "pending" as const,
          metadata: { tags: [] },
          createdAt: new Date(),
        });
      }).pipe(Effect.provide(testLayer)),
    );

    expect(capturedParams[0]!.initialMessages).toEqual([
      { role: "user", content: "Hello there" },
    ]);
  });
});
