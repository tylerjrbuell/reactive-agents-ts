import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { getRecentLlmCalls } from "../db/model-throughput-queries.js";
import { modelThroughputOf } from "../services/model-throughput.js";

/** Recent runs read for the medians when the caller does not say. */
export const DEFAULT_THROUGHPUT_RUNS = 20;
const MAX_THROUGHPUT_RUNS = 200;

/**
 * `GET /api/model-throughput?provider=&model=&runs=` — median tokens/sec and
 * TTFT over the model's recent runs (`services/model-throughput.ts`). A query
 * parameter carries the model because model ids can contain `/`.
 */
export const modelThroughputRouter = (db: Database) =>
  new Elysia().get("/api/model-throughput", ({ query, set }) => {
    const provider = typeof query.provider === "string" ? query.provider.trim() : "";
    const model = typeof query.model === "string" ? query.model.trim() : "";
    if (!provider || !model) {
      set.status = 400;
      return { error: "provider and model are required" };
    }
    const asked = typeof query.runs === "string" ? Number.parseInt(query.runs, 10) : Number.NaN;
    const runs = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_THROUGHPUT_RUNS) : DEFAULT_THROUGHPUT_RUNS;
    return modelThroughputOf(provider, model, getRecentLlmCalls(db, provider, model, runs));
  });
