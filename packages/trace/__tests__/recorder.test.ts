import { describe, test, expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EventBus, EventBusLive, errorTag, type AgentEvent } from "@reactive-agents/core"
import {
  TraceRecorderService,
  TraceRecorderServiceLive,
} from "../src/recorder"
import { TraceStorageError } from "../src/errors"
import type { EntropyScoredEvent, TraceEvent } from "../src/events"

describe("TraceRecorderService", () => {
  test("records events in seq order and exposes them via snapshot", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* TraceRecorderService
      const ev: EntropyScoredEvent = {
        kind: "entropy-scored",
        runId: "r1", timestamp: 1, iter: 0, seq: 0,
        composite: 0.42,
        sources: { token: 0.1, structural: 0.2, semantic: 0.3, behavioral: 0.4, contextPressure: 0 },
        sourcesPresent: 4,
        confidence: "high",
        trajectoryShape: "ascending",
        modelTier: "frontier",
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

// D3 tagged-error identity (quality program Task 14, tranche 1).
// The recorder's three IO catch sites feed their error VALUE to exactly one
// consumer: errorTag(err) inside the emitErrorSwallowed telemetry payload.
// These cases fire the real IO failures (mkdir on an existing file,
// appendFile onto a directory) and assert the emitted `ErrorSwallowed`
// discriminator is now the tagged `_tag` ("TraceStorageError"), replacing
// the old constructor-name fallback ("Error").
describe("TraceStorageError tagged sites (D3)", () => {
  const runStarted = (runId: string): TraceEvent => ({
    kind: "run-started",
    runId,
    timestamp: 1,
    iter: -1,
    seq: 0,
    task: "t",
    model: "m",
    provider: "p",
    config: {},
  })

  const swallowBySite = (events: readonly AgentEvent[], site: string) =>
    events.find(
      (e): e is Extract<AgentEvent, { _tag: "ErrorSwallowed" }> =>
        e._tag === "ErrorSwallowed" && e.site === site,
    )

  test("mkdir IO failure emits ErrorSwallowed tagged TraceStorageError", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rax-trace-d3-"))
    const fileAsDir = join(dir, "not-a-dir")
    writeFileSync(fileAsDir, "")
    try {
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const captured = yield* Ref.make<AgentEvent[]>([])
          const bus = yield* EventBus
          yield* bus.subscribe((event) => Ref.update(captured, (xs) => [...xs, event]))
          const rec = yield* TraceRecorderService
          yield* rec.emit(runStarted("d3-mkdir"))
          // opts.dir points at a regular FILE: mkdir(dir) fails (EEXIST),
          // the catch constructs the tagged error, catchAll swallows it into
          // the ErrorSwallowed event.
          yield* rec.flush("d3-mkdir")
          return yield* Ref.get(captured)
        }).pipe(
          Effect.provide(TraceRecorderServiceLive({ dir: fileAsDir })),
          Effect.provide(EventBusLive),
        ),
      )
      const swallow = swallowBySite(events, "trace/src/recorder.ts:75")
      expect(swallow).toBeDefined()
      expect(swallow?.tag).toBe("TraceStorageError")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15000)

  test("appendFile IO failure emits ErrorSwallowed tagged TraceStorageError", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rax-trace-d3-"))
    try {
      // mkdir(dir) succeeds; appendFile then targets dir/<runId>.jsonl which
      // we pre-created as a DIRECTORY -> EISDIR at the second catch site only.
      mkdirSync(join(dir, "d3-append.jsonl"))
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const captured = yield* Ref.make<AgentEvent[]>([])
          const bus = yield* EventBus
          yield* bus.subscribe((event) => Ref.update(captured, (xs) => [...xs, event]))
          const rec = yield* TraceRecorderService
          yield* rec.emit(runStarted("d3-append"))
          yield* rec.flush("d3-append")
          return yield* Ref.get(captured)
        }).pipe(
          Effect.provide(TraceRecorderServiceLive({ dir })),
          Effect.provide(EventBusLive),
        ),
      )
      const swallow = swallowBySite(events, "trace/src/recorder.ts:81")
      expect(swallow).toBeDefined()
      expect(swallow?.tag).toBe("TraceStorageError")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15000)

  test("prune-site value contract: String(e) message preserved byte-identically, _tag drives errorTag", () => {
    // The prune catch site runs in a fiber forked at LAYER INIT, whose context
    // is the layer's own (empty) — emitErrorSwallowed's serviceOption(EventBus)
    // is a no-op there by pre-existing design, so no event-level assertion is
    // possible without a behavior change outside D3 scope. This covers the
    // site's value flow directly: same construction shape as the site
    // (`{ message: String(e), cause: e }`) and its sole consumer, errorTag.
    const ioError = "Error: ENOTDIR: not a directory, scandir '/tmp/x'"
    const err = new TraceStorageError({ message: String(ioError), cause: ioError })
    expect(err.message).toBe(ioError)
    expect(err._tag).toBe("TraceStorageError")
    expect(errorTag(err)).toBe("TraceStorageError")
  })
})
