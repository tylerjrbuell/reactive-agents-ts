// Run: bun test packages/reasoning/tests/kernel/capabilities/reflect/reactive-observer-error-swallowed.test.ts --timeout 15000
//
// Issue #223 — silent entropy-scoring / publish failures in runReactiveObserver
// degraded the Reactive Controller and calibration/drift detection with no
// diagnostic trail. Every bare `Effect.catchAll(() => Effect.void)` in
// reactive-observer.ts is now wired through `emitErrorSwallowed`, which
// publishes an `ErrorSwallowed` event to the ambient EventBus.
//
// These tests pin the two representative failure classes:
//   (a) an entropy-scoring failure (the line-170 `.catchAll`),
//   (b) a publish failure on the observer's own EventBus handle (same catchAll),
// proving both are now observable rather than silently discarded.
import { describe, it, expect } from "bun:test";
import { Effect, Option, Ref } from "effect";
import {
  EventBus,
  EventBusLive,
  type AgentEvent,
  type EntropySensorService,
} from "@reactive-agents/core";
import { runReactiveObserver } from "../../../../src/kernel/capabilities/reflect/reactive-observer.js";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import {
  initialKernelState,
  transitionState,
} from "../../../../src/kernel/state/kernel-state.js";
import type {
  EventBusInstance,
  KernelRunOptions,
  KernelState,
} from "../../../../src/kernel/state/kernel-state.js";
import type { StrategyServices } from "../../../../src/kernel/utils/service-utils.js";

const entropyScore = {
  composite: 0.5,
  sources: { token: 0.3, structural: 0.4, semantic: 0.5, behavioral: 0.7, contextPressure: 0.1 },
  trajectory: { derivative: 0, shape: "flat" as const, momentum: 0 },
  confidence: "medium" as const,
  modelTier: "local" as const,
  iteration: 3,
  iterationWeight: 0.8,
  timestamp: Date.now(),
};

const calibration = {
  modelId: "test-model",
  calibrated: true,
  sampleCount: 25,
  highEntropyThreshold: 0.72,
  convergenceThreshold: 0.35,
  driftDetected: false,
};

/**
 * A fully-typed `EntropySensorService` double. Every required method is filled
 * with a stub so the fixture satisfies the service contract without a cast;
 * callers supply only the `score` implementation under test.
 */
const makeEntropySensor = (
  score: EntropySensorService["Type"]["score"],
): EntropySensorService["Type"] => ({
  score,
  scoreContext: () =>
    Effect.succeed({
      utilizationPct: 0.5,
      sections: [],
      atRiskSections: [],
      compressionHeadroom: 0.5,
    }),
  getCalibration: () => Effect.succeed(calibration),
  updateCalibration: () => Effect.succeed(calibration),
  getTrajectory: () =>
    Effect.succeed({
      history: [],
      derivative: 0,
      momentum: 0,
      shape: "insufficient-data",
    }),
});

/**
 * A fully-typed `StrategyServices` bundle. The kernel only reads
 * `entropySensor` / `reactiveController` / `dispatcher` / `toolService` in this
 * path; the remaining slots are `Option.none()`. `llm` is the one field the
 * structural type cannot satisfy from a stub, so it is the same `{} as never`
 * placeholder `kernel-loop-signal-wiring.test.ts` uses.
 */
const makeServices = (
  entropySensor: Option.Option<EntropySensorService["Type"]>,
): StrategyServices => ({
  llm: {} as never,
  toolService: Option.none(),
  promptService: Option.none(),
  eventBus: Option.none(),
  entropySensor,
  reactiveController: Option.none(),
  dispatcher: Option.none(),
  memoryService: Option.none(),
});

const options: KernelRunOptions = {
  maxIterations: 10,
  strategy: "reactive",
  kernelType: "react",
  modelId: "test-model",
};

/** A real kernel state built through the canonical factory + transition. */
function makeKernelState(): KernelState {
  return transitionState(initialKernelState(options), {
    steps: [makeStep("thought", "A thought whose scoring may fail")],
    iteration: 4,
  });
}

/**
 * Runs runReactiveObserver with EventBusLive provided and returns every event
 * published to the ambient bus during the run.
 */
const runAndCapture = async (
  services: StrategyServices,
  eventBus: Option.Option<EventBusInstance>,
): Promise<readonly AgentEvent[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sink = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(sink, (xs) => [...xs, ev]));

      yield* runReactiveObserver(makeKernelState(), services, eventBus, 0, options, "local");

      return yield* Ref.get(sink);
    }).pipe(Effect.provide(EventBusLive)),
  );

/** All ErrorSwallowed events in a capture, narrowed. */
const swallowed = (events: readonly AgentEvent[]) =>
  events.filter(
    (e): e is Extract<AgentEvent, { _tag: "ErrorSwallowed" }> => e._tag === "ErrorSwallowed",
  );

describe("reactive-observer error-swallowed wiring (#223)", () => {
  it("publishes ErrorSwallowed when entropy scoring fails", async () => {
    const services = makeServices(
      Option.some(makeEntropySensor(() => Effect.fail({ _tag: "EntropyBoom" }) as never)),
    );

    const events = await runAndCapture(services, Option.none());
    const found = swallowed(events);

    expect(found.length).toBeGreaterThanOrEqual(1);
    const site = found[0]!.site;
    expect(site).toContain("reactive-observer.ts");
    expect(site).toBe("reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:170");
    expect(found[0]!.tag).toBe("EntropyBoom");
  }, 15000);

  it("publishes ErrorSwallowed when the observer's own event publish fails", async () => {
    const services = makeServices(
      Option.some(makeEntropySensor(() => Effect.succeed(entropyScore))),
    );

    const failingBus = Option.some({
      publish: () => Effect.fail({ _tag: "PublishBoom" }),
    });

    const events = await runAndCapture(services, failingBus);
    const found = swallowed(events);

    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0]!.site).toBe(
      "reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:170",
    );
    expect(found[0]!.tag).toBe("PublishBoom");
  }, 15000);
});
