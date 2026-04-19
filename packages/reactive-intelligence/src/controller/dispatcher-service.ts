import { Context, Layer } from "effect"
import type { InterventionConfig } from "./intervention.js"
import { defaultInterventionConfig } from "./intervention.js"
import { makeDispatcher, registerHandler } from "./dispatcher.js"
import { defaultInterventionRegistry } from "./handlers/index.js"
import type { Dispatcher } from "./dispatcher.js"

/**
 * Effect service tag for the intervention dispatcher.
 *
 * The tag string "InterventionDispatcherService" is mirrored as a GenericTag
 * in @reactive-agents/reasoning/service-utils.ts to avoid a cross-package import.
 * Both sides must use the exact same string.
 */
export class InterventionDispatcherService extends Context.Tag("InterventionDispatcherService")<
  InterventionDispatcherService,
  Dispatcher
>() {}

/**
 * Live Layer for the intervention dispatcher.
 *
 * Creates the dispatcher once (not per-iteration), registers all default handlers,
 * and provides the instance via the Effect service context.
 *
 * @param config  Optional override for intervention modes and suppression gates.
 *                Defaults to `defaultInterventionConfig` (early-stop: dispatch, rest: advisory).
 */
export const InterventionDispatcherServiceLive = (
  config?: Partial<InterventionConfig>,
): Layer.Layer<InterventionDispatcherService> => {
  const merged: InterventionConfig = {
    modes: { ...defaultInterventionConfig.modes, ...config?.modes },
    suppression: { ...defaultInterventionConfig.suppression, ...config?.suppression },
  }

  const dispatcher = makeDispatcher(merged)
  for (const handler of defaultInterventionRegistry) {
    registerHandler(dispatcher, handler)
  }

  return Layer.succeed(InterventionDispatcherService, dispatcher)
}
