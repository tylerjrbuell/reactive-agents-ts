// Run: bun test packages/cost/tests/complexity-router-jev-shadow.test.ts --timeout 15000
//
// Task 9b (shadow-only): the Jev tier classifier fires speculatively at
// complexity-router.ts's heuristicClassify call site but must NEVER alter
// the tier `analyzeComplexity` actually recommends. Covers: agreeing answer,
// disagreeing answer, Jev failure/timeout, and JudgmentService entirely
// absent — all four must leave `recommendedTier` identical to the
// heuristic-only baseline. Also confirms the `toolReliabilityThreshold` gate
// (FIX-32) is unaffected by shadow mode.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { analyzeComplexity, type RoutingContext } from "../src/routing/complexity-router.js";
import { EventBusLive, EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import { JudgmentService } from "@reactive-agents/judgment";
import type { JudgmentAnswers, JudgmentError } from "@reactive-agents/judgment";

type ShadowEvent = Extract<AgentEvent, { _tag: "JudgmentShadow" }>;

// "What is 2+2?" → heuristicClassify's simple-task rule → "haiku", deterministic.
const SIMPLE_TASK = "What is 2+2?";

const fakeJudgmentAnswering = (tierValue: string) =>
  Layer.succeed(JudgmentService, {
    ask: (input) =>
      Effect.succeed({
        tier: { kind: "choice", value: tierValue, probabilities: {}, confidence: 0.9, calibrated: true },
        "requires-code-execution": { kind: "noul", probability: 0.05 },
        "multi-step-analysis": { kind: "noul", probability: 0.05 },
      } as unknown as JudgmentAnswers<typeof input.questions>),
  } satisfies JudgmentService["Type"]);

const fakeJudgmentFailing = () =>
  Layer.succeed(JudgmentService, {
    ask: () =>
      Effect.fail({ _tag: "JudgmentTimeout", message: "shadow probe timed out", timeoutMs: 1 } as unknown as JudgmentError),
  } satisfies JudgmentService["Type"]);

const runWithShadowCapture = async (judgmentLayer?: Layer.Layer<JudgmentService>, routingContext?: RoutingContext) => {
  const captured: ShadowEvent[] = [];
  const baseLayer = judgmentLayer ? Layer.merge(EventBusLive, judgmentLayer) : EventBusLive;

  const analysis = await Effect.runPromise(
    Effect.gen(function* () {
      const eb = yield* EventBus;
      yield* eb.on("JudgmentShadow", (event) => Effect.sync(() => { captured.push(event); }));

      const result = yield* analyzeComplexity(SIMPLE_TASK, undefined, undefined, routingContext);

      // Cooperative yield so the forkDaemon shadow fiber (fake backend is
      // synchronous) settles before this Effect completes.
      yield* Effect.sleep("50 millis");

      return result;
    }).pipe(Effect.provide(baseLayer)),
  );

  return { analysis, captured };
};

describe("complexity-router Jev tier-classification shadow (Task 9b, shadow-only)", () => {
  it("agreeing Jev answer: shadow reports agreement:true, routing unchanged", async () => {
    const { analysis, captured } = await runWithShadowCapture(fakeJudgmentAnswering("haiku"));

    expect(analysis.recommendedTier).toBe("haiku");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.site).toBe("complexity-router");
    expect(captured[0]?.jev).toBe("haiku");
    expect(captured[0]?.current).toBe("haiku");
    expect(captured[0]?.agreement).toBe(true);
  }, 15000);

  it("disagreeing Jev answer: shadow reports agreement:false, routing STILL unchanged", async () => {
    const { analysis, captured } = await runWithShadowCapture(fakeJudgmentAnswering("opus"));

    expect(analysis.recommendedTier).toBe("haiku"); // heuristic's pick, not Jev's
    expect(captured).toHaveLength(1);
    expect(captured[0]?.jev).toBe("opus");
    expect(captured[0]?.current).toBe("haiku");
    expect(captured[0]?.agreement).toBe(false);
  }, 15000);

  it("Jev failure/timeout: shadow reports jev:null, agreement:null, routing untouched", async () => {
    const { analysis, captured } = await runWithShadowCapture(fakeJudgmentFailing());

    expect(analysis.recommendedTier).toBe("haiku");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.jev).toBeNull();
    expect(captured[0]?.agreement).toBeNull();
  }, 15000);

  it("JudgmentService entirely absent (no .withJudgment()): no crash, no shadow event, routing untouched", async () => {
    const { analysis, captured } = await runWithShadowCapture(undefined);

    expect(analysis.recommendedTier).toBe("haiku");
    expect(captured).toHaveLength(0);
  }, 15000);

  it("toolReliabilityThreshold gate (FIX-32) still fires identically in shadow mode", async () => {
    const routingContext: RoutingContext = {
      requiresTools: true,
      calibration: { haiku: { toolCallReliability: 0.2 } },
      toolReliabilityThreshold: 0.5,
    };
    const { analysis, captured } = await runWithShadowCapture(fakeJudgmentAnswering("haiku"), routingContext);

    // Escalated away from haiku (poor tool reliability) — shadow's `current`
    // must reflect the ESCALATED tier, not the raw heuristic pick.
    expect(analysis.recommendedTier).not.toBe("haiku");
    expect(analysis.factors.some((f) => f.startsWith("tool-reliability-escalation"))).toBe(true);
    expect(captured[0]?.current).toBe(analysis.recommendedTier);
  }, 15000);
});
