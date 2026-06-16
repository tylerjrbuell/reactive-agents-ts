/**
 * approval-gate-pause.test.ts — Durable HITL (Phase D) gate-fire proof.
 *
 * Drives `handleActing` directly (the seam used by act-symmetry.test.ts) with a
 * detach-mode approval policy + a pending tool call, and asserts the run PAUSES
 * (terminatedBy="awaiting-approval" + meta.awaitingApprovalFor) instead of
 * executing the tool. Also asserts the one-shot `approvalBypass` flag lets an
 * already-approved call execute without re-pausing.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { handleActing } from "../../../src/kernel/capabilities/act/act.js";
import { TextParseDriver } from "@reactive-agents/tools";
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
  metaExtra: Record<string, unknown> = {},
): KernelState {
  return {
    ...initialKernelState({
      maxIterations: 3,
      strategy: "react-kernel",
      kernelType: "react",
      taskId: "gate-task",
    }),
    status: "acting",
    steps: [{ id: "thought-1" as StepId, type: "thought", content: "go", timestamp: new Date() }],
    meta: {
      pendingNativeToolCalls: pendingCalls,
      lastThought: "go",
      lastThinking: null,
      ...metaExtra,
    },
  };
}

function ctxWithPolicy(policy: KernelContext["input"]["approvalPolicy"]): KernelContext {
  const profile = CONTEXT_PROFILES["mid"];
  return {
    input: {
      task: "do the risky thing",
      availableToolSchemas: [{ name: "risky-tool", description: "risky", parameters: [] }],
      approvalPolicy: policy,
    } as KernelContext["input"],
    profile,
    compression: { budget: 800, previewItems: 3, autoStore: true, codeTransform: true },
    toolService: successToolService(),
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
  };
}

const pending = [{ id: "c1", name: "risky-tool", arguments: { input: "go" } }];

describe("durable HITL gate — handleActing", () => {
  it("detach mode pauses a gated call (terminatedBy=awaiting-approval, no execution)", async () => {
    const result = await Effect.runPromise(
      handleActing(
        baseState(pending),
        ctxWithPolicy({ mode: "detach", tools: new Set(["risky-tool"]) }),
      ).pipe(Effect.provide(TestLLMServiceLayer())),
    );
    expect(result.meta.terminatedBy).toBe("awaiting-approval");
    expect(result.meta.awaitingApprovalFor?.toolName).toBe("risky-tool");
    expect(result.meta.awaitingApprovalFor?.gateId).toBeTruthy();
    // The tool did NOT execute — no observation step was appended.
    expect(result.steps.some((s) => s.type === "observation")).toBe(false);
  });

  it("does NOT pause a non-gated call (tool executes normally)", async () => {
    const result = await Effect.runPromise(
      handleActing(
        baseState(pending),
        ctxWithPolicy({ mode: "detach", tools: new Set(["some-other-tool"]) }),
      ).pipe(Effect.provide(TestLLMServiceLayer())),
    );
    expect(result.meta.terminatedBy).not.toBe("awaiting-approval");
    expect(result.meta.awaitingApprovalFor).toBeUndefined();
    expect(result.steps.some((s) => s.type === "observation")).toBe(true);
  });

  it("block mode never pauses (handled in-process, not durable)", async () => {
    const result = await Effect.runPromise(
      handleActing(
        baseState(pending),
        ctxWithPolicy({ mode: "block", tools: new Set(["risky-tool"]) }),
      ).pipe(Effect.provide(TestLLMServiceLayer())),
    );
    expect(result.meta.terminatedBy).not.toBe("awaiting-approval");
    expect(result.steps.some((s) => s.type === "observation")).toBe(true);
  });

  it("approvalBypass lets an already-approved call execute without re-pausing", async () => {
    const result = await Effect.runPromise(
      handleActing(
        baseState(pending, { approvalBypass: true }),
        ctxWithPolicy({ mode: "detach", tools: new Set(["risky-tool"]) }),
      ).pipe(Effect.provide(TestLLMServiceLayer())),
    );
    expect(result.meta.terminatedBy).not.toBe("awaiting-approval");
    expect(result.steps.some((s) => s.type === "observation")).toBe(true);
  });
});
