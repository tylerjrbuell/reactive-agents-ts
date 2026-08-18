/**
 * Opt-in numeric evidence-grounding. Presence on KernelInput = enabled.
 *
 * Leaf module — extracted from kernel-state.ts so verifier.ts (which needs
 * this type) doesn't import the module that itself imports verifier.ts's
 * `Verifier` type.
 */
export interface GroundingConfig {
  /** block: suppress + corrective retry → degrade to warn. warn: advisory only. */
  readonly mode: "block" | "warn";
  /** Numeric match tolerance as a fraction (rounding). Default 0.01 (1%). */
  readonly tolerance?: number;
  /** block mode: corrective retries before degrading to warn. Default 1. */
  readonly maxRetries?: number;
}
