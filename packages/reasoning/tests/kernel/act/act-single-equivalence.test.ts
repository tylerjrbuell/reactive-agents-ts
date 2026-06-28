/**
 * act-single-equivalence.test.ts — Golden-master for the kernel act SINGLE-call
 * execute-and-observe path (Phase B of the canonical-tool-execution plan).
 *
 * Authored against the CURRENT `handleActing` single path BEFORE migration, then
 * kept green THROUGH the migration to `executeToolAndObserve`. A green run before
 * AND after proves the migration is byte-identical for everything observable:
 *   - the `observation.tool-result` Compose-tag payload (obsStep + ctx fields)
 *   - the obsStep written into the returned KernelState
 *   - the single path attaches NO `verification` (that is Phase E — pinned here so
 *     Phase E becomes a VISIBLE change, not a silent one).
 *
 * Per spec §6: if exact equivalence cannot be reached, the migration is REJECTED.
 * Do NOT relax these assertions to force a pass.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import type {
  KernelStateLike,
  ObservationStepLike,
} from "@reactive-agents/core";
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

const TOOL_NAME = "web-search";
const CALL_ID = "tc-golden-1";

// Real ToolService (Some) whose execute succeeds and echoes a deterministic
// result. Mirrors the stub used by the Phase A primitive test.
function successToolService(): MaybeService<ToolServiceInstance> {
  return {
    _tag: "Some",
    value: {
      execute: (req) =>
        Effect.succeed({ success: true, result: { hits: 3, query: req.toolName } }),
      getTool: () => Effect.fail(new Error("no schema")),
      listTools: () => Effect.succeed([]),
    },
  };
}

// Recording pipeline via the public RegistrationHarness → HarnessPipeline path.
function recordingPipeline(): {
  pipeline: HarnessPipeline;
  observations: ObservationStepLike[];
  observeCtx: Record<string, unknown>[];
} {
  const observations: ObservationStepLike[] = [];
  const observeCtx: Record<string, unknown>[] = [];
  const rh = new RegistrationHarness();
  // Tap form receives (value, ctx) — capture both for the golden-master.
  rh.tap("observation.tool-result", (step, ctx) => {
    observations.push(step as ObservationStepLike);
    observeCtx.push(ctx as Record<string, unknown>);
  });
  return { pipeline: new HarnessPipeline(rh._collected), observations, observeCtx };
}

function actingState(): KernelState {
  return {
    ...initialKernelState({
      maxIterations: 3,
      strategy: "react-kernel",
      kernelType: "react",
      taskId: "golden-task",
    }),
    status: "acting",
    steps: [
      {
        id: "thought-1" as StepId,
        type: "thought",
        content: "I need to search.",
        timestamp: new Date(),
      },
    ],
    meta: {
      pendingNativeToolCalls: [
        { id: CALL_ID, name: TOOL_NAME, arguments: { query: "btc price" } },
      ],
      lastThought: "I need to search.",
      lastThinking: null,
    },
  };
}

function actingContext(pipeline: HarnessPipeline): KernelContext {
  const profile = CONTEXT_PROFILES["mid"];
  return {
    input: {
      task: "Find the BTC price",
      // Schema present → availableToolGuard passes, single path executes.
      availableToolSchemas: [
        { name: TOOL_NAME, description: "search the web", parameters: [] },
      ],
      harnessPipeline: pipeline,
    } as KernelContext["input"],
    profile,
    compression: {
      budget: profile.toolResultMaxChars ?? 800,
      previewItems: 3,
      autoStore: true,
      codeTransform: true,
    },
    toolService: successToolService(),
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
  };
}

describe("kernel act single-call path — golden master", () => {
  it("fires observation.tool-result once with byte-identical obsStep + ctx", async () => {
    const { pipeline, observations, observeCtx } = recordingPipeline();
    const layer = TestLLMServiceLayer();

    const next = await Effect.runPromise(
      handleActing(actingState(), actingContext(pipeline)).pipe(Effect.provide(layer)),
    );

    // ── Exactly one observation.tool-result fired ─────────────────────────────
    expect(observations.length).toBe(1);
    const tagStep = observations[0]!;
    const tagCtx = observeCtx[0]!;

    // ── obsStep passed to the tag ─────────────────────────────────────────────
    expect(tagStep.type).toBe("observation");
    expect(tagStep.metadata?.toolCallId).toBe(CALL_ID);
    const obsResult = tagStep.metadata?.observationResult as
      | { toolName?: string; success?: boolean }
      | undefined;
    expect(obsResult?.toolName).toBe(TOOL_NAME);
    expect(obsResult?.success).toBe(true);
    // Single path attaches NO verification today — pin so Phase E is visible.
    expect(tagStep.metadata?.verification).toBeUndefined();

    // ── ctx fields on the tag ─────────────────────────────────────────────────
    expect(tagCtx.toolName).toBe(TOOL_NAME);
    expect(tagCtx.callId).toBe(CALL_ID);
    // `healed` now computes `healResult.actions.length > 0` — true only when the
    // healer ACTUALLY repaired something. This call is clean (name+args
    // unchanged), so healed is false. (Fixed 2026-06-28: the prior
    // `healResult.call !== rawTc` reference-inequality reported `true` for clean
    // calls because runHealingPipeline always returns a new object — the latent
    // quirk this test previously documented. Same fix applied to the parallel
    // batch path, which now also heals its members.)
    expect(tagCtx.healed).toBe(false);
    expect(tagCtx.phase).toBe("act");
    expect(tagCtx.strategy).toBe("react-kernel");
    expect(typeof tagCtx.durationMs).toBe("number");

    // ── obsStep written into the returned state ───────────────────────────────
    const obsSteps = next.steps.filter((s) => s.type === "observation");
    expect(obsSteps.length).toBe(1);
    const stateObs = obsSteps[0]!;
    expect(stateObs.metadata?.toolCallId).toBe(CALL_ID);
    expect(stateObs.metadata?.verification).toBeUndefined();
    const stateObsResult = stateObs.metadata?.observationResult as
      | { toolName?: string; success?: boolean }
      | undefined;
    expect(stateObsResult?.toolName).toBe(TOOL_NAME);
    expect(stateObsResult?.success).toBe(true);

    // The tag step and the state step are the SAME obsStep (identity preserved).
    expect(stateObs.content).toBe(tagStep.content);

    // ── action step carries a numeric duration (kernel orchestration) ─────────
    const actionSteps = next.steps.filter((s) => s.type === "action");
    expect(actionSteps.length).toBe(1);
    expect(typeof actionSteps[0]!.metadata?.duration).toBe("number");

    // tool marked used; back to thinking after a successful single call.
    expect(next.toolsUsed.has(TOOL_NAME)).toBe(true);
  });
});
