// Run: bun test packages/reasoning/src/strategies/tool-policy-ledger-boundary.mutation.test.ts --timeout 30000
//
// Debt-burndown B1 (register B1 + P0-4 + C8) — MUTATION TESTS for the
// `executeToolAndObserve` boundary. Two cross-cutting capabilities that the
// hand-rolled strategies (plan-execute / blueprint / inline) inherited NOTHING
// of are now enforced INSIDE the shared primitive:
//
//   1. Tool-policy gate (P0-4, SAFETY): a forbidden / non-allowed tool arriving
//      via a PLANNED step must be BLOCKED before dispatch. Previously the only
//      gate lived at act.ts:367 (kernel path only, allowedTools only) so a
//      planned step could execute a forbidden/hallucinated tool.
//   2. RunLedger tool-entry minting (C8): plan-execute produced NO RunLedger at
//      all (ReasoningResult carries none), so its tool-usage + deliverable
//      receipts were blind. The primitive now mints the canonical
//      tool-invocation + tool-result pair into a config-supplied sink, surfaced
//      on `result.metadata.runLedger`.
//
// These go RED when the boundary is cut:
//   - remove the policy gate from executeToolAndObserve → the forbidden tool
//     executes → the "blocked / not executed" assertions fail.
//   - remove the ledger mint from executeToolAndObserve → runLedger is empty →
//     the tool-invocation assertion fails.
// Keyless / deterministic (provider "test") — CI has no keys/Ollama/Docker.

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import type { KernelStateLike } from "@reactive-agents/core";
import type { TaskContract } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executePlanExecute } from "./plan-execute.js";
import { defaultReasoningConfig } from "../types/config.js";
import { mockToolServiceLayer } from "../testing/tool-service-mock.js";
import type { RunLedger } from "../kernel/ledger/run-ledger.js";
import { buildRunEnvelope, provideTestEnvelope } from "../kernel/envelope/run-envelope.js";
import { executeToolAndObserve } from "../kernel/capabilities/act/tool-observe.js";
import type { MaybeService, ToolServiceInstance } from "../kernel/state/kernel-state.js";

const GATHER_SCHEMA = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", required: true }],
};

// A single DIRECT tool_call plan step — routes through step-executor's direct
// dispatch (the canonical executeToolAndObserve primitive), the exact path the
// boundary owns. No composite/analysis sub-kernel involved.
const TOOL_PLAN = {
  steps: [
    {
      title: "Gather",
      instruction: "Gather the data with the gather tool.",
      type: "tool_call",
      toolName: "gather",
      toolArgs: { q: "topic" },
    },
  ],
};

const TASK = "Gather the data and report it.";

// Plan first (completeStructured), then every downstream call (reflect,
// synthesize) repeats the last turn — see resolveTurn's repeat-last behavior.
const scenario = () =>
  TestLLMServiceLayer([
    { json: TOOL_PLAN },
    { text: "SATISFIED: the data was gathered and reported." },
  ]);

/** A ToolService that RECORDS every executed tool name, so a policy block is
 *  provable by absence (the tool never reached the service). */
function recordingToolLayer(executed: string[]) {
  return mockToolServiceLayer({
    execute: (req) => {
      executed.push(req.toolName);
      return Effect.succeed({ success: true, result: { finding: "DATA-123 gathered" } });
    },
    getTool: (name: string) =>
      Effect.succeed({ name, description: "test", parameters: GATHER_SCHEMA.parameters }),
  });
}

const runPlanExecute = (
  executed: string[],
  extra: Record<string, unknown>,
) =>
  Effect.runPromise(
    executePlanExecute({
      taskDescription: TASK,
      taskType: "research",
      memoryContext: "",
      availableTools: ["gather"],
      availableToolSchemas: [GATHER_SCHEMA],
      config: defaultReasoningConfig,
      ...extra,
    } as never).pipe(
      Effect.provide(Layer.merge(scenario(), recordingToolLayer(executed))),
      provideTestEnvelope,
    ),
  );

describe("B1 boundary — tool-policy gate (P0-4) is enforced inside executeToolAndObserve", () => {
  it("BLOCKS a forbiddenTools planned tool: it is never executed and the run surfaces the block", async () => {
    const executed: string[] = [];
    const result = await runPlanExecute(executed, { forbiddenTools: ["gather"] });

    // The tool never reached the ToolService — the gate short-circuited dispatch.
    expect(executed).not.toContain("gather");
    // The block is surfaced on the run's steps (mutation: cut the gate → the
    // tool executes, `executed` contains "gather", and this block text vanishes).
    const stepText = result.steps.map((s) => s.content).join("\n");
    expect(stepText).toContain("forbidden by contract");
  });

  it("BLOCKS a non-allowedTools planned tool (allowedTools is a hard whitelist)", async () => {
    const executed: string[] = [];
    const result = await runPlanExecute(executed, { allowedTools: ["some-other-tool"] });

    expect(executed).not.toContain("gather");
    const stepText = result.steps.map((s) => s.content).join("\n");
    expect(stepText).toContain("not in allowedTools");
  });

  it("PERMITS an allowed tool through (control): it executes normally", async () => {
    const executed: string[] = [];
    await runPlanExecute(executed, { allowedTools: ["gather"] });
    expect(executed).toContain("gather");
  });
});

