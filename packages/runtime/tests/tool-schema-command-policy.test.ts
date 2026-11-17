/**
 * Seam pin: a command-running tool's `commandPolicy` reaches the kernel.
 *
 * Plan producers render the allowed executables next to `shell-execute` so a
 * planner never spends a step confirming a command exists. The runtime
 * projects `ToolDefinition` into the kernel `ToolSchema`; if the projection
 * drops `commandPolicy` the plan prompt silently loses that line. Two pins:
 *   1. `toKernelToolSchema` carries it (and omits it when absent).
 *   2. A plan-posture run with the terminal tool registered hands
 *      `allToolSchemas` to the reasoning boundary with `shell-execute` and its policy.
 */
import { describe, it, expect } from "bun:test";
import { Context, Effect, Layer, Stream } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import type { AgentId, TaskId } from "@reactive-agents/core";
import { ToolService, ToolServiceLive, shellExecuteTool, type ToolDefinition } from "@reactive-agents/tools";
import { ExecutionEngine, ExecutionEngineLive, LifecycleHookRegistryLive } from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import { toKernelToolSchema, type ToolSchema } from "../src/engine/phases/agent-loop/setup/tool-schemas.js";

const plain: ToolDefinition = {
  name: "probe",
  description: "Tool probe",
  parameters: [],
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function",
};

describe("toKernelToolSchema commandPolicy", () => {
  it("carries the policy when the definition has one and omits the key otherwise", () => {
    expect(toKernelToolSchema(plain)).not.toHaveProperty("commandPolicy");
    const policy = shellExecuteTool.commandPolicy;
    expect(policy).toBeDefined();
    expect(toKernelToolSchema(shellExecuteTool).commandPolicy).toEqual(policy);
  });
});

type Captured = { readonly allToolSchemas?: readonly ToolSchema[] };

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: Captured) => Effect.Effect<{
    output: unknown;
    status: string;
    steps?: readonly { id: string; type: string; content: string }[];
    metadata: { cost: number; tokensUsed: number; stepsCount: number };
  }>;
}>("ReasoningService");

describe("plan posture forwards commandPolicy to the reasoning boundary", () => {
  it("allToolSchemas has shell-execute with its commandPolicy", async () => {
    const captured: Captured[] = [];
    const stub = {
      execute: (params: Captured) => {
        captured.push(params);
        return Effect.succeed({ output: "ok", status: "completed", steps: [], metadata: { cost: 0, tokensUsed: 5, stepsCount: 0 } });
      },
    };
    const config = defaultReactiveAgentsConfig("agent-policy", {});
    const hooks = LifecycleHookRegistryLive;
    const layer = Layer.mergeAll(
      hooks,
      ExecutionEngineLive(config).pipe(Layer.provide(hooks)),
      Layer.succeed(ReasoningServiceTag, stub),
      ToolServiceLive.pipe(Layer.provide(EventBusLive)),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const tools = yield* ToolService;
        yield* tools.register(shellExecuteTool, () => Effect.succeed("ok"));
        const engine = yield* ExecutionEngine;
        const stream = yield* engine.executeStream({
          id: "task-policy-001" as TaskId,
          agentId: "agent-policy" as AgentId,
          type: "query" as const,
          input: { question: "Plan how to list the files." },
          priority: "medium" as const,
          status: "pending" as const,
          metadata: { tags: [], context: { posture: "plan" } },
          createdAt: new Date(),
        });
        yield* Stream.runDrain(stream);
      }).pipe(Effect.provide(layer)),
    );
    expect(captured.length).toBeGreaterThan(0);
    const shell = captured[0]!.allToolSchemas?.find((s) => s.name === "shell-execute");
    expect(shell).toBeDefined();
    expect(shell?.commandPolicy).toEqual(shellExecuteTool.commandPolicy);
  });
});
