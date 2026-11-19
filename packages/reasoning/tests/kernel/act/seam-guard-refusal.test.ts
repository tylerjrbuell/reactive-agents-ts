// Run: bun test packages/reasoning/tests/kernel/act/seam-guard-refusal.test.ts --timeout 15000
//
// H3 2026-11-19 F4: a repetitionGuard block emitted no guard-fired event, so the
// instrument (trace `mechanismActivity`, key `guard:<guard>:<outcome>`) read a
// default-on guard as firing in 0/60 runs. Every act-phase guard refusal now
// emits one guard-fired event through `refuseGuardedCall`, the same shape the
// think-phase tool gate emits. These tests drive the real `act.ts` paths.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { EventBus, EventBusLive, HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { TextParseDriver, type ToolCallSpec } from "@reactive-agents/tools";
import { handleActing } from "../../../src/kernel/capabilities/act/act.js";
import { repetitionGuard } from "../../../src/kernel/capabilities/act/guard.js";
import { UNNAMED_GUARD, refuseGuardedCall } from "../../../src/kernel/capabilities/act/guard-refusal.js";
import { makeStep } from "../../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../../src/kernel/utils/observation-helpers.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelState,
  type ToolServiceInstance,
} from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import type { ReasoningStep } from "../../../src/types/index.js";
import { withEvidence } from "../tool-evidence-fixture.js";

const METRICS = "umami/get_website_metrics";

let seq = 0;
const call = (args: Record<string, unknown>): ToolCallSpec => {
  seq += 1;
  return { id: `c${seq}`, name: METRICS, arguments: args };
};

const ran = (tc: ToolCallSpec, result: string): ReasoningStep[] => [
  makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, { toolCall: tc }),
  makeStep("observation", result, { toolCallId: tc.id, observationResult: makeObservationResult(tc.name, true, result) }),
];

// Four prior calls whose last two results repeat earlier ones: the 5th is a repetition block.
const priorSteps = (): ReasoningStep[] => [
  ...ran(call({ type: "url" }), "rows: /a 10, /b 5"),
  ...ran(call({ type: "referrer" }), "rows: google 9"),
  ...ran(call({ type: "country" }), "rows: /a 10, /b 5"),
  ...ran(call({ type: "browser" }), "rows: google 9"),
];

function stateWith(steps: ReasoningStep[], pending: readonly ToolCallSpec[]): KernelState {
  const base = initialKernelState({ maxIterations: 20, strategy: "react-kernel", kernelType: "react", taskId: "guard-refusal" });
  return withEvidence({
    ...base,
    status: "acting",
    steps,
    meta: { ...base.meta, pendingNativeToolCalls: [...pending], lastThought: "go", lastThinking: null },
  } as KernelState);
}

function context(): KernelContext {
  const profile = CONTEXT_PROFILES["mid"];
  const toolService: Option.Option<ToolServiceInstance> = Option.some({
    execute: () => Effect.succeed({ success: true, result: "rows: new" }),
    getTool: () => Effect.fail(new Error("no schema")),
    listTools: () => Effect.succeed([]),
  });
  return {
    input: {
      task: "Report the website metrics",
      availableToolSchemas: [{ name: METRICS, description: "metrics", parameters: [] }],
      harnessPipeline: new HarnessPipeline(new RegistrationHarness()._collected),
      requiredToolQuantities: {},
      nextMovesPlanning: { maxBatchSize: 4 },
    } as KernelContext["input"],
    profile,
    compression: { budget: profile.toolResultMaxChars ?? 800, previewItems: 3, autoStore: true, codeTransform: true },
    toolService,
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
  };
}

type Fired = { guard: string; outcome: string; reason: string; metadata?: Record<string, unknown> };

const capture = <A>(program: Effect.Effect<A, never, never>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fired: Fired[] = [];
      const bus = yield* EventBus;
      yield* bus.on("GuardFiredEmitted", (e) =>
        Effect.sync(() => void fired.push({ guard: e.guard, outcome: e.outcome, reason: e.reason, metadata: e.metadata })));
      const value = yield* program;
      return { value, fired };
    }).pipe(Effect.provide(EventBusLive)),
  );

describe("act-phase guard refusals emit guard-fired", () => {
  it("repetitionGuard names itself on a block", () => {
    const outcome = repetitionGuard(call({ type: "os" }), stateWith(priorSteps(), []), context().input as KernelInput);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) expect(outcome.guard).toBe("repetition_guard");
  });

  it("a repetitionGuard block in act emits guard-fired{repetition_guard, block}", async () => {
    const tc = call({ type: "os" });
    const { value: state, fired } = await capture(
      handleActing(stateWith(priorSteps(), [tc]), context()).pipe(Effect.provide(TestLLMServiceLayer())),
    );
    const blocks = fired.filter((f) => f.guard === "repetition_guard");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ outcome: "block", metadata: { toolName: METRICS, toolCallId: tc.id } });
    expect(blocks[0]!.reason).toContain("Stop repeating this tool.");
    // The refusal still answers the call with the guard's text.
    const obs = state.steps.find((s) => s.type === "observation" && s.metadata?.toolCallId === tc.id);
    expect(obs?.content).toBe(blocks[0]!.reason);
  });

  it("a refusal from an unnamed (custom) guard emits under the fallback name", async () => {
    const tc = call({ type: "os" });
    const { value: pair, fired } = await capture(
      refuseGuardedCall(stateWith([], []), [], tc, { observation: "custom refusal" }, noopHooks),
    );
    expect(fired).toEqual([
      { guard: UNNAMED_GUARD, outcome: "block", reason: "custom refusal", metadata: { toolName: METRICS, toolCallId: tc.id } },
    ]);
    expect(pair[0].type).toBe("action");
    expect(pair[1].content).toBe("custom refusal");
    expect(pair[1].metadata?.observationResult?.success).toBe(true);
  });
});
