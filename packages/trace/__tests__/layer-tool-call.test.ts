import { test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { EventBus, EventBusLive } from "@reactive-agents/core"
import { TraceRecorderService, TraceRecorderServiceLive } from "../src/recorder"
import { TraceBridgeLayer } from "../src/layer"
import type { ToolCallEvent } from "../src/events"

test("bridges ToolCallStarted into TraceRecorder as tool-call-start with rationale", async () => {
  const program = Effect.gen(function* () {
    const bus = yield* EventBus
    const recorder = yield* TraceRecorderService
    yield* bus.publish({
      _tag: "ToolCallStarted",
      taskId: "run-tc1",
      toolName: "web_search",
      callId: "call-1",
      iteration: 2,
      timestamp: 1_000,
      rationale: { why: "needs fresh data", refs: ["scratch:goal"] },
    })
    yield* Effect.sleep("50 millis")
    return yield* recorder.snapshot("run-tc1")
  })

  const layers = Layer.provideMerge(
    TraceBridgeLayer,
    Layer.mergeAll(EventBusLive, TraceRecorderServiceLive({ dir: null })),
  )
  const result = await Effect.runPromise(program.pipe(Effect.provide(layers)))
  const start = result.find(
    (e): e is ToolCallEvent => e.kind === "tool-call-start",
  )
  expect(start).toBeDefined()
  expect(start?.toolName).toBe("web_search")
  expect(start?.iter).toBe(2)
  expect(start?.rationale?.why).toBe("needs fresh data")
  expect(start?.rationale?.refs).toEqual(["scratch:goal"])
})

test("bridges ToolCallStarted without rationale (backwards-compat)", async () => {
  const program = Effect.gen(function* () {
    const bus = yield* EventBus
    const recorder = yield* TraceRecorderService
    yield* bus.publish({
      _tag: "ToolCallStarted",
      taskId: "run-tc2",
      toolName: "calc",
      callId: "call-2",
    })
    yield* Effect.sleep("50 millis")
    return yield* recorder.snapshot("run-tc2")
  })

  const layers = Layer.provideMerge(
    TraceBridgeLayer,
    Layer.mergeAll(EventBusLive, TraceRecorderServiceLive({ dir: null })),
  )
  const result = await Effect.runPromise(program.pipe(Effect.provide(layers)))
  const start = result.find(
    (e): e is ToolCallEvent => e.kind === "tool-call-start",
  )
  expect(start).toBeDefined()
  expect(start?.rationale).toBeUndefined()
})

test("bridges ToolCallCompleted into tool-call-end with duration + ok", async () => {
  const program = Effect.gen(function* () {
    const bus = yield* EventBus
    const recorder = yield* TraceRecorderService
    yield* bus.publish({
      _tag: "ToolCallCompleted",
      taskId: "run-tc3",
      toolName: "calc",
      callId: "call-3",
      durationMs: 42,
      success: true,
    })
    yield* Effect.sleep("50 millis")
    return yield* recorder.snapshot("run-tc3")
  })

  const layers = Layer.provideMerge(
    TraceBridgeLayer,
    Layer.mergeAll(EventBusLive, TraceRecorderServiceLive({ dir: null })),
  )
  const result = await Effect.runPromise(program.pipe(Effect.provide(layers)))
  const end = result.find((e): e is ToolCallEvent => e.kind === "tool-call-end")
  expect(end).toBeDefined()
  expect(end?.durationMs).toBe(42)
  expect(end?.ok).toBe(true)
})
