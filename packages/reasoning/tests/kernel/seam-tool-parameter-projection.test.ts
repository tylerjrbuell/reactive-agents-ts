// Run: bun test packages/reasoning/tests/kernel/seam-tool-parameter-projection.test.ts --timeout 15000
//
// Seam pin: a `ToolDefinition` parameter keeps every field (`enum`,
// `semantic`, ...) on each projection inside reasoning. Each path used to copy
// parameters field by field, so a field added to `ToolParameter` silently
// dropped (built-in enums never reached native-FC models; the file-content
// `semantic` never reached the healing pipeline). Synthetic fixtures only.
import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import type { KernelStateLike } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { FILE_CONTENT_JSON_TYPES, TextParseDriver, type ToolDefinition } from "@reactive-agents/tools";
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";
import { buildWireParameterSchema } from "../../src/kernel/capabilities/reason/wire-parameter-schema.js";
import { executeToolAndObserve } from "../../src/kernel/capabilities/act/tool-observe.js";
import { handleActing } from "../../src/kernel/capabilities/act/act.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelState,
  type ToolServiceInstance,
} from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import type { StepId } from "../../src/types/step.js";

const DEFINITION: ToolDefinition = {
  name: "save-doc",
  description: "Save a document",
  parameters: [
    { name: "content", type: "string", description: "Document text", required: true, semantic: "file-content" },
    { name: "format", type: "string", description: "Output format", required: true, enum: ["json", "text"] },
  ],
  riskLevel: "low",
  timeoutMs: 1_000,
  requiresApproval: false,
  source: "function",
};

// The kernel schema is the definition's own parameters: no field copy.
const KERNEL_SCHEMA: ToolSchema = {
  name: DEFINITION.name,
  description: DEFINITION.description,
  parameters: DEFINITION.parameters,
};

const JSON_VALUE = { a: 1 };
const SERIALIZED = `${JSON.stringify(JSON_VALUE, null, 2)}\n`;

function capturingToolService(seen: Record<string, unknown>[]): Option.Option<ToolServiceInstance> {
  return Option.some({
    execute: (req) => {
      seen.push(req.arguments);
      return Effect.succeed({ success: true, result: { saved: true } });
    },
    getTool: () => Effect.fail(new Error("no schema")),
    listTools: () => Effect.succeed([]),
  });
}

const syntheticState: KernelStateLike = {
  taskId: "projection-task",
  strategy: "react",
  kernelType: "react",
  steps: [],
  toolsUsed: new Set<string>(),
  iteration: 0,
  tokens: 0,
  status: "acting",
  output: null,
  error: null,
  meta: {},
};

describe("tool parameter projection keeps every ToolParameter field", () => {
  it("kernel ToolSchema carries enum and semantic", () => {
    expect(KERNEL_SCHEMA.parameters[0]?.semantic).toBe("file-content");
    expect(KERNEL_SCHEMA.parameters[1]?.enum).toEqual(["json", "text"]);
  });

  it("FC wire schema: semantic widens content, enum survives, compact drops only description", () => {
    const [content, format] = KERNEL_SCHEMA.parameters;
    expect(buildWireParameterSchema(content!, false).type).toEqual(FILE_CONTENT_JSON_TYPES);
    expect(buildWireParameterSchema(format!, false)).toEqual({
      type: "string",
      description: "Output format",
      enum: ["json", "text"],
    });
    expect(buildWireParameterSchema(format!, true)).toEqual({ type: "string", enum: ["json", "text"] });
  });

  it("tool-observe heal map: semantic reaches the value-shape stage", async () => {
    const seen: Record<string, unknown>[] = [];
    await Effect.runPromise(
      executeToolAndObserve(
        capturingToolService(seen),
        { toolName: "save-doc", args: { content: JSON_VALUE, format: "json" } },
        { iteration: 1, phase: "act", strategy: "plan-execute", state: syntheticState, callId: "p1" },
        { extractFactsLLM: false, heal: { schemas: [KERNEL_SCHEMA], fileToolNames: new Set(), cwd: "/sandbox" } },
      ),
    );
    expect(seen[0]?.content).toBe(SERIALIZED);
  });

  it("kernel act heal map: semantic reaches the value-shape stage", async () => {
    const seen: Record<string, unknown>[] = [];
    const state: KernelState = {
      ...initialKernelState({ maxIterations: 3, strategy: "react-kernel", kernelType: "react", taskId: "projection-act" }),
      status: "acting",
      steps: [{ id: "thought-1" as StepId, type: "thought", content: "Save it.", timestamp: new Date() }],
      meta: {
        pendingNativeToolCalls: [{ id: "a1", name: "save-doc", arguments: { content: JSON_VALUE, format: "json" } }],
        lastThought: "Save it.",
        lastThinking: null,
      },
    };
    const profile = CONTEXT_PROFILES["mid"];
    const context: KernelContext = {
      input: { task: "Save the document", availableToolSchemas: [KERNEL_SCHEMA] } as KernelContext["input"],
      profile,
      compression: { budget: profile.toolResultMaxChars ?? 800, previewItems: 3, autoStore: true, codeTransform: true },
      toolService: capturingToolService(seen),
      hooks: noopHooks,
      toolCallingDriver: new TextParseDriver(),
    };
    await Effect.runPromise(handleActing(state, context).pipe(Effect.provide(TestLLMServiceLayer())));
    expect(seen[0]?.content).toBe(SERIALIZED);
  });
});
