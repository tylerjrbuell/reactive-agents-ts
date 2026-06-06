// packages/trace/src/layer.ts
import { Effect, Layer } from "effect"
import { EventBus } from "@reactive-agents/core"
import type { AgentEvent } from "@reactive-agents/core"
import { TraceRecorderService } from "./recorder.js"
import { toTraceEvent } from "./normalize.js"
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

// ─── Sequence counter ───

// Global monotonic counter — intentionally cross-run so batch-analysis tooling
// can sort events from multiple runs without per-run clocks. seq is unique within
// a single process lifetime. For per-run monotonicity, use the runId+seq pair.
let globalSeq = 0
function nextSeq(): number {
  return globalSeq++
}

// ─── Layer ───

/**
 * TraceBridgeLayer — subscribes to the EventBus and converts reactive events
 * into TraceEvents recorded by the TraceRecorderService.
 *
 * Requires: EventBus, TraceRecorderService
 *
 * Lifecycle: subscription is registered when the layer scope opens and
 * automatically unregistered when the scope closes.
 */
export const TraceBridgeLayer: Layer.Layer<
  never,
  never,
  EventBus | TraceRecorderService
> = Layer.scopedDiscard(
  Effect.gen(function* () {
    const bus = yield* EventBus
    const recorder = yield* TraceRecorderService

    const handler = (event: AgentEvent): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const traced = toTraceEvent(event, nextSeq())
        if (traced !== null) {
          yield* recorder.emit(traced)
        }
        // Flush pending events to disk when a run ends
        if (event._tag === "AgentCompleted" || event._tag === "TaskFailed") {
          yield* recorder.flush(event.taskId)
        }
      })

    const unsubscribe = yield* bus.subscribe(handler)

    yield* Effect.addFinalizer(() =>
      recorder.flushAll().pipe(
        Effect.catchAll((err) => emitErrorSwallowed({ site: "trace/src/layer.ts:179", tag: errorTag(err) })),
        Effect.andThen(Effect.sync(() => unsubscribe())),
      )
    )
  })
)
