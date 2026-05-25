import { earlyStopHandler } from "./early-stop.js";
import { tempAdjustHandler } from "./temp-adjust.js";
import { switchStrategyHandler } from "./switch-strategy.js";
import { contextCompressHandler } from "./context-compress.js";
import { toolInjectHandler } from "./tool-inject.js";
import { skillActivateHandler } from "./skill-activate.js";
import { toolFailureRedirectHandler } from "./tool-failure-redirect.js";
import { stallDetectorHandler } from "./stall-detector.js";
import { harnessHarmDetectorHandler } from "./harness-harm-detector.js";
import { asInterventionHandler, type InterventionHandler } from "../intervention.js";

export const defaultInterventionRegistry: readonly InterventionHandler[] = [
  asInterventionHandler(earlyStopHandler),
  asInterventionHandler(tempAdjustHandler),
  asInterventionHandler(switchStrategyHandler),
  asInterventionHandler(contextCompressHandler),
  asInterventionHandler(toolInjectHandler),
  asInterventionHandler(skillActivateHandler),
  asInterventionHandler(toolFailureRedirectHandler),
  asInterventionHandler(stallDetectorHandler),
  asInterventionHandler(harnessHarmDetectorHandler),
];

export { earlyStopHandler, tempAdjustHandler, switchStrategyHandler, contextCompressHandler, toolInjectHandler, skillActivateHandler, toolFailureRedirectHandler, stallDetectorHandler, harnessHarmDetectorHandler };
