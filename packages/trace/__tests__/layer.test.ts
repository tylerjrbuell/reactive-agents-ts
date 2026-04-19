import { test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { EventBus, EventBusLive } from "@reactive-agents/core"
import { TraceRecorderService, TraceRecorderServiceLive } from "../src/recorder"
import { TraceBridgeLayer } from "../src/layer"

test("bridges EventBus EntropyScored into TraceRecorder as entropy-scored", async () => {
  const program = Effect.gen(function* () {
    const bus = yield* EventBus
    const recorder = yield* TraceRecorderService
    yield* bus.publish({
      _tag: "EntropyScored",
      taskId: "run-r1",
      iteration: 1,
      composite: 0.5,
      sources: { token: 0.1, structural: 0.2, semantic: 0.3, behavioral: 0.4, contextPressure: 0.0 },
      trajectory: { derivative: 0, shape: "flat", momentum: 0 },
      confidence: "high",
      modelTier: "frontier",
      iterationWeight: 1,
    })
    // Give the subscription a tick to process
    yield* Effect.sleep("50 millis")
    return yield* recorder.snapshot("run-r1")
  })

  const layers = Layer.provideMerge(
    TraceBridgeLayer,
    Layer.mergeAll(EventBusLive, TraceRecorderServiceLive({ dir: null }))
  )
  const result = await Effect.runPromise(program.pipe(Effect.provide(layers)))
  expect(result.some((e) => e.kind === "entropy-scored")).toBe(true)
})

test("bridges EventBus ReactiveDecision into TraceRecorder as decision-evaluated", async () => {
  const program = Effect.gen(function* () {
    const bus = yield* EventBus
    const recorder = yield* TraceRecorderService
    yield* bus.publish({
      _tag: "ReactiveDecision",
      taskId: "run-r2",
      iteration: 2,
      decision: "early-stop",
      reason: "entropy converged",
      entropyBefore: 0.8,
      entropyAfter: 0.2,
    })
    yield* Effect.sleep("50 millis")
    return yield* recorder.snapshot("run-r2")
  })

  const layers = Layer.provideMerge(
    TraceBridgeLayer,
    Layer.mergeAll(EventBusLive, TraceRecorderServiceLive({ dir: null }))
  )
  const result = await Effect.runPromise(program.pipe(Effect.provide(layers)))
  expect(result.some((e) => e.kind === "decision-evaluated")).toBe(true)
})

test("bridges EventBus StrategySwitched into TraceRecorder as strategy-switched", async () => {
  const program = Effect.gen(function* () {
    const bus = yield* EventBus
    const recorder = yield* TraceRecorderService
    yield* bus.publish({
      _tag: "StrategySwitched",
      taskId: "run-r3",
      from: "react",
      to: "plan-execute-reflect",
      reason: "high entropy",
      timestamp: Date.now(),
    })
    yield* Effect.sleep("50 millis")
    return yield* recorder.snapshot("run-r3")
  })

  const layers = Layer.provideMerge(
    TraceBridgeLayer,
    Layer.mergeAll(EventBusLive, TraceRecorderServiceLive({ dir: null }))
  )
  const result = await Effect.runPromise(program.pipe(Effect.provide(layers)))
  expect(result.some((e) => e.kind === "strategy-switched")).toBe(true)
})

test("ignores unknown event types without crashing", async () => {
  const program = Effect.gen(function* () {
    const bus = yield* EventBus
    const recorder = yield* TraceRecorderService
    // Publish a known event first so we have something to check
    yield* bus.publish({
      _tag: "Custom",
      type: "some-unknown-event",
      payload: {},
    })
    yield* Effect.sleep("50 millis")
    // No crash — recorder has no events from unknown types
    return yield* recorder.snapshot("unknown-run")
  })

  const layers = Layer.provideMerge(
    TraceBridgeLayer,
    Layer.mergeAll(EventBusLive, TraceRecorderServiceLive({ dir: null }))
  )
  const result = await Effect.runPromise(program.pipe(Effect.provide(layers)))
  expect(result).toHaveLength(0)
})
