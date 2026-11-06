import { earlyStopHandler } from "./early-stop.js";
import { switchStrategyHandler } from "./switch-strategy.js";
import { toolFailureRedirectHandler } from "./tool-failure-redirect.js";
import { asInterventionHandler, type InterventionHandler } from "../intervention.js";

// RI controller census 2026-11-06 (wiki/Research/Harness-Reports/2026-11-06-ri-controller-census.md):
// only these three handlers change runs. temp-adjust (inert), compress
// (unreachable), skill-activate (no input), tool-inject and stall-detect
// (never pass thresholds) and harness-harm (no producer) were deleted.
export const defaultInterventionRegistry: readonly InterventionHandler[] = [
  asInterventionHandler(earlyStopHandler),
  asInterventionHandler(switchStrategyHandler),
  asInterventionHandler(toolFailureRedirectHandler),
];

export { earlyStopHandler, switchStrategyHandler, toolFailureRedirectHandler };
