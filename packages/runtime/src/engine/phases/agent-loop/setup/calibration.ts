/**
 * Resolve `CalibrationMode` → `ModelCalibration | undefined` for the current
 * task run. Used once per run, before tool classification (because the
 * classifier consults `calibration.classifierReliability`).
 *
 * Resolution rules (preserved exactly from execution-engine.ts:1000-1024):
 * - `config.calibration === "skip"` or absent → undefined
 * - `config.calibration === "auto"` → the shipped calibration. Two tiers are
 *   opt-in (default off), read from `reactiveIntelligenceOptions`:
 *   - `communityCalibration === true` → async community profile fetch, with
 *     the sync path as fallback on error. The environment telemetry opt-out
 *     (`DO_NOT_TRACK`, `REACTIVE_AGENTS_TELEMETRY=0`) still blocks the request.
 *   - `learnedCalibration === true` → local run observations may override
 *     fields. Off: observations are recorded but never applied.
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
import {
  resolveModelCalibration,
  resolveModelCalibrationAsync,
  type CalibrationTierFlags,
} from "../../../../calibration-resolver.js";
import type { ReactiveAgentsConfig } from "../../../../types.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { telemetryOptedOut } from "@reactive-agents/reactive-intelligence";
export const resolveCalibration = (
  config: Pick<ReactiveAgentsConfig, "calibration" | "provider" | "defaultModel" | "reactiveIntelligenceOptions">,
): Effect.Effect<ModelCalibration | undefined, never> =>
  Effect.gen(function* () {
    const cal = config.calibration;
    if (!cal || cal === "skip") return undefined;

    if (cal === "auto") {
      // Both extra tiers are opt-in (`.withCalibration("auto", { learned, community })`,
      // folded into these flags by builder/withers/calibration.ts).
      const tiers = config.reactiveIntelligenceOptions as CalibrationTierFlags | undefined;
      // The environment telemetry opt-out (DO_NOT_TRACK, REACTIVE_AGENTS_TELEMETRY=0)
      // also stops the community profile request: no outbound framework call.
      const fetchCommunity = tiers?.communityCalibration === true && !telemetryOptedOut();
      const modelId = String(config.defaultModel ?? "");
      const observationsBaseDir = process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"];
      // The scripted test provider never learns from the user's real
      // ~/.reactive-agents/observations: only an explicit observations dir
      // applies to it. Observations are still recorded when this is off.
      const localObservations =
        tiers?.learnedCalibration === true && (config.provider !== "test" || observationsBaseDir !== undefined);

      if (fetchCommunity) {
        return yield* Effect.tryPromise(() =>
          resolveModelCalibrationAsync(modelId, {
            observationsBaseDir,
            localObservations,
            fetchCommunity: true,
          }),
        ).pipe(
          Effect.catchAll(() =>
            Effect.succeed(
              resolveModelCalibration(modelId, { observationsBaseDir, localObservations }),
            ),
          ),
        );
      }

      return resolveModelCalibration(modelId, { observationsBaseDir, localObservations });
    }

    // Caller provided a fully-specified ModelCalibration object
    return cal as ModelCalibration;
  });
