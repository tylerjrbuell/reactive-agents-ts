import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { join } from "node:path";
import { outputTokensPerSecond } from "@reactive-agents/core";
import { throughputOf } from "@reactive-agents/ui-core";
import { openDatabase } from "../db/schema.js";
import { getRecentLlmCalls } from "../db/model-throughput-queries.js";
import { modelThroughputOf } from "../services/model-throughput.js";
import { modelThroughputRouter } from "../api/model-throughput.js";

const TEST_DB_PATH = tmpDbPath("model-throughput");
const removeDb = () => rmDbFiles(TEST_DB_PATH);

let db: ReturnType<typeof openDatabase>;
let seq = 0;

const run = (runId: string, provider: string, model: string, startedAt: number) =>
  db
    .prepare(`INSERT INTO cortex_runs (run_id, agent_id, started_at, status, provider, model) VALUES (?,?,?,?,?,?)`)
    .run(runId, "agent-t", startedAt, "completed", provider, model);

const call = (runId: string, payload: Record<string, unknown>) =>
  db
    .prepare(`INSERT INTO cortex_events (agent_id, run_id, seq, ts, type, payload) VALUES (?,?,?,?,?,?)`)
    .run("agent-t", runId, seq++, Date.now(), "LLMRequestCompleted", JSON.stringify({ _tag: "LLMRequestCompleted", ...payload }));

beforeAll(() => {
  db = openDatabase(TEST_DB_PATH);
  run("r-old", "ollama", "qwen3:4b", 1000);
  run("r-new", "ollama", "qwen3:4b", 2000);
  run("r-other", "openai", "gpt-4o", 3000);
  // r-new: two streamed calls (exact) and one fallback call on another model.
  call("r-new", { provider: "ollama", model: "qwen3:4b", durationMs: 1500, firstTokenMs: 500, tokensOut: 100 }); // 100 tok/s
  call("r-new", { provider: "ollama", model: "qwen3:4b", durationMs: 1200, firstTokenMs: 200, tokensOut: 50 }); // 50 tok/s
  call("r-new", { provider: "openai", model: "gpt-4o", durationMs: 1000, firstTokenMs: 100, tokensOut: 900 });
  // r-old: a non-streamed call (lower bound only) and an exact one.
  call("r-old", { provider: "ollama", model: "qwen3:4b", durationMs: 1000, tokensOut: 10 }); // ≥10 tok/s
  call("r-old", { provider: "ollama", model: "qwen3:4b", durationMs: 1300, firstTokenMs: 300, tokensOut: 70 }); // 70 tok/s
  call("r-other", { provider: "openai", model: "gpt-4o", durationMs: 1000, firstTokenMs: 100, tokensOut: 900 });
});

afterAll(() => {
  db.close();
  removeDb();
});

describe("ui-core throughputOf matches core outputTokensPerSecond", () => {
  const cases = [
    { durationMs: 1500, firstTokenMs: 500, tokensOut: 100 },
    { durationMs: 2000, tokensOut: 100 },
    { durationMs: 500, firstTokenMs: 500, tokensOut: 10 },
    { durationMs: 0, tokensOut: 10 },
    { durationMs: 1000 },
    { durationMs: 900, firstTokenMs: 1, tokensOut: 0 },
  ];
  for (const c of cases) {
    it(JSON.stringify(c), () => {
      expect(throughputOf(c)?.tokensPerSecond).toBe(outputTokensPerSecond(c));
    });
  }
});

describe("getRecentLlmCalls", () => {
  it("reads only the model's most recent runs, newest first", () => {
    const rows = getRecentLlmCalls(db, "ollama", "qwen3:4b", 1);
    expect(new Set(rows.map((r) => r.runId))).toEqual(new Set(["r-new"]));
    expect(getRecentLlmCalls(db, "ollama", "qwen3:4b", 20).map((r) => r.runId)[0]).toBe("r-new");
  });
});

describe("modelThroughputOf", () => {
  it("medians exact calls only, skips calls on another model, and counts TTFT over calls that report it", () => {
    const t = modelThroughputOf("ollama", "qwen3:4b", getRecentLlmCalls(db, "ollama", "qwen3:4b", 20));
    expect(t.runs).toBe(2);
    // exact rates 100, 50, 70 → median 70; the lower-bound 10 tok/s is not mixed in
    expect(t.tokensPerSecond).toEqual({ median: 70, lowerBound: false, calls: 3 });
    expect(t.firstTokenMs).toEqual({ median: 300, calls: 3 });
  });

  it("reports a lower-bound median, marked, when no call measured its first token", () => {
    const t = modelThroughputOf("p", "m", [
      { runId: "a", payload: JSON.stringify({ provider: "p", model: "m", durationMs: 1000, tokensOut: 20 }) },
      { runId: "a", payload: JSON.stringify({ provider: "p", model: "m", durationMs: 1000, tokensOut: 40 }) },
    ]);
    expect(t.tokensPerSecond).toEqual({ median: 30, lowerBound: true, calls: 2 });
    expect(t.firstTokenMs).toBeUndefined();
  });

  it("returns no figures when nothing was recorded", () => {
    expect(modelThroughputOf("p", "m", [])).toEqual({ provider: "p", model: "m", runs: 0 });
  });
});

describe("GET /api/model-throughput", () => {
  it("answers with the medians and refuses a missing model", async () => {
    const app = modelThroughputRouter(db);
    const ok = await app.handle(new Request("http://localhost/api/model-throughput?provider=ollama&model=qwen3%3A4b"));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { tokensPerSecond?: { median: number } }).tokensPerSecond?.median).toBe(70);
    const bad = await app.handle(new Request("http://localhost/api/model-throughput?provider=ollama"));
    expect(bad.status).toBe(400);
  });
});
