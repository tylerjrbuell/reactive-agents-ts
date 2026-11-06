// Run: bun test packages/reasoning/tests/kernel/seam-approval-reentry-failure.test.ts --timeout 20000
//
// Approval re-entry and the tool-failure streak (follow-up to a74c63128).
//
// The approved branch of `runApprovalResumeReentry` executes the stored call
// through `handleActing`, so its tool_result is built by
// act/conversation-assembly.ts — the site a74c63128 fixed. This pins that a
// FAILED approved-then-executed call reaches state.messages as `isError: true`
// (so reflect/tool-failure-streak.ts counts it).
//
// The denied branch is a human refusal, not a tool failure: it stays a plain
// tool_result, matching "refusals stay refused" (seam-refusal-not-failure).
//
// RED-ON-CUT (shown during the mission, then restored): drop the `isError`
// spread in act/conversation-assembly.ts → (a) fails (`isError` undefined).
import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { TextParseDriver } from "@reactive-agents/tools";
import { runApprovalResumeReentry } from "../../src/kernel/loop/runner-resume-reentry.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelState,
  type ToolServiceInstance,
} from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import type { StepId } from "../../src/types/step.js";

const GATE = { gateId: "gate-1", toolName: "risky-tool", args: { input: "go" } };

function failingToolService(): Option.Option<ToolServiceInstance> {
  return Option.some({
    execute: () => Effect.succeed({ success: false, result: "boom: disk full", error: "boom: disk full" }),
    getTool: () => Effect.fail({ _tag: "NoSchema" as const }),
    listTools: () => Effect.succeed([]),
  });
}

function pausedState(): KernelState {
  const base = initialKernelState({ maxIterations: 3, strategy: "react-kernel", kernelType: "react", taskId: "reentry-task" });
  return {
    ...base,
    status: "done",
    output: "Run paused — awaiting human approval.",
    steps: [{ id: "thought-1" as StepId, type: "thought", content: "go", timestamp: new Date() }],
    meta: {
      ...base.meta,
      terminatedBy: "awaiting-approval",
      awaitingApprovalFor: GATE,
      lastThought: "go",
      lastThinking: null,
    },
  };
}

const input = (status: "approved" | "denied"): KernelInput =>
  ({
    task: "do the risky thing",
    availableToolSchemas: [{ name: "risky-tool", description: "risky", parameters: [] }],
    approvalPolicy: { mode: "detach", tools: new Set(["risky-tool"]) },
    approvalDecision: { gateId: GATE.gateId, status },
  }) as KernelInput;

const ctx = (effectiveInput: KernelInput): KernelContext => ({
  input: effectiveInput,
  profile: CONTEXT_PROFILES["mid"],
  compression: { budget: 800, previewItems: 3, autoStore: true, codeTransform: true },
  toolService: failingToolService(),
  hooks: noopHooks,
  toolCallingDriver: new TextParseDriver(),
});

const reenter = (status: "approved" | "denied") => {
  const effectiveInput = input(status);
  return Effect.runPromise(
    runApprovalResumeReentry({ state: pausedState(), effectiveInput, currentContext: ctx(effectiveInput) }).pipe(
      Effect.provide(TestLLMServiceLayer()),
    ),
  );
};

describe("approval re-entry tool_result failure flag", () => {
  it("(a) a failed approved-then-executed call is an isError tool_result", async () => {
    const state = await reenter("approved");
    const results = state.messages.filter((m) => m.role === "tool_result");
    expect(results.length).toBe(1);
    expect(results[0]!.role === "tool_result" && results[0]!.isError).toBe(true);
  });

  it("(b) a human denial stays a plain tool_result (refusal, not failure)", async () => {
    const state = await reenter("denied");
    const results = state.messages.filter((m) => m.role === "tool_result");
    expect(results.length).toBe(1);
    expect(results[0]!.role === "tool_result" && results[0]!.isError).toBeFalsy();
    expect(results[0]!.content).toContain("denied by a human");
  });
});
