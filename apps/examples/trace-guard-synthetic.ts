/**
 * Synthetic GuardFiredEmitted proof — validates the intervention-observability
 * consumer loop END-TO-END with ZERO kernel edits, BEFORE any warden dispatch.
 *
 * Pipeline under test: bus.publish(GuardFiredEmitted) → TraceBridgeLayer
 * (toTraceEvent) → TraceRecorderService → JSONL → loadTrace. This is the exact
 * path a real emitGuardFired() call site would traverse — proven before we
 * fan out 22 call sites (the dead-function / one-cell-first discipline).
 *
 * Simulates one overlap-storm iteration (multiple deciders firing the same
 * iter) + a terminal decision — the signals the analyzer must read.
 */
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { TraceRecorderService, TraceRecorderServiceLive, TraceBridgeLayer, loadTrace } from "@reactive-agents/trace";

const DIR = "/tmp/trace-guard-synthetic";
const RUN_ID = "synthetic-overlap-run";

const program = Effect.gen(function* () {
  const bus = yield* EventBus;

  const fire = (iteration: number, guard: string, outcome: string, reason: string, metadata?: Record<string, unknown>) =>
    bus.publish({
      _tag: "GuardFiredEmitted",
      taskId: RUN_ID,
      iteration,
      guard,
      outcome,
      reason,
      metadata,
      timestamp: Date.now(),
    } as Parameters<typeof bus.publish>[0]);

  // Iteration 3: an overlap-storm — three deciders fire in one iteration.
  yield* fire(3, "low_delta_guard", "warn", "token delta 40 < 120 threshold", { tokenDelta: 40 });
  yield* fire(3, "stall_deliverable", "warn", "2 consecutive iters no new artifact", { consecutiveStalled: 2 });
  yield* fire(3, "oracle_gate", "redirect", "pulse readyToAnswer but no final-answer (nudge 1)", { nudgeCount: 1 });
  // Iteration 4: the terminal decision that actually won.
  yield* fire(4, "terminal_decision", "terminate", "max_iterations reached", { terminatedBy: "max_iterations" });

  // Flush this run's pending events to disk.
  const recorder = yield* TraceRecorderService;
  yield* recorder.flush(RUN_ID);
});

// Single shared layer: bus + recorder exposed, bridge subscribes bus→recorder.
const base = Layer.merge(EventBusLive, TraceRecorderServiceLive({ dir: DIR }));
const full = TraceBridgeLayer.pipe(Layer.provideMerge(base));

await Effect.runPromise(
  program.pipe(Effect.provide(full), Effect.scoped) as Effect.Effect<void, never, never>,
).catch((e) => {
  console.error("SYNTH_FAIL", e);
  process.exit(1);
});

// Read it back and confirm shape.
const trace = await loadTrace(`${DIR}/${RUN_ID}.jsonl`);
const guards = trace.events.filter((e) => e.kind === "guard-fired");
console.log("GUARD_EVENTS=" + JSON.stringify(guards, null, 2));
console.log("COUNT=" + guards.length);