describe("B1 boundary — RunLedger tool-entry minting (C8) happens inside executeToolAndObserve", () => {
  it("MINTS the canonical tool-invocation + tool-result pair for a plan-execute dispatch", async () => {
    const executed: string[] = [];
    const result = await runPlanExecute(executed, {});

    // Sanity: the tool actually ran.
    expect(executed).toContain("gather");

    // The run now carries a RunLedger (plan-execute produced NONE before B1).
    const ledger = (result.metadata as { runLedger?: RunLedger }).runLedger;
    expect(ledger).toBeDefined();
    const invocations = (ledger ?? []).filter((e) => e.kind === "tool-invocation");
    const results = (ledger ?? []).filter((e) => e.kind === "tool-result");
    // Mutation: cut the mint from the primitive → runLedger is empty → red.
    expect(invocations.some((e) => "toolName" in e && e.toolName === "gather")).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });
});

// ─── Task 7 (cross-cutting cascade) — the SEAM derives policy from the ──────
// envelope's taskContract when the caller threads NO explicit policy. Drives
// `executeToolAndObserve` directly (not through a full strategy) so the
// caller-supplies-nothing case is reachable: every wired strategy
// (plan-execute.ts / code-action.ts / blueprint.ts) already pre-derives and
// always threads an explicit (possibly empty) forbiddenTools, which would mask
// this seam-level fallback. A hand-rolled or future caller that forgets to
// derive-and-thread the deny-list is exactly the gap this closes.
describe("Task 7 — executeToolAndObserve derives tool-policy from the envelope contract when unthreaded", () => {
  const syntheticState: KernelStateLike = {
    taskId: "t7",
    strategy: "test",
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

  const contractForbidding = (name: string): TaskContract => ({
    prompt: "task",
    tools: [{ kind: "forbidden", name }],
    success: { type: "regex", pattern: ".*" },
  });

  const makeToolService = (executed: string[]): MaybeService<ToolServiceInstance> => ({
    _tag: "Some",
    value: {
      execute: (input) => {
        executed.push(input.toolName);
        return Effect.succeed({ success: true, result: { ok: true } });
      },
      getTool: () => Effect.succeed({ parameters: [] }),
      listTools: () => Effect.succeed([]),
    },
  });

  const dispatch = (
    executed: string[],
    envelopeData: ReturnType<typeof buildRunEnvelope>,
    config: Record<string, unknown> = {},
  ) =>
    Effect.runPromise(
      provideTestEnvelope(
        executeToolAndObserve(
          makeToolService(executed),
          { toolName: "shell-execute", args: {} },
          {
            iteration: 0,
            phase: "act",
            strategy: "test",
            state: syntheticState,
            callId: "call-1",
          },
          config,
        ).pipe(Effect.provide(TestLLMServiceLayer())),
        envelopeData,
      ),
    );

  it("BLOCKS a tool the envelope's taskContract forbids when the caller passes NO explicit policy", async () => {
    const executed: string[] = [];
    const envelopeData = buildRunEnvelope({ taskContract: contractForbidding("shell-execute") });
    const result = await dispatch(executed, envelopeData);

    // Never reached the ToolService — the envelope-derived gate short-circuited.
    expect(executed).not.toContain("shell-execute");
    expect(result.success).toBe(false);
    expect(result.content).toContain("forbidden by contract");
  });

  it("an EXPLICIT (even permissive) config policy WINS over the envelope-derived deny-list", async () => {
    const executed: string[] = [];
    const envelopeData = buildRunEnvelope({ taskContract: contractForbidding("shell-execute") });
    // Explicit forbiddenTools:[] means "the caller decided nothing is forbidden" —
    // that decision must win over the contract's deny-list.
    const result = await dispatch(executed, envelopeData, { forbiddenTools: [] });

    expect(executed).toContain("shell-execute");
    expect(result.success).toBe(true);
  });

  it("no declared taskContract on the envelope: tool executes normally (byte-identical baseline)", async () => {
    const executed: string[] = [];
    const envelopeData = buildRunEnvelope();
    const result = await dispatch(executed, envelopeData);

    expect(executed).toContain("shell-execute");
    expect(result.success).toBe(true);
  });
});
