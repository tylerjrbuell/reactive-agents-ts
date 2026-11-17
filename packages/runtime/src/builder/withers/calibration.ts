/**
 * `.withCalibration()` wither body and its opt-in tier options.
 *
 * The class method on the builder is a thin delegate; the public-contract
 * JSDoc lives here. The two opt-in tiers ride the existing
 * `reactiveIntelligenceOptions` channel (`learnedCalibration`,
 * `communityCalibration`), which `engine/phases/agent-loop/setup/calibration.ts`
 * reads when it resolves `calibration: "auto"`.
 */
import type { CalibrationMode } from '../../types.js'
import type { ReactiveIntelligenceConfig } from '@reactive-agents/reactive-intelligence'
import type { CalibrationTierFlags } from '../../calibration-resolver.js'
import type { BuilderState } from './_state.js'

/**
 * Opt-in calibration tiers for `.withCalibration("auto", options)`. Both are
 * off by default. They apply only to `"auto"`: `"skip"` resolves nothing and
 * a `ModelCalibration` object is used as given.
 *
 * Tiers resolve in order shipped (or framework defaults), then community, then
 * learned. `resolveModelCalibrationWithProvenance` reports which tier set each
 * field.
 */
export interface CalibrationOptions {
    /**
     * Let this machine's recorded run observations change the calibration.
     * Default `false`.
     *
     * Every run records an observation on disk under
     * `~/.reactive-agents/observations` (or `REACTIVE_AGENTS_OBSERVATIONS_DIR`),
     * whether or not this is on; nothing is uploaded. With `learned: true`,
     * once a model has `OVERRIDE_THRESHOLD` (5) recorded runs, the observed
     * behavior overrides the shipped `parallelCallCapability`,
     * `classifierReliability` and `actOrAnswer` (reactive-intelligence
     * `mergeObservationsIntoPrior`; last 50 runs kept per model). A model
     * with no shipped calibration then resolves to the framework defaults plus
     * what was learned. Enable it for models the framework ships no
     * calibration for: those otherwise run on generic defaults.
     */
    readonly learned?: boolean
    /**
     * Fetch the shared community profile for the model at run start. Default
     * `false`.
     *
     * Sends one GET request to the community profile endpoint with the model
     * id in the path (like every HTTP request, it also carries your IP
     * address). The response is cached on disk. The fields it declares
     * override the shipped calibration. `DO_NOT_TRACK=1` and
     * `REACTIVE_AGENTS_TELEMETRY=0` stop the request even when this is on.
     */
    readonly community?: boolean
}

/**
 * Configure per-model calibration for this agent.
 *
 * - `"skip"`: no lookup, pure tier-based adapters. Honored even when
 *   reasoning is enabled (P0-9).
 * - `"auto"`: resolve the shipped calibration for the model id. The
 *   community and learned tiers join only when opted in via `options`.
 * - `ModelCalibration` object: use it directly (e.g. from the calibration
 *   probe suite); `options` are ignored.
 *
 * Default when unset: `"auto"` if reasoning is active, otherwise none; both
 * opt-in tiers stay off.
 *
 * @param state - Builder state to mutate.
 * @param mode - Calibration mode.
 * @param options - Opt-in tiers (`learned`, `community`), both default off.
 *
 * @example
 * ```typescript
 * .withCalibration("auto", { learned: true, community: true })
 * ```
 */
export const applyWithCalibration = (
    state: BuilderState,
    mode: CalibrationMode,
    options?: CalibrationOptions,
): void => {
    state._calibration = mode
    state._calibrationOptions = options
}

/**
 * Fold the `.withCalibration()` opt-in tiers into the run's
 * `reactiveIntelligenceOptions` (the channel the engine's calibration setup
 * reads). Returns the input unchanged when no tier was set, so the default
 * config stays byte-identical. An explicit tier option overrides a
 * `communityCalibration` key set via `.withReactiveIntelligence()`.
 *
 * @param riOptions - The resolved reactive-intelligence options.
 * @param options - The `.withCalibration()` tier options, if any.
 * @returns The options with `learnedCalibration`/`communityCalibration` set.
 */
export const withCalibrationTiers = (
    riOptions: Partial<ReactiveIntelligenceConfig> | undefined,
    options: CalibrationOptions | undefined,
): (Partial<ReactiveIntelligenceConfig> & CalibrationTierFlags) | undefined => {
    if (options?.learned === undefined && options?.community === undefined) return riOptions
    return {
        ...riOptions,
        ...(options.learned !== undefined ? { learnedCalibration: options.learned } : {}),
        ...(options.community !== undefined ? { communityCalibration: options.community } : {}),
    }
}
