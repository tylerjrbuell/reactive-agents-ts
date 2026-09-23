// Run: bun test packages/reasoning/tests/kernel/capabilities/verify/grounding-fabrication-judgment-shadow.test.ts --timeout 15000
//
// Task 3 (Phase D leverage plan, shadow-only): the grounding-fabrication Noul
// fires alongside the existing deterministic content-containment check
// (`evaluateUnconsumedEvidenceGrounding` / `assembleDeliverable`,
// runner-helpers/deliverable.ts) but must NEVER alter that heuristic verdict
// or which deliverable source `assembleDeliverable` picks. Covers: agreeing
// judgment, disagreeing judgment (including the adversarial direction -- a
// judge flagging fabrication where the substring heuristic passed), backend
// failure/timeout, JudgmentService entirely absent, and the from-state
// wrapper skipping entirely when the containment check never ran.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import { JudgmentService } from "@reactive-agents/judgment";
import type { JudgmentAnswers, JudgmentError } from "@reactive-agents/judgment";
import {
  judgmentGroundingFabricationShadow,
  judgmentGroundingFabricationShadowFromState,
  type GroundingFabricationJudgmentShadowInput,
} from "../../../../src/kernel/capabilities/verify/grounding-fabrication-judgment-shadow.js";
import { initialKernelState, transitionState } from "../../../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../../../src/kernel/utils/observation-helpers.js";
import { MIN_MODEL_SYNTHESIS_LENGTH } from "../../../../src/kernel/loop/runner-helpers/deliverable.js";

type ShadowEvent = Extract<AgentEvent, { _tag: "JudgmentShadow" }>;

const baseInput: GroundingFabricationJudgmentShadowInput = {
  claim: "The measurement was 42 units, taken directly from the sensor log.",
  evidence: "sensor log: reading = 42 units at t=0",
  heuristicGrounded: true,
};

const fakeJudgmentAnswering = (probability: number) =>
  Layer.succeed(JudgmentService, {
    ask: (input) =>
      Effect.succeed({
        "grounding-fabrication": { kind: "noul", probability },
      } as unknown as JudgmentAnswers<typeof input.questions>),
    listModels: () => Effect.succeed([]),
  } satisfies JudgmentService["Type"]);

const fakeJudgmentFailing = () =>
  Layer.succeed(JudgmentService, {
    ask: () =>
      Effect.fail({ _tag: "JudgmentTimeout", message: "shadow probe timed out", timeoutMs: 1 } as unknown as JudgmentError),
    listModels: () => Effect.succeed([]),
  } satisfies JudgmentService["Type"]);

/** Runs the given shadow effect, capturing any grounding-fabrication JudgmentShadow event. */
const runWithShadowCapture = async (
  run: Effect.Effect<void, never, JudgmentService | EventBus>,
  judgmentLayer?: Layer.Layer<JudgmentService>,
) => {
  const captured: ShadowEvent[] = [];
  const baseLayer = judgmentLayer ? Layer.merge(EventBusLive, judgmentLayer) : EventBusLive;

  await Effect.runPromise(
    Effect.gen(function* () {
      const eb = yield* EventBus;
      yield* eb.on("JudgmentShadow", (event) =>
        Effect.sync(() => {
          if (event.site === "grounding-fabrication") captured.push(event);
        }),
      );

      yield* run;

      // Cooperatively yield so the forkDaemon shadow fiber (fake backend is
      // synchronous) settles before this Effect completes and the fake
      // EventBus subscription goes out of scope.
      yield* Effect.sleep("50 millis");
    }).pipe(Effect.provide(baseLayer)),
  );

  return captured;
};

describe("grounding-fabrication judgment shadow (Task 3, shadow-only)", () => {
  it("agreeing judgment answer: shadow reports agreement:true", async () => {
    const captured = await runWithShadowCapture(
      judgmentGroundingFabricationShadow(baseInput),
      fakeJudgmentAnswering(0.9),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.site).toBe("grounding-fabrication");
    expect(captured[0]?.judged).toBe("true");
    expect(captured[0]?.current).toBe("true");
    expect(captured[0]?.agreement).toBe(true);
  }, 15000);

  it("disagreeing judgment answer (judge calls a heuristic PASS a fabrication): agreement:false", async () => {
    // Adversarial case per the plan: the heuristic says grounded (a substring
    // match passed), but the judge disagrees -- the failure mode that matters
    // most for this site (a false negative the substring check could miss,
    // e.g. cherry-picked or out-of-context verbatim quoting).
    const captured = await runWithShadowCapture(
      judgmentGroundingFabricationShadow({ ...baseInput, heuristicGrounded: true }),
      fakeJudgmentAnswering(0.05),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.judged).toBe("false");
    expect(captured[0]?.current).toBe("true");
    expect(captured[0]?.agreement).toBe(false);
  }, 15000);

  it("disagreeing judgment answer on a heuristic REJECT: agreement:false, judge more lenient", async () => {
    const captured = await runWithShadowCapture(
      judgmentGroundingFabricationShadow({ ...baseInput, heuristicGrounded: false }),
      fakeJudgmentAnswering(0.95),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.judged).toBe("true");
    expect(captured[0]?.current).toBe("false");
    expect(captured[0]?.agreement).toBe(false);
  }, 15000);

  it("judgment backend failure/timeout: judged:null, agreement:null", async () => {
    const captured = await runWithShadowCapture(
      judgmentGroundingFabricationShadow(baseInput),
      fakeJudgmentFailing(),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.judged).toBeNull();
    expect(captured[0]?.agreement).toBeNull();
  }, 15000);

  it("JudgmentService entirely absent (no .withJudgment()): no crash, no shadow event", async () => {
    const captured = await runWithShadowCapture(judgmentGroundingFabricationShadow(baseInput), undefined);
    expect(captured).toHaveLength(0);
  }, 15000);
});

