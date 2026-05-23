import { describe, it, expect } from "bun:test";
import { Effect, Layer, Data } from "effect";
import { LearningEngineService, LearningEngineServiceLive } from "../../src/learning/learning-engine.js";
import type { RunCompletedData } from "../../src/learning/learning-engine.js";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";

// HS-109 / R11 — skill persistence failures must not be silent.
//
// Pre-fix: `Effect.catchAll(skillStore.store(entry), emitErrorSwallowed)` only
// published a generic ErrorSwallowed event tagged with the upstream error's
// _tag. The skill name was lost; the site identifier was the only signal that
// this was a persistence failure (not a calibration write, memory flush, etc).
//
// Fix: failures emit a triple-surface signal —
//   1. console.warn so any process output captures it.
//   2. Effect.logWarning for structured logger consumers.
//   3. ErrorSwallowed tagged "SkillPersistenceFailed" with the failed skill
//      name in `message` so trace consumers can grep one canonical predicate.

class StoreFail extends Data.TaggedError("StoreFail")<{ readonly cause: string }> {}

const failingSkillStore = {
  store: () => Effect.fail(new StoreFail({ cause: "disk-full" })),
  recall: () => Effect.succeed([]),
  remove: () => Effect.succeed(undefined),
  // Other SkillStore methods stubbed for shape; not used by learning-engine.
} as any;

const mockCalibrationStore = new (await import("../../src/calibration/calibration-store.js")).CalibrationStore();
const mockBanditStore = new (await import("../../src/learning/bandit-store.js")).BanditStore();

const makeData = (overrides: Partial<RunCompletedData> = {}): RunCompletedData => ({
  // Use a non-test modelId so the test-guard short-circuit does not skip us.
  modelId: "claude-sonnet-4",
  provider: undefined,
  taskDescription: "Write a function that adds two numbers",
  strategy: "reactive",
  outcome: "success",
  // High-confidence, low-entropy history so skill synthesis fires.
  entropyHistory: [
    { composite: 0.15, trajectory: { shape: "converging" } },
    { composite: 0.10, trajectory: { shape: "converging" } },
    { composite: 0.08, trajectory: { shape: "converging" } },
  ],
  totalTokens: 250,
  durationMs: 1200,
  temperature: 0.4,
  maxIterations: 5,
  ...overrides,
});

describe("HS-109 — skill persistence failure surfaces a SkillPersistenceFailed signal", () => {
  it("publishes ErrorSwallowed tagged SkillPersistenceFailed when skillStore.store fails", async () => {
    const collected: AgentEvent[] = [];

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventBus = yield* EventBus;
        // Subscribe BEFORE running so we capture the swallow event.
        yield* eventBus.subscribe((e) => {
          collected.push(e);
          return Effect.void;
        });

        const engine = yield* LearningEngineService;
        return yield* engine.onRunCompleted(makeData());
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            LearningEngineServiceLive(mockCalibrationStore, mockBanditStore, failingSkillStore),
            EventBusLive,
          ),
        ),
      ),
    );

    // The learning step itself must still complete — failure is non-fatal.
    expect(result).toBeDefined();

    // The persistence failure must have surfaced a non-silent signal.
    const failureEvent = collected.find(
      (e): e is Extract<AgentEvent, { _tag: "ErrorSwallowed" }> =>
        e._tag === "ErrorSwallowed" && (e as any).tag === "SkillPersistenceFailed",
    );
    expect(failureEvent).toBeDefined();
    // The failed skill name must be preserved in the message so trace
    // consumers can attribute the failure without inspecting upstream context.
    expect(failureEvent!.message ?? "").toContain("skill=");
  });
});
