/**
 * Behavioral Contract Enforcement Tests
 *
 * Verifies that BehavioralContractService is actually wired into the execution
 * engine — i.e. checkToolCall and checkIteration are called at runtime.
 */

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import { BehavioralContractServiceLive } from "@reactive-agents/guardrails";
import { ReactiveAgents } from "../src/index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockTask = (input = "test task", agentId = "test-agent") => ({
  id: `task-${Date.now()}` as any,
  agentId: agentId as any,
  type: "query" as const,
  input: { question: input },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: { tags: [] },
  createdAt: new Date(),
});

function makeEngineLayer(
  agentId: string,
  overrides?: Partial<import("../src/types.js").ReactiveAgentsConfig>,
) {
  const config = defaultReactiveAgentsConfig(agentId, overrides);
  return {
    config,
    engineLayer: ExecutionEngineLive(config).pipe(
      Layer.provide(LifecycleHookRegistryLive),
    ),
  };
}

function makeToolCallLLM() {
  let callCount = 0;
  return Layer.succeed(
    Context.GenericTag<{
      complete: (req: unknown) => Effect.Effect<{
        content: string;
        stopReason: string;
        toolCalls?: unknown[];
        usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number };
      }>;
    }>("LLMService"),
    {
      complete: () => {
        callCount++;
        return Effect.succeed({
          content: "Using file-write tool",
          stopReason: "tool_use",
          toolCalls: callCount === 1
            ? [{ id: "call-1", name: "file-write", input: { path: "test.txt", content: "hi" } }]
            : [],
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCost: 0 },
        });
      },
    },
  );
}

function makeNeverEndingLLM() {
  return Layer.succeed(
    Context.GenericTag<{
      complete: (req: unknown) => Effect.Effect<{
        content: string;
        stopReason: string;
        toolCalls?: unknown[];
        usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number };
      }>;
    }>("LLMService"),
    {
      complete: () =>
        Effect.succeed({
          content: "Still thinking...",
          stopReason: "max_tokens",
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCost: 0 },
        }),
    },
  );
}

const MockToolServiceLayer = Layer.succeed(
  Context.GenericTag<{
    listTools: () => Effect.Effect<readonly unknown[]>;
    execute: (params: unknown) => Effect.Effect<{ result: unknown }>;
    toFunctionCallingFormat: () => Effect.Effect<readonly unknown[]>;
    getTool: (name: string) => Effect.Effect<unknown>;
  }>("ToolService"),
  {
    listTools: () => Effect.succeed([]),
    execute: () => Effect.succeed({ result: "done" }),
    toFunctionCallingFormat: () =>
      Effect.succeed([{ name: "file-write", description: "Write files", parameters: [] }]),
    getTool: () => Effect.succeed(null),
  },
);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Behavioral Contract Enforcement", () => {
  it("normal execution without contracts succeeds (regression guard)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("no-contract-agent")
      .withTestScenario([{ match: "test", text: "Hello from the agent" }])
      .build();

    const result = await agent.run("test task");
    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  });

  it("blocks denied tool at execution time", async () => {
    const { engineLayer } = makeEngineLayer("contract-denied-tool", {
      enableBehavioralContracts: true,
      enableTools: true,
    });

    const contractLayer = BehavioralContractServiceLive({ deniedTools: ["file-write"] });

    const testLayer = Layer.mergeAll(
      engineLayer,
      makeToolCallLLM(),
      MockToolServiceLayer,
      contractLayer,
    );

    let caughtError: unknown = null;
    try {
      await Effect.runPromise(
        ExecutionEngine.pipe(
          Effect.flatMap((engine) => engine.execute(mockTask("write a file", "contract-denied-tool"))),
          Effect.provide(testLayer),
        ),
      );
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).not.toBeNull();
    const msg = caughtError instanceof Error ? caughtError.message : String(caughtError);
    expect(msg).toMatch(/contract|denied|not allowed|behavioral/i);
  });

  it("blocks when maxToolCalls is 0 and tool call attempted", async () => {
    const { engineLayer } = makeEngineLayer("contract-max-tools", {
      enableBehavioralContracts: true,
      enableTools: true,
    });

    const contractLayer = BehavioralContractServiceLive({ maxToolCalls: 0 });

    const testLayer = Layer.mergeAll(
      engineLayer,
      makeToolCallLLM(),
      MockToolServiceLayer,
      contractLayer,
    );

    let caughtError: unknown = null;
    try {
      await Effect.runPromise(
        ExecutionEngine.pipe(
          Effect.flatMap((engine) => engine.execute(mockTask("use tools", "contract-max-tools"))),
          Effect.provide(testLayer),
        ),
      );
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).not.toBeNull();
    const msg = caughtError instanceof Error ? caughtError.message : String(caughtError);
    expect(msg).toMatch(/contract|limit|tool|behavioral/i);
  });

  it("maxIterations contract blocks execution after limit", async () => {
    const { engineLayer } = makeEngineLayer("contract-iter-limit", {
      maxIterations: 10,
      enableBehavioralContracts: true,
    });

    // Contract: max 1 iteration — iteration 2+ triggers block
    const contractLayer = BehavioralContractServiceLive({ maxIterations: 1 });

    const testLayer = Layer.mergeAll(
      engineLayer,
      makeNeverEndingLLM(),
      contractLayer,
    );

    let caughtError: unknown = null;
    try {
      await Effect.runPromise(
        ExecutionEngine.pipe(
          Effect.flatMap((engine) => engine.execute(mockTask("loop forever", "contract-iter-limit"))),
          Effect.provide(testLayer),
        ),
      );
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).not.toBeNull();
    const msg = caughtError instanceof Error ? caughtError.message : String(caughtError);
    expect(msg).toMatch(/iteration|contract|limit|behavioral/i);
  });
});
