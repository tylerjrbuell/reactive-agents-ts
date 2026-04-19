import { earlyStopHandler } from "./early-stop.js"
import type { InterventionHandler } from "../intervention.js"

export const defaultInterventionRegistry: readonly InterventionHandler[] = [
  earlyStopHandler,
]

export { earlyStopHandler }
