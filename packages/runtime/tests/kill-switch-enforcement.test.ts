import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
  KillSwitchTriggeredError,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import { KillSwitchService, KillSwitchServiceLive } from "@reactive-agents/guardrails";

// ─── Mock LLM that returns a simple answer ───

const MockLLMServiceLive = Layer.succeed(
  Context.GenericTag<{
    complete: (req: unknown) => Effect.Effect<{
      content: string;
      stopReason: string;
      toolCalls?: unknown[];
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCost: number;
      };
      model: string;
    }>;
  }>("LLMService"),
  {
    complete: (_req: unknown) =>
      Effect.succeed({
        content: "Task completed: Here is the answer.",
        stopReason: "end_turn",
        toolCalls: [],
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          estimatedCost: 0.001,
        },
        model: "test-model",
      }),
  },
);

const mockTask = {
  id: "task-ks-001" as any,
  agentId: "agent-ks" as any,
  type: "query" as const,
  input: { question: "What is 2+2?" },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: { tags: [] },
  createdAt: new Date(),
};

describe("Kill Switch Enforcement", () => {
  it("should abort execution when agent is stopped via kill switch", async () => {
    const config = defaultReactiveAgentsConfig("agent-ks", {
      enableKillSwitch: true,
    });

    const hookLayer = LifecycleHookRegistryLive;
    const ksLayer = KillSwitchServiceLive();
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
      Layer.provide(ksLayer),
    );

    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLMServiceLive,
      ksLayer,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Trigger the kill switch BEFORE execution
        const ks = yield* KillSwitchService;
        yield* ks.trigger("agent-ks", "Emergency stop");

        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask).pipe(Effect.either);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("KillSwitchTriggeredError");
      if (result.left._tag === "KillSwitchTriggeredError") {
        expect(result.left.message).toContain("Kill switch triggered");
        expect(result.left.reason).toContain("Emergency stop");
      }
    }
  });

  it("should abort execution when agent is stopped via stop()", async () => {
    const config = defaultReactiveAgentsConfig("agent-ks", {
      enableKillSwitch: true,
    });

    const hookLayer = LifecycleHookRegistryLive;
    const ksLayer = KillSwitchServiceLive();
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
      Layer.provide(ksLayer),
    );

    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLMServiceLive,
      ksLayer,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Signal stop BEFORE execution
        const ks = yield* KillSwitchService;
        yield* ks.stop("agent-ks", "User requested stop");

        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask).pipe(Effect.either);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("KillSwitchTriggeredError");
      if (result.left._tag === "KillSwitchTriggeredError") {
        expect(result.left.message).toContain("stopping gracefully");
      }
    }
  });

  it("should execute normally without kill switch enabled (backward compat)", async () => {
    const config = defaultReactiveAgentsConfig("agent-ks", {
      enableKillSwitch: false,
    });

    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
    );

    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLMServiceLive,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(String(result.taskId)).toBe("task-ks-001");
  });

  it("should execute normally when kill switch is enabled but not triggered", async () => {
    const config = defaultReactiveAgentsConfig("agent-ks", {
      enableKillSwitch: true,
    });

    const hookLayer = LifecycleHookRegistryLive;
    const ksLayer = KillSwitchServiceLive();
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
      Layer.provide(ksLayer),
    );

    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLMServiceLive,
      ksLayer,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(String(result.taskId)).toBe("task-ks-001");
  });

  it("should abort when global kill switch is triggered", async () => {
    const config = defaultReactiveAgentsConfig("agent-ks", {
      enableKillSwitch: true,
    });

    const hookLayer = LifecycleHookRegistryLive;
    const ksLayer = KillSwitchServiceLive();
    const engineLayer = ExecutionEngineLive(config).pipe(
      Layer.provide(hookLayer),
      Layer.provide(ksLayer),
    );

    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      MockLLMServiceLive,
      ksLayer,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Trigger global kill switch
        const ks = yield* KillSwitchService;
        yield* ks.triggerGlobal("System shutdown");

        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask).pipe(Effect.either);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("KillSwitchTriggeredError");
      if (result.left._tag === "KillSwitchTriggeredError") {
        expect(result.left.reason).toContain("System shutdown");
      }
    }
  });
});
