import { earlyStopHandler } from "./early-stop.js"
import { tempAdjustHandler } from "./temp-adjust.js"
import { switchStrategyHandler } from "./switch-strategy.js"
import { contextCompressHandler } from "./context-compress.js"
import { toolInjectHandler } from "./tool-inject.js"
import { skillActivateHandler } from "./skill-activate.js"
import type { InterventionHandler } from "../intervention.js"

export const defaultInterventionRegistry: readonly InterventionHandler[] = [
  earlyStopHandler,
  tempAdjustHandler,
  switchStrategyHandler,
  contextCompressHandler,
  toolInjectHandler,
  skillActivateHandler,
]

export { earlyStopHandler, tempAdjustHandler, switchStrategyHandler, contextCompressHandler, toolInjectHandler, skillActivateHandler }
