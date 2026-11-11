/**
 * ToolCallStarted carries the call's post-heal arguments (`args`), so a UI can
 * show a long-running call before it completes. Both emitters are pinned:
 *   - kernel path: act.ts -> hooks.onAction -> kernel-hooks.ts
 *   - canonical primitive (plan-execute): tool-observe.ts with emitToolCallEvents
 */
import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { NativeFCDriver } from "@reactive-agents/tools";
import type { KernelStateLike } from "@reactive-agents/core";
import { handleActing } from "../../../src/kernel/capabilities/act/act.js";
import { executeToolAndObserve } from "../../../src/kernel/capabilities/act/tool-observe.js";
import { buildKernelHooks } from "../../../src/kernel/state/kernel-hooks.js";
import {
  initialKernelState,
  type KernelContext,
  type KernelState,
  type ToolServiceInstance,
} from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import type { StepId } from "../../../src/types/step.js";

interface Published {
  readonly _tag: string;
  readonly callId?: string;
  readonly args?: unknown;
}

/** Minimal EventBus double (an `Option`-shaped duck-type) recording what is published. */
function recordingBus(sink: Published[]) {
  return {
    _tag: "Some" as const,
    value: {
      publish: (event: unknown) => Effect.sync(() => { sink.push(event as Published); }),
    },
  };
}

function toolService(): Option.Option<ToolServiceInstance> {
  return Option.some({
    execute: (req) => Effect.succeed({ success: true, result: { ok: req.toolName } }),
    getTool: () => Effect.fail(new Error("no schema")),
    listTools: () => Effect.succeed([]),
  });
}

const SEARCH_SCHEMA = {
  name: "web-search",
  description: "search",
  parameters: [{ name: "query", type: "string", description: "q", required: true }],
};

describe("ToolCallStarted carries post-heal args", () => {
  it("kernel act path: the started event's args equal the executed call's arguments", async () => {
    const published: Published[] = [];
    const state: KernelState = {
      ...initialKernelState({ maxIterations: 3, strategy: "reactive", kernelType: "react", taskId: "args-task" }),
      status: "acting",
      steps: [{ id: "t-1" as StepId, type: "thought", content: "search", timestamp: new Date() }],
      meta: {
        pendingNativeToolCalls: [{ id: "call-1", name: "web-search", arguments: { query: "effect ts" } }],
        lastThought: "search",
        lastThinking: null,
      },
    };
    const context: KernelContext = {
      input: { task: "search", availableToolSchemas: [SEARCH_SCHEMA] } as KernelContext["input"],
      profile: CONTEXT_PROFILES["mid"],
      compression: { budget: 800, previewItems: 3, autoStore: true, codeTransform: true },
      toolService: toolService(),
      hooks: buildKernelHooks(recordingBus(published) as never),
      toolCallingDriver: new NativeFCDriver(),
    };

    const result = await Effect.runPromise(handleActing(state, context).pipe(Effect.provide(TestLLMServiceLayer())));

    const started = published.filter((e) => e._tag === "ToolCallStarted");
    expect(started).toHaveLength(1);
    expect(started[0]!.callId).toBe("call-1");
    const action = result.steps.find((s) => s.type === "action");
    const executed = (action?.metadata?.toolCall as { arguments?: unknown } | undefined)?.arguments;
    expect(executed).toBeDefined();
    expect(started[0]!.args).toEqual(executed);
    expect(started[0]!.args).toMatchObject({ query: "effect ts" });
  });

  it("canonical primitive: emitToolCallEvents publishes args", async () => {
    const published: Published[] = [];
    const syntheticState: KernelStateLike = {
      taskId: "args-task", strategy: "plan-execute", kernelType: "react", steps: [],
      toolsUsed: new Set<string>(), iteration: 0, tokens: 0, status: "acting", output: null, error: null, meta: {},
    };
    await Effect.runPromise(
      executeToolAndObserve(
        toolService(),
        { toolName: "web-search", args: { query: "effect ts" } },
        { iteration: 2, phase: "act", strategy: "plan-execute", state: syntheticState, callId: "pe-1" },
        { extractFactsLLM: false, emitToolCallEvents: true, eventBus: recordingBus(published) as never, taskId: "args-task" },
      ),
    );
    const started = published.filter((e) => e._tag === "ToolCallStarted");
    expect(started).toHaveLength(1);
    expect(started[0]!.args).toEqual({ query: "effect ts" });
  });
});
