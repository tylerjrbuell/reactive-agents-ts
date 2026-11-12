/**
 * The stored run strategy follows the same rule as the run view (ui-core
 * `foldRunStrategy`): resolved config > kernel loop > step event, first-seen
 * within a rank. Before, ingest kept the first strategy any step event named,
 * so a structured-output sub-call's label could stick while the run view
 * showed the loop's strategy.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { Database } from "bun:sqlite";
import type { AgentEvent } from "@reactive-agents/core";
import { runStrategyOfEvents } from "@reactive-agents/ui-core";
import { CortexIngestService, CortexIngestServiceLive } from "../services/ingest-service.js";
import { CortexEventBridgeLive } from "../services/event-bridge.js";
import { applySchema } from "../db/schema.js";
import { recomputeRunStats } from "../db/queries.js";

const ingest = async (runId: string, events: readonly Record<string, unknown>[]): Promise<string | null> => {
  const db = new Database(":memory:");
  applySchema(db);
  const program = Effect.gen(function* () {
    const svc = yield* CortexIngestService;
    for (const event of events) {
      yield* svc.handleEvent("a", runId, { v: 1, agentId: "a", runId, event: event as unknown as AgentEvent });
    }
  });
  await Effect.runPromise(program.pipe(Effect.provide(CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive)))));
  const row = db.prepare("SELECT strategy FROM cortex_runs WHERE run_id = ?").get(runId) as { strategy: string | null };
  db.close();
  return row.strategy;
};

const asUi = (events: readonly Record<string, unknown>[]) =>
  runStrategyOfEvents(events.map((e) => ({ type: String(e._tag), payload: e })));

// Live repro (2026-11-11): an output guardrail blocked a finished run; the runtime published
// AgentAborted (no AgentCompleted) and the run row stayed `live` forever.
describe("AgentAborted settles the run row", () => {
  const statusAfter = async (runId: string, abort: Record<string, unknown>) => {
    const db = new Database(":memory:");
    applySchema(db);
    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      for (const event of [{ _tag: "AgentStarted", taskId: "t", agentId: "a", provider: "p", model: "m", timestamp: 1 }, { _tag: "AgentAborted", taskId: "t", agentId: "a", durationMs: 5, timestamp: 2, ...abort }]) {
        yield* svc.handleEvent("a", runId, { v: 1, agentId: "a", runId, event: event as unknown as AgentEvent });
      }
    });
    await Effect.runPromise(program.pipe(Effect.provide(CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive)))));
    const row = db.prepare("SELECT status, error_message, completed_at FROM cortex_runs WHERE run_id = ?").get(runId) as { status: string; error_message: string | null; completed_at: number | null };
    db.close();
    return row;
  };

  it("a failure abort is failed, with its error", async () => {
    const row = await statusAfter("ab1", { causeClass: "failure", error: "GuardrailViolationError: Output guardrail check failed" });
    expect(row.status).toBe("failed");
    expect(row.error_message).toBe("GuardrailViolationError: Output guardrail check failed");
    expect(row.completed_at).not.toBeNull();
  });

  it("a user stop or terminate abort is stopped", async () => {
    expect((await statusAfter("ab2", { causeClass: "interrupt", reason: "user-stop" })).status).toBe("stopped");
    expect((await statusAfter("ab3", { causeClass: "interrupt", reason: "terminate" })).status).toBe("stopped");
  });

  it("a guardrail abort is blocked, and a later failed completion keeps it blocked", async () => {
    const row = await statusAfter("ab4", { causeClass: "failure", reason: "guardrail", error: "GuardrailViolationError: blocked" });
    expect(row.status).toBe("blocked");
    expect(row.error_message).toBe("GuardrailViolationError: blocked");
    expect(row.completed_at).not.toBeNull();
  });

  it("a stored guardrail abort recomputes as blocked (not live)", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      for (const event of [
        { _tag: "AgentStarted", taskId: "t", agentId: "a", provider: "p", model: "m", timestamp: 1 },
        { _tag: "AgentAborted", taskId: "t", agentId: "a", durationMs: 5, timestamp: 2, causeClass: "failure", reason: "guardrail" },
        { _tag: "AgentCompleted", taskId: "t", agentId: "a", success: false, totalTokens: 0, durationMs: 5, timestamp: 3 },
      ]) {
        yield* svc.handleEvent("a", "ab5", { v: 1, agentId: "a", runId: "ab5", event: event as unknown as AgentEvent });
      }
    });
    await Effect.runPromise(program.pipe(Effect.provide(CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive)))));
    const live = db.prepare("SELECT status FROM cortex_runs WHERE run_id = ?").get("ab5") as { status: string };
    expect(live.status).toBe("blocked");
    recomputeRunStats(db, "ab5");
    const again = db.prepare("SELECT status FROM cortex_runs WHERE run_id = ?").get("ab5") as { status: string };
    expect(again.status).toBe("blocked");
    db.close();
  });
});

describe("stored run strategy = the run view's strategy", () => {
  it("a step event's label never beats the kernel loop", async () => {
    const events = [
      { _tag: "AgentStarted", taskId: "t", agentId: "a", provider: "p", model: "m", timestamp: 1 },
      { _tag: "ReasoningStepCompleted", taskId: "t", strategy: "structured-output-native", step: 1, totalSteps: 1 },
      { _tag: "ReasoningIterationProgress", taskId: "t", iteration: 1, maxIterations: 5, strategy: "plan-execute-reflect", toolsThisStep: [] },
    ];
    expect(await ingest("r1", events)).toBe("plan-execute-reflect");
    expect(asUi(events).strategy).toBe("plan-execute-reflect");
  });

  it("the resolved run config wins over every event", async () => {
    const events = [
      { _tag: "AgentStarted", taskId: "t", agentId: "a", provider: "p", model: "m", timestamp: 1, config: { builder: { strategy: "reflexion" } } },
      { _tag: "ReasoningIterationProgress", taskId: "t", iteration: 1, maxIterations: 5, strategy: "reactive", toolsThisStep: [] },
    ];
    expect(await ingest("r2", events)).toBe("reflexion");
    expect(asUi(events).strategy).toBe("reflexion");
  });

  it("a mid-run switch keeps the started strategy on the row", async () => {
    const events = [
      { _tag: "ReasoningIterationProgress", taskId: "t", iteration: 1, maxIterations: 5, strategy: "reactive", toolsThisStep: [] },
      { _tag: "StrategySwitched", taskId: "t", from: "reactive", to: "plan-execute-reflect", reason: "stuck" },
      { _tag: "ReasoningIterationProgress", taskId: "t", iteration: 2, maxIterations: 5, strategy: "plan-execute-reflect", toolsThisStep: [] },
    ];
    expect(await ingest("r3", events)).toBe("reactive");
    expect(asUi(events)).toEqual({ strategy: "reactive", switchedTo: "plan-execute-reflect" });
  });
});
