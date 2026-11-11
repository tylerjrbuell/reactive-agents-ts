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
import { Effect, Option } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { handleActing } from "../../../src/kernel/capabilities/act/act.js";
import { TextParseDriver } from "@reactive-agents/tools";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelState,
  type ToolServiceInstance,
} from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import type { StepId } from "../../../src/types/step.js";
import { RunEnvelope, buildRunEnvelope } from "../../../src/kernel/envelope/run-envelope.js";
import type { ResolvedApprovalPolicy } from "../../../src/kernel/capabilities/act/approval-gate.js";

function successToolService(): Option.Option<ToolServiceInstance> {
  return Option.some({
      execute: (req) => Effect.succeed({ success: true, result: { ok: req.toolName } }),
      getTool: () => Effect.fail(new Error("no schema")),
      listTools: () => Effect.succeed([]),
    });
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

/** A tool service that records every tool it actually executed. */
function countingToolService(executed: string[]): Option.Option<ToolServiceInstance> {
  const base = Option.getOrThrow(successToolService());
  return Option.some({
    ...base,
    execute: (req) => Effect.sync(() => { executed.push(req.toolName); return { success: true, result: { ok: req.toolName } }; }),
  });
}

function ctxWithPolicy(
  policy: KernelContext["input"]["approvalPolicy"],
  toolService: Option.Option<ToolServiceInstance> = successToolService(),
): KernelContext {
  const profile = CONTEXT_PROFILES["mid"];
  return {
    input: {
      task: "do the risky thing",
      availableToolSchemas: [
        { name: "risky-tool", description: "risky", parameters: [] },
        { name: "git-cli", description: "git", parameters: [] },
      ],
      approvalPolicy: policy,
    } as KernelContext["input"],
    profile,
    compression: { budget: 800, previewItems: 3, autoStore: true, codeTransform: true },
    toolService,
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
  };
}

const pending = [{ id: "c1", name: "risky-tool", arguments: { input: "go" } }];
const gitPush = [{ id: "c2", name: "git-cli", arguments: { command: "git push origin main" } }];

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

  it("detach mode pauses a shell call whose command matches a command rule", async () => {
    const result = await Effect.runPromise(
      handleActing(
        baseState(gitPush),
        ctxWithPolicy({ mode: "detach", tools: new Set<string>(), commands: ["git push"] }),
      ).pipe(Effect.provide(TestLLMServiceLayer())),
    );
    expect(result.meta.terminatedBy).toBe("awaiting-approval");
    expect(result.meta.awaitingApprovalFor?.toolName).toBe("git-cli");
    expect(result.meta.awaitingApprovalFor?.args).toEqual({ command: "git push origin main" });
    expect(result.steps.some((s) => s.type === "observation")).toBe(false);
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

// Block mode decides per call in process (tool-observe §1c), reading the
// ambient RunEnvelope. A command rule gates exactly the shell calls it names.
describe("block-mode approval — shell command rules (handleActing)", () => {
  const runBlock = (
    calls: typeof pending,
    policy: ResolvedApprovalPolicy,
    executed: string[],
  ) =>
    Effect.runPromise(
      handleActing(baseState(calls), ctxWithPolicy(policy, countingToolService(executed))).pipe(
        Effect.provideService(RunEnvelope, buildRunEnvelope({ approvalPolicy: policy })),
        Effect.provide(TestLLMServiceLayer()),
      ),
    );

  it("refuses a matched command when no decider is configured (deny-by-default, not executed)", async () => {
    const executed: string[] = [];
    const result = await runBlock(gitPush, { mode: "block", tools: new Set<string>(), commands: ["git push"] }, executed);
    expect(executed).toEqual([]);
    const obs = result.steps.filter((s) => s.type === "observation").map((s) => s.content).join("\n");
    expect(obs).toContain("no approval handler is configured");
  });

  it("runs a matched command once the decider approves", async () => {
    const executed: string[] = [];
    const seen: unknown[] = [];
    await runBlock(
      gitPush,
      {
        mode: "block",
        tools: new Set<string>(),
        commands: ["git push"],
        decide: ({ args }) => Effect.sync(() => { seen.push(args); return { approve: true }; }),
      },
      executed,
    );
    expect(seen).toEqual([{ command: "git push origin main" }]);
    expect(executed).toEqual(["git-cli"]);
  });

  it("runs a command no rule names without asking", async () => {
    const executed: string[] = [];
    const gitStatus = [{ id: "c3", name: "git-cli", arguments: { command: "git status" } }];
    await runBlock(gitStatus, { mode: "block", tools: new Set<string>(), commands: ["git push"] }, executed);
    expect(executed).toEqual(["git-cli"]);
  });

  it("leaves a non-shell tool unaffected", async () => {
    const executed: string[] = [];
    await runBlock(pending, { mode: "block", tools: new Set<string>(), commands: ["git push"] }, executed);
    expect(executed).toEqual(["risky-tool"]);
  });
});
