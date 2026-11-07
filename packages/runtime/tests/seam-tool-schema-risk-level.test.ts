/**
 * Seam pin: the tool definition's `riskLevel` reaches the kernel.
 *
 * Plan 9 gave the kernel's `ToolSchema` an optional `riskLevel` so the text
 * tool-call parser may bind an embedded low-risk call (`const x = fileRead("/abs")`).
 * The runtime projects `ToolDefinition` into that shape before handing it to
 * `ReasoningService.execute`; if the projection drops `riskLevel`, the parser
 * rule is inert in every live run. Two pins:
 *   1. `toKernelToolSchema` (the one projection helper) carries it.
 *   2. The engine actually routes registered tools through that projection, so
 *      `availableToolSchemas` / `allToolSchemas` at the reasoning boundary carry it.
 */
import { describe, it, expect } from "bun:test";
import { Context, Effect, Layer, Stream } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import type { AgentId, TaskId } from "@reactive-agents/core";
import { ToolService, ToolServiceLive, type ToolDefinition } from "@reactive-agents/tools";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import {
  toKernelToolSchema,
  type ToolSchema,
} from "../src/engine/phases/agent-loop/setup/tool-schemas.js";

const def = (name: string, riskLevel: ToolDefinition["riskLevel"]): ToolDefinition => ({
  name,
  description: `Tool ${name}`,
  parameters: [{ name: "path", type: "string", description: "Absolute path", required: true }],
  riskLevel,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function",
});

/**
 * Every optional `ToolParameter` field. A hand-picked projection once dropped
 * all of these (built-in enums, file-write's `semantic: "file-content"` that
 * drives the healing pipeline's value-shape stage) before the kernel saw them.
 */
const richDef = (): ToolDefinition => ({
  ...def("probe-rich", "low"),
  parameters: [
    { name: "language", type: "string", description: "Language", required: true, enum: ["js", "py"] },
    { name: "paths", type: "array", description: "Paths", required: false, items: { type: "string" } },
    {
      name: "headers",
      type: "object",
      description: "Headers",
      required: false,
      additionalProperties: { type: "string" },
    },
    { name: "content", type: "string", description: "Body", required: true, semantic: "file-content" },
    { name: "mode", type: "string", description: "Mode", required: false, default: "w" },
  ],
});

describe("toKernelToolSchema", () => {
  it("passes every ToolParameter field through (enum, items, additionalProperties, semantic, default)", () => {
    expect(toKernelToolSchema(richDef()).parameters).toEqual([...richDef().parameters]);
  });

  it("carries riskLevel from the tool definition", () => {
    expect(toKernelToolSchema(def("probe-read", "low")).riskLevel).toBe("low");
    expect(toKernelToolSchema(def("probe-write", "critical")).riskLevel).toBe("critical");
  });

  it("keeps the established projection fields", () => {
    const schema = toKernelToolSchema({ ...def("probe-read", "low"), returnType: "string" });
    expect(schema).toEqual({
      name: "probe-read",
      description: "Tool probe-read",
      returnType: "string",
      riskLevel: "low",
      parameters: [{ name: "path", type: "string", description: "Absolute path", required: true }],
    });
  });
});

type CapturedExecute = {
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly allToolSchemas?: readonly ToolSchema[];
};

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: CapturedExecute) => Effect.Effect<{
    output: unknown;
    status: string;
    steps?: readonly { id: string; type: string; content: string }[];
    metadata: { cost: number; tokensUsed: number; stepsCount: number };
  }>;
}>("ReasoningService");

describe("engine forwards riskLevel to the reasoning boundary", () => {
  it("availableToolSchemas and allToolSchemas carry the registered tool's riskLevel", async () => {
    const captured: CapturedExecute[] = [];
    const stubReasoning = {
      execute: (params: CapturedExecute) => {
        captured.push(params);
        return Effect.succeed({
          output: "ok",
          status: "completed",
          steps: [],
          metadata: { cost: 0, tokensUsed: 5, stepsCount: 0 },
        });
      },
    };
    const config = defaultReactiveAgentsConfig("agent-risk", {});
    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(hookLayer));
    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      Layer.succeed(ReasoningServiceTag, stubReasoning),
      ToolServiceLive.pipe(Layer.provide(EventBusLive)),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const tools = yield* ToolService;
        yield* tools.register(def("probe-read", "low"), () => Effect.succeed("contents"));
        yield* tools.register(richDef(), () => Effect.succeed("ok"));
        const engine = yield* ExecutionEngine;
        const stream = yield* engine.executeStream({
          id: "task-risk-001" as TaskId,
          agentId: "agent-risk" as AgentId,
          type: "query" as const,
          input: { question: "Read the probe file." },
          priority: "medium" as const,
          status: "pending" as const,
          metadata: { tags: [] },
          createdAt: new Date(),
        });
        yield* Stream.runDrain(stream);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(captured.length).toBeGreaterThan(0);
    const first = captured[0]!;
    const visible = first.availableToolSchemas?.find((s) => s.name === "probe-read");
    const exposed = first.allToolSchemas?.find((s) => s.name === "probe-read");
    expect(visible?.riskLevel).toBe("low");
    expect(exposed?.riskLevel).toBe("low");
    // The full parameter set reaches the reasoning boundary, not a hand-picked subset.
    const rich = first.availableToolSchemas?.find((s) => s.name === "probe-rich");
    expect(rich?.parameters).toEqual([...richDef().parameters]);
  });
});
