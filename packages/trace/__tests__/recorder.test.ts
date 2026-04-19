import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import {
  TraceRecorderService,
  TraceRecorderServiceLive,
} from "../src/recorder"
import type { EntropyScoredEvent } from "../src/events"

describe("TraceRecorderService", () => {
  test("records events in seq order and exposes them via snapshot", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* TraceRecorderService
      const ev: EntropyScoredEvent = {
        kind: "entropy-scored",
        runId: "r1", timestamp: 1, iter: 0, seq: 0,
        composite: 0.42,
        sources: { token: 0.1, structural: 0.2, semantic: 0.3, behavioral: 0.4, contextPressure: 0 },
      }
      yield* recorder.emit(ev)
      const events = yield* recorder.snapshot("r1")
      return events
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(TraceRecorderServiceLive({ dir: null })))
    )
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe("entropy-scored")
  })

  test("writes JSONL to disk when dir is provided", async () => {
    const tmp = `/tmp/trace-test-${Date.now()}`
    const program = Effect.gen(function* () {
      const recorder = yield* TraceRecorderService
      yield* recorder.emit({
        kind: "run-started", runId: "r2", timestamp: 1, iter: -1, seq: 0,
        task: "t", model: "m", provider: "p", config: {},
      })
      yield* recorder.flush("r2")
    })
    await Effect.runPromise(
      program.pipe(Effect.provide(TraceRecorderServiceLive({ dir: tmp })))
    )
    const file = Bun.file(`${tmp}/r2.jsonl`)
    expect(await file.exists()).toBe(true)
    const text = await file.text()
    expect(text).toContain('"run-started"')
  })
})
