// Pins (2026-11-19, cost honesty): the run's final billed cost
// (core RunCostFinalized) can arrive AFTER AgentCompleted; the trace keeps it
// as a late `run-cost-finalized` record in the same run file, and an unknown
// total is never read as a measured $0.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { TraceRecorderServiceLive } from "../src/recorder";
import { TraceBridgeLayer } from "../src/layer";
import { toTraceEvent } from "../src/normalize";
import { isTraceEvent, type TraceEvent } from "../src/events";
import { parseTrace } from "../src/replay";
import { runCost, renderRunCost } from "../src/run-cost";
import { analyzeRun, renderRunReport } from "../src/analyze";

const completed = (extra: Partial<Extract<AgentEvent, { _tag: "AgentCompleted" }>> = {}): AgentEvent => ({
  _tag: "AgentCompleted",
  taskId: "run-cost-1",
  agentId: "a",
  success: true,
  totalIterations: 1,
  totalTokens: 10,
  durationMs: 5,
  ...extra,
});

const finalized = (totalCostUsd: number, costComplete: boolean): AgentEvent => ({
  _tag: "RunCostFinalized",
  taskId: "run-cost-1",
  agentId: "a",
  totalCostUsd,
  costComplete,
});

const runCompletedOf = (raw: AgentEvent) => {
  const ev = toTraceEvent(raw, 1);
  if (ev?.kind !== "run-completed") throw new Error("expected run-completed");
  return ev;
};

describe("run-completed cost completeness", () => {
  it("an absent total is unknown: 0 as the lower bound, costComplete false", () => {
    const ev = runCompletedOf(completed());
    expect(ev.totalCostUsd).toBe(0);
    expect(ev.costComplete).toBe(false);
  });

  it("a total with an unpriced call stays partial", () => {
    const ev = runCompletedOf(completed({ totalCostUsd: 0.02, costComplete: false }));
    expect(ev.totalCostUsd).toBe(0.02);
    expect(ev.costComplete).toBe(false);
  });

  it("a total without a flag is complete", () => {
    expect(runCompletedOf(completed({ totalCostUsd: 0.02 })).costComplete).toBe(true);
  });

  it("an old run-completed line without costComplete still loads, completeness unknown", () => {
    const old = { kind: "run-completed", runId: "r", timestamp: 1, iter: -1, seq: 2, status: "success", totalTokens: 1, totalCostUsd: 0, durationMs: 1 };
    const trace = parseTrace(JSON.stringify(old));
    expect(trace.events).toHaveLength(1);
    expect(runCost(trace.events)).toEqual({ totalCostUsd: 0, complete: undefined, source: "run-completed" });
    expect(renderRunCost(runCost(trace.events))).toBe("$0.0000 (completeness unknown)");
  });
});

describe("run-cost-finalized normalization and reading", () => {
  it("maps RunCostFinalized to a valid run-cost-finalized trace event under the taskId", () => {
    const ev = toTraceEvent(finalized(0.05, false), 9);
    expect(ev).toMatchObject({ kind: "run-cost-finalized", runId: "run-cost-1", iter: -1, seq: 9, totalCostUsd: 0.05, costComplete: false });
    expect(isTraceEvent(ev)).toBe(true);
  });

  it("runCost prefers the late finalized total over run-completed and marks partial", () => {
    const events = [runCompletedOf(completed({ totalCostUsd: 0.01 })), toTraceEvent(finalized(0.03, false), 2)].filter(
      (e): e is TraceEvent => e !== null,
    );
    const cost = runCost(events);
    expect(cost).toEqual({ totalCostUsd: 0.03, complete: false, source: "run-cost-finalized" });
    expect(renderRunCost(cost)).toBe("≥$0.0300 (partial: unpriced calls)");
    expect(renderRunReport(analyzeRun({ runId: "run-cost-1", events }))).toContain("usd=≥$0.0300 (partial: unpriced calls)");
  });

  it("no cost record reads as unknown, not $0", () => {
    expect(runCost([])).toEqual({ totalCostUsd: undefined, complete: undefined, source: "none" });
    expect(renderRunCost(runCost([]))).toBe("unknown");
  });
});

describe("late RunCostFinalized persists after the run-completed flush", () => {
  it("appends run-cost-finalized to the same run file after run-completed, without waiting for layer close", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trace-cost-"));
    try {
      const file = join(dir, "run-cost-1.jsonl");
      const program = Effect.gen(function* () {
        const bus = yield* EventBus;
        yield* bus.publish(completed({ totalCostUsd: 0.01 }));
        yield* Effect.sleep("30 millis");
        // The run-end flush already wrote run-completed.
        const afterCompleted = yield* Effect.promise(() => readFile(file, "utf8"));
        // The final cost lands later (background debrief settled).
        yield* bus.publish(finalized(0.04, true));
        yield* Effect.sleep("30 millis");
        const afterFinalized = yield* Effect.promise(() => readFile(file, "utf8"));
        return { afterCompleted, afterFinalized };
      });
      const layers = Layer.provideMerge(TraceBridgeLayer, Layer.mergeAll(EventBusLive, TraceRecorderServiceLive({ dir })));
      const { afterCompleted, afterFinalized } = await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(layers))));

      expect(parseTrace(afterCompleted).events.map((e) => e.kind)).toEqual(["run-completed"]);
      const trace = parseTrace(afterFinalized);
      expect(trace.events.map((e) => e.kind)).toEqual(["run-completed", "run-cost-finalized"]);
      expect(runCost(trace.events)).toEqual({ totalCostUsd: 0.04, complete: true, source: "run-cost-finalized" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
