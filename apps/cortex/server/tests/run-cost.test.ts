import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { Database } from "bun:sqlite";
import type { AgentEvent } from "@reactive-agents/core";
import { EMPTY_COST_TOTAL as EMPTY_COST_SUM, foldRunCost } from "@reactive-agents/ui-core";
import { applySchema } from "../db/schema.js";
import { getRunById, insertEvent, getNextSeq, upsertRun, recomputeRunStats } from "../db/queries.js";
import { CortexIngestService, CortexIngestServiceLive } from "../services/ingest-service.js";
import { CortexEventBridgeLive } from "../services/event-bridge.js";
import { runCostPatchOf } from "../services/run-cost.js";

const priced = (usd: number) => ({ estimatedCost: usd, priceSource: "price-book" });
const unpriced = { priceSource: "unknown" };

describe("run cost rule (run-cost.ts)", () => {
  it("an unpriced call adds nothing and marks the total partial, never $0-complete", () => {
    let c = foldRunCost(EMPTY_COST_SUM, "LLMRequestCompleted", priced(0.5));
    c = foldRunCost(c, "LLMRequestCompleted", unpriced);
    expect(c).toEqual({ usd: 0.5, complete: false });
    expect(runCostPatchOf("LLMRequestCompleted", unpriced)).toEqual({ costIncomplete: true });
    expect(runCostPatchOf("LLMRequestCompleted", priced(0.5))).toEqual({ cost: 0.5 });
  });

  it("AgentCompleted only marks the run partial; its totalCostUsd (pre-debrief) is not the run total", () => {
    expect(runCostPatchOf("AgentCompleted", { totalCostUsd: 1, costComplete: false })).toEqual({ costIncomplete: true });
    expect(runCostPatchOf("AgentCompleted", { totalCostUsd: 1 })).toEqual({});
  });

  it("RunCostFinalized is the run's final total", () => {
    expect(runCostPatchOf("RunCostFinalized", { totalCostUsd: 1.2, costComplete: true })).toEqual({ costFinal: { usd: 1.2, complete: true } });
    expect(runCostPatchOf("RunCostFinalized", { totalCostUsd: 1.2, costComplete: false })).toEqual({ costFinal: { usd: 1.2, complete: false } });
  });
});

const llm = (cost: Record<string, unknown>): AgentEvent =>
  ({
    _tag: "LLMRequestCompleted",
    taskId: "t",
    requestId: "req",
    model: "m",
    provider: "anthropic",
    durationMs: 1,
    tokensUsed: 10,
    ...cost,
  }) as unknown as AgentEvent;

const completed = (totalCostUsd: number): AgentEvent =>
  ({ _tag: "AgentCompleted", taskId: "t", agentId: "a", success: true, totalIterations: 1, totalTokens: 30, durationMs: 5, totalCostUsd }) as unknown as AgentEvent;

const finalized = (totalCostUsd: number, costComplete: boolean): AgentEvent =>
  ({ _tag: "RunCostFinalized", taskId: "t", agentId: "a", totalCostUsd, costComplete }) as unknown as AgentEvent;

function ingestAll(db: Database, runId: string, events: readonly AgentEvent[]): Promise<void> {
  const layer = CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive));
  return Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      for (const event of events) yield* svc.handleEvent("a", runId, { v: 1, agentId: "a", runId, event });
    }).pipe(Effect.provide(layer)),
  );
}

describe("ingest + rebuild persist an honest run total", () => {
  it("RunCostFinalized after AgentCompleted sets the stored total (debrief included); before it the per-call sum is provisional", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    // Two priced calls and an unpriced one, the run ends (pre-debrief meter $0.75), then the debrief call.
    await ingestAll(db, "r-cost", [llm(priced(0.25)), llm(unpriced), llm(priced(0.5)), completed(0.75), llm(priced(0.1))]);
    const provisional = getRunById(db, "r-cost");
    expect(provisional?.cost).toBeCloseTo(0.85, 10);
    expect(provisional?.costComplete).toBe(false);

    // The framework's final total wins over the per-call sum (a call event can be missed).
    await ingestAll(db, "r-cost", [finalized(0.9, false)]);
    const live = getRunById(db, "r-cost");
    expect(live?.cost).toBeCloseTo(0.9, 10);
    expect(live?.costComplete).toBe(false);

    db.prepare("UPDATE cortex_runs SET cost_usd = 0, cost_complete = 1 WHERE run_id = 'r-cost'").run();
    expect(recomputeRunStats(db, "r-cost")).toBe(true);
    const rebuilt = getRunById(db, "r-cost");
    expect(rebuilt?.cost).toBeCloseTo(0.9, 10);
    expect(rebuilt?.costComplete).toBe(false);
  });

  it("a complete final total clears an earlier partial mark: the framework's flag is authoritative", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    await ingestAll(db, "r-final", [llm(unpriced), completed(0), finalized(0.4, true)]);
    const run = getRunById(db, "r-final");
    expect(run?.cost).toBeCloseTo(0.4, 10);
    expect(run?.costComplete).toBeUndefined();
  });

  it("a run stored before RunCostFinalized existed keeps its old rule on rebuild (run meter raises a smaller sum)", () => {
    const db = new Database(":memory:");
    applySchema(db);
    upsertRun(db, "a", "r-legacy");
    for (const event of [llm(priced(0.25)), completed(1)]) {
      insertEvent(db, { v: 1, agentId: "a", runId: "r-legacy", event }, getNextSeq(db, "r-legacy"));
    }
    expect(recomputeRunStats(db, "r-legacy")).toBe(true);
    expect(getRunById(db, "r-legacy")?.cost).toBeCloseTo(1, 10);
  });

  it("a fully priced run has no costComplete flag", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    await ingestAll(db, "r-ok", [llm(priced(0.1))]);
    const run = getRunById(db, "r-ok");
    expect(run?.cost).toBeCloseTo(0.1, 10);
    expect(run?.costComplete).toBeUndefined();
  });
});
