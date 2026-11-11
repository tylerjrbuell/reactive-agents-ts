import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../db/schema.js";
import { getRecentLlmCalls, getRecentRunOutcomes } from "../db/model-throughput-queries.js";
import { modelCostOf, runSucceeded } from "../services/model-cost.js";
import { modelInsightsRouter } from "../api/model-insights.js";
import { makeModelCalibrationReader } from "../services/model-calibration.js";

let db: Database;
let seq = 0;

const run = (runId: string, provider: string, model: string, startedAt: number, status: string, ending: string | null) =>
  db
    .prepare(`INSERT INTO cortex_runs (run_id, agent_id, started_at, status, provider, model, ending) VALUES (?,?,?,?,?,?,?)`)
    .run(runId, "agent-c", startedAt, status, provider, model, ending);

const call = (runId: string, payload: Record<string, unknown>) =>
  db
    .prepare(`INSERT INTO cortex_events (agent_id, run_id, seq, ts, type, payload) VALUES (?,?,?,?,?,?)`)
    .run("agent-c", runId, seq++, Date.now(), "LLMRequestCompleted", JSON.stringify({ _tag: "LLMRequestCompleted", ...payload }));

const SONNET = { provider: "anthropic", model: "claude-sonnet-4-6" };

beforeAll(() => {
  db = openDatabase(":memory:");
  run("ok-1", SONNET.provider, SONNET.model, 1000, "completed", "succeeded");
  run("fail-1", SONNET.provider, SONNET.model, 2000, "failed", "failed");
  run("abst-1", SONNET.provider, SONNET.model, 3000, "failed", "abstained");
  run("live-1", SONNET.provider, SONNET.model, 4000, "live", null);
  call("ok-1", { ...SONNET, tokensUsed: 1500, tokensIn: 1000, tokensOut: 500, cacheReadTokensIn: 800, estimatedCost: 0.01 });
  // A fallback call on another model inside the same run: not this model's spend.
  call("ok-1", { provider: "openai", model: "gpt-4o", tokensUsed: 9000, tokensIn: 8000, tokensOut: 1000, estimatedCost: 5 });
  call("fail-1", { ...SONNET, tokensUsed: 3000, tokensIn: 2500, tokensOut: 500, estimatedCost: 0.02 });
  // No token split, no cost: tokens count, the dollar figure becomes a lower bound.
  call("abst-1", { ...SONNET, tokensUsed: 400 });
});

afterAll(() => db.close());

describe("model cost", () => {
  it("folds this model's calls only and divides all spend by the successful runs", () => {
    const cost = modelCostOf(
      SONNET.provider,
      SONNET.model,
      getRecentLlmCalls(db, SONNET.provider, SONNET.model, 50),
      getRecentRunOutcomes(db, SONNET.provider, SONNET.model, 50),
    );
    expect(cost).toMatchObject({
      runs: 3,
      successfulRuns: 1,
      calls: 3,
      tokens: 4900,
      tokensIn: 3500,
      tokensOut: 1000,
      cachedTokensIn: 800,
      splitCalls: 2,
      costKnown: false,
    });
    expect(cost.costUsd).toBeCloseTo(0.03, 10);
    expect(cost.costPerSuccessfulRun).toBeCloseTo(0.03, 10);
  });

  it("gives no per-success figure without a successful run", () => {
    const cost = modelCostOf("x", "y", [], [{ runId: "r", status: "failed", ending: "failed" }]);
    expect(cost.costPerSuccessfulRun).toBeUndefined();
    expect(cost.costKnown).toBe(true);
  });

  it("an ending decides success; without one the run status does", () => {
    expect(runSucceeded({ runId: "a", status: "completed", ending: "partial" })).toBe(false);
    expect(runSucceeded({ runId: "b", status: "failed", ending: "succeeded" })).toBe(true);
    expect(runSucceeded({ runId: "c", status: "completed", ending: null })).toBe(true);
  });

  it("GET /api/model-cost validates and answers", async () => {
    const app = modelInsightsRouter(db, makeModelCalibrationReader({ observationsDir: "/nonexistent-cortex-obs" }));
    expect((await app.handle(new Request("http://localhost/api/model-cost?provider=anthropic"))).status).toBe(400);
    const res = await app.handle(
      new Request(`http://localhost/api/model-cost?provider=anthropic&model=${encodeURIComponent(SONNET.model)}&runs=2`),
    );
    expect(res.status).toBe(200);
    // The two newest runs: live-1 (not ended, left out of the outcomes) and abst-1.
    expect(await res.json()).toMatchObject({ runs: 1, successfulRuns: 0, calls: 1, tokens: 400 });
  });
});
