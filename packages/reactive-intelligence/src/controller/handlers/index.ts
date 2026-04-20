import { earlyStopHandler } from "./early-stop.js"
import { tempAdjustHandler } from "./temp-adjust.js"
import { switchStrategyHandler } from "./switch-strategy.js"
import { contextCompressHandler } from "./context-compress.js"
import { toolInjectHandler } from "./tool-inject.js"
import { skillActivateHandler } from "./skill-activate.js"
import { toolFailureRedirectHandler } from "./tool-failure-redirect.js"
import type { InterventionHandler } from "../intervention.js"

// Type cast required: TypeScript's contravariant function params prevent
// InterventionHandler<"specific"> from assigning to InterventionHandler<fullUnion>.
// Runtime dispatch is safe — handlers are keyed and retrieved by `type` string.
export const defaultInterventionRegistry: readonly InterventionHandler[] = [
  earlyStopHandler as unknown as InterventionHandler,
  tempAdjustHandler as unknown as InterventionHandler,
  switchStrategyHandler as unknown as InterventionHandler,
  contextCompressHandler as unknown as InterventionHandler,
  toolInjectHandler as unknown as InterventionHandler,
  skillActivateHandler as unknown as InterventionHandler,
  toolFailureRedirectHandler as unknown as InterventionHandler,
]

export { earlyStopHandler, tempAdjustHandler, switchStrategyHandler, contextCompressHandler, toolInjectHandler, skillActivateHandler, toolFailureRedirectHandler }
