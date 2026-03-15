import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EntropySensorService } from "@reactive-agents/core";
import { EventBusLive } from "@reactive-agents/core";
import { subscribeEntropyScoring } from "../../src/sensor/entropy-event-subscriber.js";
import { createReactiveIntelligenceLayer } from "../../src/runtime.js";

describe("EntropyEventSubscriber", () => {
  // Compose a test layer with both EventBus and EntropySensorService
  const riLayer = createReactiveIntelligenceLayer();
  const testLayer = Layer.merge(EventBusLive, riLayer);

  test("scores ReasoningStepCompleted events with thoughts", async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus;

      // Register the entropy event subscriber
      yield* subscribeEntropyScoring({ modelId: "test-model", maxIterations: 10 });

      // Collect EntropyScored events
      const scored: { composite: number; iteration: number }[] = [];
      yield* eventBus.on("EntropyScored", (event) =>
        Effect.sync(() => {
          scored.push({ composite: event.composite, iteration: event.iteration });
        }),
      );

      // Publish a ReasoningStepCompleted event with a thought
      yield* eventBus.publish({
        _tag: "ReasoningStepCompleted",
        taskId: "test-task-1",
        strategy: "plan-execute-reflect",
        step: 1,
        totalSteps: 5,
        thought: "I need to analyze the data and find patterns in the user behavior logs.",
      });

      // Allow event propagation
      yield* Effect.sleep("10 millis");

      expect(scored.length).toBe(1);
      expect(scored[0]!.iteration).toBe(1);
      expect(scored[0]!.composite).toBeGreaterThanOrEqual(0);
      expect(scored[0]!.composite).toBeLessThanOrEqual(1);
    });

    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
  });

  test("ignores events without a thought field", async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus;
      yield* subscribeEntropyScoring({ maxIterations: 10 });

      const scored: unknown[] = [];
      yield* eventBus.on("EntropyScored", (event) =>
        Effect.sync(() => { scored.push(event); }),
      );

      // Publish event with only action (no thought)
      yield* eventBus.publish({
        _tag: "ReasoningStepCompleted",
        taskId: "test-task-2",
        strategy: "plan-execute-reflect",
        step: 1,
        totalSteps: 3,
        action: '[STEP 1/3] s1: Fetch data (tool_call → web-search)',
      });

      yield* Effect.sleep("10 millis");

      expect(scored.length).toBe(0);
    });

    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
  });

  test("deduplicates same (taskId, step) pair", async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus;
      yield* subscribeEntropyScoring({ maxIterations: 10 });

      const scored: unknown[] = [];
      yield* eventBus.on("EntropyScored", (event) =>
        Effect.sync(() => { scored.push(event); }),
      );

      // Publish same step twice
      const event = {
        _tag: "ReasoningStepCompleted" as const,
        taskId: "test-task-3",
        strategy: "reactive" as const,
        step: 2,
        totalSteps: 10,
        thought: "Let me search for the answer to this question.",
      };

      yield* eventBus.publish(event);
      yield* Effect.sleep("10 millis");
      yield* eventBus.publish(event);
      yield* Effect.sleep("10 millis");

      expect(scored.length).toBe(1);
    });

    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
  });

  test("tracks per-task state across multiple steps", async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus;
      yield* subscribeEntropyScoring({ maxIterations: 10 });

      const scored: { iteration: number; composite: number }[] = [];
      yield* eventBus.on("EntropyScored", (event) =>
        Effect.sync(() => {
          scored.push({ iteration: event.iteration, composite: event.composite });
        }),
      );

      // Publish multiple steps for the same task
      yield* eventBus.publish({
        _tag: "ReasoningStepCompleted",
        taskId: "test-task-4",
        strategy: "plan-execute-reflect",
        step: 1,
        totalSteps: 3,
        thought: "First I need to understand what the user wants.",
      });
      yield* Effect.sleep("10 millis");

      yield* eventBus.publish({
        _tag: "ReasoningStepCompleted",
        taskId: "test-task-4",
        strategy: "plan-execute-reflect",
        step: 2,
        totalSteps: 3,
        thought: "Now I should fetch the relevant data from the API.",
      });
      yield* Effect.sleep("10 millis");

      yield* eventBus.publish({
        _tag: "ReasoningStepCompleted",
        taskId: "test-task-4",
        strategy: "plan-execute-reflect",
        step: 3,
        totalSteps: 3,
        thought: "I have all the data, now I can synthesize the final answer.",
      });
      yield* Effect.sleep("10 millis");

      expect(scored.length).toBe(3);
      expect(scored[0]!.iteration).toBe(1);
      expect(scored[1]!.iteration).toBe(2);
      expect(scored[2]!.iteration).toBe(3);
    });

    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
  });

  test("handles errors gracefully without crashing", async () => {
    // Create a sensor that always throws
    const badSensorLayer = Layer.succeed(EntropySensorService, {
      score: () => Effect.die(new Error("sensor exploded")),
      scoreContext: () => Effect.die(new Error("boom")),
      getCalibration: () => Effect.die(new Error("boom")),
      updateCalibration: () => Effect.die(new Error("boom")),
      getTrajectory: () => Effect.die(new Error("boom")),
    } as any);

    const errorLayer = Layer.merge(EventBusLive, badSensorLayer);

    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus;
      yield* subscribeEntropyScoring({ maxIterations: 10 });

      // Should not throw even if sensor fails
      yield* eventBus.publish({
        _tag: "ReasoningStepCompleted",
        taskId: "test-task-err",
        strategy: "reactive",
        step: 1,
        totalSteps: 5,
        thought: "This should not crash even if the sensor fails.",
      });

      yield* Effect.sleep("10 millis");
      // If we get here without throwing, the test passes
    });

    await Effect.runPromise(program.pipe(Effect.provide(errorLayer)));
  });
});
