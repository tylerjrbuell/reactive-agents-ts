import type { ControllerDecision, ControllerEvalParams } from "../types.js";

/**
 * Evaluate whether context compression should be triggered based on context pressure.
 * Fires when contextPressure exceeds the configured threshold (default 0.80).
 * The actual compression work happens in the kernel runner when it processes this decision.
 */
export function evaluateCompression(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "compress" }) | null {
  const threshold = params.config.compressionThreshold ?? 0.80;

  if (params.contextPressure <= threshold) return null;

  return {
    decision: "compress",
    sections: ["tool-results", "history"],
    estimatedSavings: Math.round((params.contextPressure - threshold) * 1000),
  };
}
