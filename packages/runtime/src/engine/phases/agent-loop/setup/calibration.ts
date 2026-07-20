/**
 * Resolve `CalibrationMode` → `ModelCalibration | undefined` for the current
 * task run. Used once per run, before tool classification (because the
 * classifier consults `calibration.classifierReliability`).
 *
 * Resolution rules (preserved exactly from execution-engine.ts:1000-1024):
 * - `config.calibration === "skip"` or absent → undefined
 * - `config.calibration === "auto"` + `fetchCommunity !== false` → async
 *   community calibration with local-observation fallback on error
 * - `config.calibration === "auto"` + `fetchCommunity === false` → local
 *   observations only
 * - `config.calibration` is a `ModelCalibration` object → returned as-is
 *
 * **For sub-agents:** each child engine instance calls this with its own
 * model, so per-sub-agent calibration cascades work natively. A child using
 * qwen3:14b resolves `qwen3-14b.json`; a parent using Sonnet resolves the
 * Sonnet profile. No shared state.
 *
 * Extracted from `execution-engine.ts:1000-1024` (W23 step 4).
 */
import { Effect } from "effect";
import { resolveModelCalibration, resolveModelCalibrationAsync } from "../../../../calibration-resolver.js";
import type { ReactiveAgentsConfig } from "../../../../types.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";

export const resolveCalibration = (
  config: ReactiveAgentsConfig,
): Effect.Effect<ModelCalibration | undefined, never> =>
  Effect.gen(function* () {
    const cal = config.calibration;
    if (!cal || cal === "skip") return undefined;

    if (cal === "auto") {
      const fetchCommunity =
        (config.reactiveIntelligenceOptions as { communityCalibration?: boolean } | undefined)?.communityCalibration !== false;
      const modelId = String(config.defaultModel ?? "");
      const observationsBaseDir = process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"];

      if (fetchCommunity) {
        return yield* Effect.tryPromise(() =>
          resolveModelCalibrationAsync(modelId, {
            observationsBaseDir,
            fetchCommunity: true,
          }),
        ).pipe(
          Effect.catchAll(() =>
            Effect.succeed(
              resolveModelCalibration(modelId, { observationsBaseDir }),
            ),
          ),
        );
      }

      return resolveModelCalibration(modelId, { observationsBaseDir });
    }

    // Caller provided a fully-specified ModelCalibration object
    return cal as ModelCalibration;
  });