describe("judgmentGroundingFabricationShadowFromState (wiring wrapper)", () => {
  const base = () =>
    initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 10 });
  const longThought = (content: string) => content.padEnd(MIN_MODEL_SYNTHESIS_LENGTH, ".");

  it("no unconsumed evidence at all: no shadow event, JudgmentService never consulted", async () => {
    const captured = await runWithShadowCapture(
      judgmentGroundingFabricationShadowFromState(base()),
      fakeJudgmentAnswering(0.9),
    );
    expect(captured).toHaveLength(0);
  }, 15000);

  it("unconsumed evidence + qualifying ungrounded thought: fires with current:false", async () => {
    const obs = makeStep("observation", "result body", {
      storedKey: "k1",
      observationResult: makeObservationResult("web-search", true, "result body"),
    });
    const thought = makeStep("thought", longThought("A totally unrelated synthesis"));
    let s = transitionState(base(), { steps: [obs, thought] });
    s = { ...s, scratchpad: new Map([["k1", "the stored evidence text 99"]]) };

    const captured = await runWithShadowCapture(
      judgmentGroundingFabricationShadowFromState(s),
      fakeJudgmentAnswering(0.9),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.current).toBe("false");
    expect(captured[0]?.judged).toBe("true");
    expect(captured[0]?.agreement).toBe(false);
  }, 15000);

  it("final review #2: unbounded scratchpad evidence is truncated before reaching the judgment prompt", async () => {
    // resolveUnconsumedEvidence joins full, uncompressed scratchpad payloads
    // with no cap of its own — a single stored payload well over the shared
    // judgment-text budget must not reach the backend unbounded.
    const hugeEvidence = "measured value: 42 units. ".repeat(200); // > 5000 chars
    const obs = makeStep("observation", "result body", {
      storedKey: "k1",
      observationResult: makeObservationResult("web-search", true, "result body"),
    });
    const thought = makeStep("thought", longThought("A totally unrelated synthesis"));
    let s = transitionState(base(), { steps: [obs, thought] });
    s = { ...s, scratchpad: new Map([["k1", hugeEvidence]]) };

    const captured: { state: unknown }[] = [];
    const capturingJudgment = Layer.succeed(JudgmentService, {
      ask: (input) => {
        captured.push({ state: input.state });
        return Effect.succeed({
          "grounding-fabrication": { kind: "noul", probability: 0.5 },
        } as unknown as JudgmentAnswers<typeof input.questions>);
      },
    } satisfies JudgmentService["Type"]);

    await Effect.runPromise(
      judgmentGroundingFabricationShadowFromState(s).pipe(
        Effect.provide(Layer.merge(EventBusLive, capturingJudgment)),
        Effect.flatMap(() => Effect.sleep("50 millis")),
      ),
    );

    expect(captured).toHaveLength(1);
    const entry = captured[0]?.state as { evidence?: string };
    expect(entry.evidence?.length ?? 0).toBeLessThan(hugeEvidence.length);
    expect(entry.evidence).toContain("truncated");
  }, 15000);

  it("unconsumed evidence + thought verbatim-contains it: fires with current:true, adversarial disagreement possible", async () => {
    const evidenceText = "exact measured value: 123.45 kg";
    const obs = makeStep("observation", "result body", {
      storedKey: "k1",
      observationResult: makeObservationResult("web-search", true, "result body"),
    });
    const thought = makeStep(
      "thought",
      longThought(`Synthesis quoting the evidence: ${evidenceText} and nothing else`),
    );
    let s = transitionState(base(), { steps: [obs, thought] });
    s = { ...s, scratchpad: new Map([["k1", evidenceText]]) };

    // Judge disagrees with the heuristic PASS -- flags it as unsupported
    // despite the verbatim substring match (e.g. the number is quoted out of
    // its original qualifying context). This is the false-negative direction
    // the plan calls out as the failure mode that matters most for this site.
    const captured = await runWithShadowCapture(
      judgmentGroundingFabricationShadowFromState(s),
      fakeJudgmentAnswering(0.1),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.current).toBe("true");
    expect(captured[0]?.judged).toBe("false");
    expect(captured[0]?.agreement).toBe(false);
  }, 15000);
});
