/**
 * interaction-pause.test.ts — Durable interaction pause (Task 9) proof.
 *
 * Mirrors approval-gate-pause.test.ts exactly: drives `handleActing` directly
 * with a pending `request_user_input` tool call and asserts the run PAUSES
 * (terminatedBy="awaiting-interaction" + meta.awaitingInteractionFor) instead
 * of executing the tool — but only when `metaTools.userInteraction` is on.
 * When the flag is off, the call is NOT intercepted (falls through to the
 * normal unknown-tool path instead of pausing).
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { handleActing } from "../../../src/kernel/capabilities/act/act.js";
import { TextParseDriver, REQUEST_USER_INPUT_TOOL_NAME } from "@reactive-agents/tools";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelState,
  type MaybeService,
  type ToolServiceInstance,
} from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import type { StepId } from "../../../src/types/step.js";

function successToolService(): MaybeService<ToolServiceInstance> {
  return {
    _tag: "Some",
    value: {
      execute: (req) => Effect.succeed({ success: true, result: { ok: req.toolName } }),
      getTool: () => Effect.fail(new Error("no schema")),
      listTools: () => Effect.succeed([]),
    },
  };
}

function baseState(
  pendingCalls: { id: string; name: string; arguments: Record<string, unknown> }[],
): KernelState {
  return {
    ...initialKernelState({
      maxIterations: 3,
      strategy: "react-kernel",
      kernelType: "react",
      taskId: "interaction-task",
    }),
    status: "acting",
    steps: [{ id: "thought-1" as StepId, type: "thought", content: "go", timestamp: new Date() }],
    meta: {
      pendingNativeToolCalls: pendingCalls,
      lastThought: "go",
      lastThinking: null,
    },
  };
}

function ctxWithMetaTools(userInteraction: boolean): KernelContext {
  const profile = CONTEXT_PROFILES["mid"];
  return {
    input: {
      task: "book the shipment",
      availableToolSchemas: [{ name: REQUEST_USER_INPUT_TOOL_NAME, description: "ask user", parameters: [] }],
      metaTools: { userInteraction },
    } as KernelContext["input"],
    profile,
    compression: { budget: 800, previewItems: 3, autoStore: true, codeTransform: true },
    toolService: successToolService(),
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
  };
}

const pending = [
  {
    id: "c1",
    name: REQUEST_USER_INPUT_TOOL_NAME,
    arguments: {
      kind: "choice",
      prompt: "Which shipping speed?",
      schema: { options: ["standard", "express"] },
    },
  },
];

describe("request_user_input pause — handleActing", () => {
  it("kernel terminates with awaiting-interaction when model calls request_user_input", async () => {
    const result = await Effect.runPromise(
      handleActing(baseState(pending), ctxWithMetaTools(true)).pipe(
        Effect.provide(TestLLMServiceLayer()),
      ),
    );
    expect(result.meta.terminatedBy).toBe("awaiting-interaction");
    expect(result.meta.awaitingInteractionFor?.kind).toBe("choice");
    expect(result.meta.awaitingInteractionFor?.prompt).toBe("Which shipping speed?");
    expect(result.meta.awaitingInteractionFor?.interactionId).toBeTruthy();
    // The tool did NOT execute — no observation step was appended.
    expect(result.steps.some((s) => s.type === "observation")).toBe(false);
  });

  it("tool NOT offered when userInteraction flag off — no pause", async () => {
    const result = await Effect.runPromise(
      handleActing(baseState(pending), ctxWithMetaTools(false)).pipe(
        Effect.provide(TestLLMServiceLayer()),
      ),
    );
    expect(result.meta.terminatedBy).not.toBe("awaiting-interaction");
    expect(result.meta.awaitingInteractionFor).toBeUndefined();
  });
});
