/**
 * approval-preflight.test.ts — a gated call its tool will refuse anyway is
 * never put to approval; the tool's own refusal returns as a failed observation.
 *
 * Drives `handleActing` (detach pause site + block-mode primitive) with a tool
 * service whose definition carries `preflight`.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { TextParseDriver } from "@reactive-agents/tools";
import { handleActing } from "../../../src/kernel/capabilities/act/act.js";
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

const REFUSAL = 'Command "gh" is not in the allowlist.';
type Call = { id: string; name: string; arguments: Record<string, unknown> };

/** `shell` refuses any command not starting with `ls`; `plain` has no preflight. */
function toolService(executed: string[], opts: { getToolFails?: boolean } = {}): Option.Option<ToolServiceInstance> {
  const preflight = (args: Record<string, unknown>): string | undefined =>
    String(args.command ?? "").startsWith("ls") ? undefined : REFUSAL;
  const withPreflight = new Set(["shell"]);
  return Option.some({
    execute: (req) => Effect.sync(() => {
      executed.push(`${req.toolName}:${String(req.arguments.command ?? "")}`);
      return { success: true, result: "ran" };
    }),
    getTool: (name) =>
      opts.getToolFails
        ? Effect.fail(new Error("boom"))
        : Effect.succeed({ parameters: [], ...(withPreflight.has(name) ? { preflight } : {}) }),
    listTools: () => Effect.succeed([]),
  });
}

const state = (calls: Call[]): KernelState => ({
  ...initialKernelState({ maxIterations: 3, strategy: "react-kernel", kernelType: "react", taskId: "pf-task" }),
  status: "acting",
  steps: [{ id: "thought-1" as StepId, type: "thought", content: "go", timestamp: new Date() }],
  meta: { pendingNativeToolCalls: calls, lastThought: "go", lastThinking: null },
});

const ctx = (policy: ResolvedApprovalPolicy, ts: Option.Option<ToolServiceInstance>): KernelContext => ({
  input: {
    task: "t",
    availableToolSchemas: [
      { name: "shell", description: "shell", parameters: [] },
      { name: "plain", description: "plain", parameters: [] },
    ],
    approvalPolicy: policy,
  } as KernelContext["input"],
  profile: CONTEXT_PROFILES["mid"],
  compression: { budget: 800, previewItems: 3, autoStore: true, codeTransform: true },
  toolService: ts,
  hooks: noopHooks,
  toolCallingDriver: new TextParseDriver(),
});

const run = (calls: Call[], policy: ResolvedApprovalPolicy, ts: Option.Option<ToolServiceInstance>) =>
  Effect.runPromise(
    handleActing(state(calls), ctx(policy, ts)).pipe(
      Effect.provideService(RunEnvelope, buildRunEnvelope({ approvalPolicy: policy })),
      Effect.provide(TestLLMServiceLayer()),
    ),
  );

const gh: Call = { id: "c1", name: "shell", arguments: { command: "gh --version" } };
const ls: Call = { id: "c2", name: "shell", arguments: { command: "ls" } };
const plain: Call = { id: "c3", name: "plain", arguments: { command: "x" } };

const observations = (s: KernelState) => s.steps.filter((x) => x.type === "observation");

describe("approval preflight — detach mode", () => {
  const policy: ResolvedApprovalPolicy = { mode: "detach", tools: new Set(["shell", "plain"]) };

  it("refused call: no pause, no execution, refusal observed as a failed tool call", async () => {
    const executed: string[] = [];
    const out = await run([gh], policy, toolService(executed));
    expect(out.meta.terminatedBy).not.toBe("awaiting-approval");
    expect(out.meta.awaitingApprovalFor).toBeUndefined();
    expect(executed).toEqual([]);
    const obs = observations(out);
    expect(obs).toHaveLength(1);
    expect(obs[0]!.content).toBe(REFUSAL);
    expect(obs[0]!.metadata?.observationResult?.success).toBe(false);
  });

  it("allowed call still pauses for approval", async () => {
    const out = await run([ls], policy, toolService([]));
    expect(out.meta.terminatedBy).toBe("awaiting-approval");
    expect(out.meta.awaitingApprovalFor?.args).toEqual({ command: "ls" });
  });

  it("tool without preflight is unchanged: pauses", async () => {
    const out = await run([plain], policy, toolService([]));
    expect(out.meta.terminatedBy).toBe("awaiting-approval");
    expect(out.meta.awaitingApprovalFor?.toolName).toBe("plain");
  });

  it("batch: the refused call is skipped, the allowed call is the one that pauses", async () => {
    const out = await run([gh, ls], policy, toolService([]));
    expect(out.meta.terminatedBy).toBe("awaiting-approval");
    expect(out.meta.awaitingApprovalFor?.args).toEqual({ command: "ls" });
  });

  it("a failing getTool lookup proceeds to approval (execution stays the authority)", async () => {
    const out = await run([gh], policy, toolService([], { getToolFails: true }));
    expect(out.meta.terminatedBy).toBe("awaiting-approval");
  });
});

describe("approval preflight — block mode", () => {
  const decisions: string[] = [];
  const policy = (): ResolvedApprovalPolicy => ({
    mode: "block",
    tools: new Set(["shell", "plain"]),
    decide: ({ args }) => Effect.sync(() => {
      decisions.push(String((args as Record<string, unknown>).command));
      return { approve: true };
    }),
  });

  it("refused call: decider never asked, tool not run, refusal observed as failed", async () => {
    decisions.length = 0;
    const executed: string[] = [];
    const out = await run([gh], policy(), toolService(executed));
    expect(decisions).toEqual([]);
    expect(executed).toEqual([]);
    const obs = observations(out);
    expect(obs[0]!.content).toBe(REFUSAL);
    expect(obs[0]!.metadata?.observationResult?.success).toBe(false);
  });

  it("allowed call is still put to the decider, then runs", async () => {
    decisions.length = 0;
    const executed: string[] = [];
    await run([ls], policy(), toolService(executed));
    expect(decisions).toEqual(["ls"]);
    expect(executed).toEqual(["shell:ls"]);
  });

  it("tool without preflight is unchanged: asked, then runs", async () => {
    decisions.length = 0;
    const executed: string[] = [];
    await run([plain], policy(), toolService(executed));
    expect(decisions).toEqual(["x"]);
    expect(executed).toEqual(["plain:x"]);
  });

  it("batch: only the allowed call reaches the decider and the tool", async () => {
    decisions.length = 0;
    const executed: string[] = [];
    const out = await run([gh, ls], policy(), toolService(executed));
    expect(decisions).toEqual(["ls"]);
    expect(executed).toEqual(["shell:ls"]);
    expect(observations(out).map((o) => o.content)).toContain(REFUSAL);
  });
});
