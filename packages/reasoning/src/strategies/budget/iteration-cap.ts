// File: src/strategies/budget/iteration-cap.ts
/**
 * The ONE iteration-cap resolver every strategy that runs kernel passes uses.
 *
 * A strategy never reads `config.strategies.reactive.maxIterations` or a tier
 * table directly. It calls {@link resolveMaxIterationCap} (or the config
 * wrapper {@link resolveStrategyIterationCap}), so the user's declared cap wins
 * everywhere and a tier/strategy default applies only when the user set none.
 * Before this, tree-of-thought hardcoded tier caps (6/8/10/12) and ignored a
 * configured `maxIterations` ("16 steps" in the UI, stopped after 7).
 * `tests/strategies/iteration-cap-registry.test.ts` fails for any registered
 * strategy that bypasses it.
 *
 * Pure functions, no services.
 */
import type { ReasoningConfig } from "../../types/config.js";

/** Inputs to {@link resolveMaxIterationCap}: the cap sources a strategy sees. */
export interface MaxIterationCapSources {
  /**
   * `config.strategies.reactive.maxIterations` — builder-baked cap. Without
   * {@link MaxIterationCapSources.explicit} this may just be the schema
   * fallback (10), NOT a user decision.
   */
  readonly configCap: number | undefined;
  /** `contextProfile?.maxIterations` — tier-default hint (8 local / 10 mid / 10 large / 12 frontier). */
  readonly tierHint: number | undefined;
  /** True when `configCap` was user-declared via `.withMaxIterations()` / `.withReasoning({ maxIterations })`. */
  readonly explicit: boolean | undefined;
  /**
   * True when the run resumes a prior kernel state (`input.resumeState`). The
   * runtime then sends the per-run RESUME cap (spent iterations + a fresh
   * allowance) as `contextProfile.maxIterations`; see rule 0 below.
   */
  readonly resumed?: boolean;
  /**
   * The strategy's own default cap (for example tree-of-thought's tier table).
   * Used ONLY when the user declared no cap and the run is not a resume. When
   * absent, the most-restrictive min(tier hint, config) rule applies.
   */
  readonly strategyDefault?: number;
}

/** Result of {@link resolveMaxIterationCap}. */
export interface MaxIterationCapResolution {
  /** The effective per-run iteration cap handed to the kernel. */
  readonly maxIterations: number;
  /** True when the tier hint clamped the effective cap below the config face value. */
  readonly clamped: boolean;
}

/** The profileless fallback — matches `defaultReasoningConfig.strategies.reactive.maxIterations`. */
const MAX_ITERATIONS_FALLBACK = 10;

const positiveOrUndefined = (n: number | undefined): number | undefined =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;

/**
 * Resolve the effective iteration cap.
 *
 * Precedence (rule 0 added 2026-11-17, Cortex Continue):
 *   0. On a RESUME (`resumed: true`) the `tierHint` slot carries the runtime's
 *      per-run cap (`run-resume.ts` / `loop-stop-resume.ts`: spent iterations
 *      plus the caller's `extraIterations`, or the run's own cap) and wins
 *      OUTRIGHT, above or below an explicit cap. 2026-11-18: it used to win
 *      only when higher, so an explicit 12 beat an `extraIterations: 1` bound.
 *      Non-resumed runs skip it.
 *
 * Then (2026-10-23 explicit-cap fix, introspective harness loop —
 * wiki/Research/Harness-Reports/introspective-2026-10-24-02-*):
 *   1. An EXPLICIT user cap (`maxIterationsExplicit: true`) ALWAYS wins — the
 *      tier hint cannot steal it down. Pre-fix, `Math.min(hint, configCap)`
 *      indistinguishably treated the baked schema default 10 as a user cap,
 *      silently truncating explicit 10/12/20 runs to the local-tier 8.
 *   2. Nothing explicit and the strategy supplied a `strategyDefault`: that
 *      default applies (the user declared nothing to override it).
 *   3. Otherwise the old most-restrictive min() semantics apply unchanged
 *      (tier hint clamps the config face value).
 *   4. Profileless paths keep the fallback default 10.
 *
 * `clamped` reports case 3 actually lowering the cap below the config face
 * value so the caller can surface the steal as a visible structured signal.
 */
export function resolveMaxIterationCap(
  sources: MaxIterationCapSources,
): MaxIterationCapResolution {
  const configCap = positiveOrUndefined(sources.configCap);
  const tierHint = positiveOrUndefined(sources.tierHint);
  const strategyDefault = positiveOrUndefined(sources.strategyDefault);

  // (0) Resume cap: the runtime's per-run cap wins outright, above or below.
  if (sources.resumed === true && tierHint !== undefined) {
    return { maxIterations: tierHint, clamped: false };
  }

  // (1) Explicit user cap always wins — no min with the tier hint.
  if (sources.explicit === true && configCap !== undefined) {
    return { maxIterations: configCap, clamped: false };
  }

  // (2) The strategy's own default, when the user declared nothing.
  if (strategyDefault !== undefined) {
    return { maxIterations: strategyDefault, clamped: false };
  }

  // (3)/(4) Non-explicit path — byte-identical min() semantics for unset caps.
  const candidates = [tierHint, configCap].filter((n): n is number => n !== undefined);
  const maxIterations =
    candidates.length > 0 ? Math.min(...candidates) : MAX_ITERATIONS_FALLBACK;
  const faceValue = configCap ?? MAX_ITERATIONS_FALLBACK;
  const clamped =
    tierHint !== undefined && maxIterations === tierHint && tierHint < faceValue;
  return { maxIterations, clamped };
}

/**
 * {@link resolveMaxIterationCap} fed from a run's `ReasoningConfig`: the entry
 * point for strategies that do not read a context profile themselves.
 *
 * @param config The run's reasoning config (the canonical store for the cap).
 * @param options `strategyDefault`: the strategy's own default (applies only
 *   when the user declared no cap). `tierHint` / `resumed`: as on
 *   {@link MaxIterationCapSources}.
 * @returns The effective cap; an explicit user cap always wins.
 */
export function resolveStrategyIterationCap(
  config: ReasoningConfig,
  options: {
    readonly strategyDefault?: number;
    readonly tierHint?: number;
    readonly resumed?: boolean;
  } = {},
): number {
  return resolveMaxIterationCap({
    configCap: config.strategies.reactive.maxIterations,
    explicit: config.strategies.reactive.maxIterationsExplicit,
    tierHint: options.tierHint,
    resumed: options.resumed,
    strategyDefault: options.strategyDefault,
  }).maxIterations;
}
