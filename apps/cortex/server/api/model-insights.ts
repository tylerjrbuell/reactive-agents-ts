import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { getRecentLlmCalls, getRecentRunOutcomes } from "../db/model-throughput-queries.js";
import { modelCostOf } from "../services/model-cost.js";
import { makeModelCalibrationReader, type ModelCalibrationReader } from "../services/model-calibration.js";

/** Recent runs read for the spend figures when the caller does not say. */
export const DEFAULT_COST_RUNS = 50;
const MAX_COST_RUNS = 500;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Model page calibration and spend (roadmap C13). A query parameter carries the
 * model because model ids can contain `/`.
 *
 * - `GET /api/model-calibration?model=`: the framework's calibration for the
 *   model, each setting's source, the local observations behind it and the
 *   entropy thresholds (`services/model-calibration.ts`). Read only.
 * - `GET /api/model-cost?provider=&model=&runs=`: tokens and framework-priced
 *   spend over the model's recent runs, and spend per successful run
 *   (`services/model-cost.ts`).
 */
export const modelInsightsRouter = (db: Database, calibration: ModelCalibrationReader = makeModelCalibrationReader()) =>
  new Elysia()
    .get("/api/model-calibration", ({ query, set }) => {
      const model = text(query.model);
      if (!model) {
        set.status = 400;
        return { error: "model is required" };
      }
      return calibration.read(model);
    })
    .get("/api/model-cost", ({ query, set }) => {
      const provider = text(query.provider);
      const model = text(query.model);
      if (!provider || !model) {
        set.status = 400;
        return { error: "provider and model are required" };
      }
      const asked = typeof query.runs === "string" ? Number.parseInt(query.runs, 10) : Number.NaN;
      const runs = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_COST_RUNS) : DEFAULT_COST_RUNS;
      return modelCostOf(
        provider,
        model,
        getRecentLlmCalls(db, provider, model, runs),
        getRecentRunOutcomes(db, provider, model, runs),
      );
    });
