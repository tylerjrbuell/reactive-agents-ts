// Run: bun test packages/reasoning/tests/kernel/act/batch-tool-policy.test.ts --timeout 15000
//
// Found in a framework quality audit (2026-07-26), confirmed live in current
// code (not stale): `act.ts` runs `evaluateToolPolicy` (allowedTools /
// forbiddenTools) on the batch LEADER only (`:365-380` — batch followers
// `continue` straight past it). Followers are re-collected in the
// `plannedBatch` loop (`:547+`), which DOES guard-check (`checkToolCall`) and
// DOES block-approval-check (`resolveBlockApproval`) every member, but never
// calls `evaluateToolPolicy` on them. A forbidden / non-allowlisted tool
// riding as a non-leader member of a `nextMovesPlanning` batch therefore
// executes uninspected — unless a human-approval gate happens to also cover
// it. Parallel batching is opt-in, which narrows exposure, but the hole is
// real: this test drives the actual kernel `act.ts` batch path (not a mock)
// and proves it.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
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

/** A ToolService that RECORDS every executed tool name, so a policy block is
 *  provable by absence (the tool never reached the service). */
function recordingToolService(executed: string[]): MaybeService<ToolServiceInstance> {
  return {
    _tag: "Some",
    value: {
      execute: (req) => {
        executed.push(req.toolName);
        return Effect.succeed({ success: true, result: { ok: req.toolName } });
      },
      getTool: () => Effect.fail(new Error("no schema")),
      listTools: () => Effect.succeed([]),
    },
  };
}

function baseState(pendingCalls: { id: string; name: string; arguments: Record<string, unknown> }[]): KernelState {
  return {
    ...initialKernelState({
      maxIterations: 3,
      strategy: "react-kernel",
      kernelType: "react",
      taskId: "batch-policy-task",
    }),
    status: "acting",
    steps: [
      { id: "thought-1" as StepId, type: "thought", content: "go", timestamp: new Date() },
    ],
    meta: {
      pendingNativeToolCalls: pendingCalls,
      lastThought: "go",
      lastThinking: null,
    },
  };
}

function baseContext(
  pipeline: HarnessPipeline,
  toolService: MaybeService<ToolServiceInstance>,
  allowedTools: readonly string[],
): KernelContext {
  const profile = CONTEXT_PROFILES["mid"];
  return {
    input: {
      task: "Gather data",
      availableToolSchemas: [
        { name: "http-get", description: "fetch a url", parameters: [] },
        { name: "web-search", description: "search the web", parameters: [] },
      ],
      harnessPipeline: pipeline,
      allowedTools,
      nextMovesPlanning: { enabled: true, allowParallelBatching: true, maxBatchSize: 3 },
    } as KernelContext["input"],
    profile,
    compression: {
      budget: profile.toolResultMaxChars ?? 800,
      previewItems: 3,
      autoStore: true,
      codeTransform: true,
    },
    toolService,
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
  };
}

function recordingPipeline(): HarnessPipeline {
  const rh = new RegistrationHarness();
  return new HarnessPipeline(rh._collected);
}

describe("kernel batch tool-policy gate — non-leader batch members", () => {
  it("BLOCKS a non-allowlisted tool riding as a non-leader batch member (was: executes uninspected)", async () => {
    const executed: string[] = [];
    const layer = TestLLMServiceLayer();

    await Effect.runPromise(
      handleActing(
        // Leader "http-get" IS allowed; follower "web-search" is NOT.
        baseState([
          { id: "leader", name: "http-get", arguments: { url: "https://x" } },
          { id: "follower", name: "web-search", arguments: { query: "btc" } },
        ]),
        baseContext(recordingPipeline(), recordingToolService(executed), ["http-get"]),
      ).pipe(Effect.provide(layer)),
    );

    // The allowed leader executes normally...
    expect(executed).toContain("http-get");
    // ...but the non-allowlisted follower must NEVER reach the ToolService.
    expect(executed).not.toContain("web-search");
  });

  it("control: BOTH members allowed → both execute (the gate isn't over-blocking)", async () => {
    const executed: string[] = [];
    const layer = TestLLMServiceLayer();

    await Effect.runPromise(
      handleActing(
        baseState([
          { id: "leader", name: "http-get", arguments: { url: "https://x" } },
          { id: "follower", name: "web-search", arguments: { query: "btc" } },
        ]),
        baseContext(recordingPipeline(), recordingToolService(executed), ["http-get", "web-search"]),
      ).pipe(Effect.provide(layer)),
    );

    expect(executed.sort()).toEqual(["http-get", "web-search"]);
  });
});
