import type { ObservabilityOptions } from "./builder/types.js";

/**
 * The observability-derived fields of the engine config, derived once so both
 * runtime constructors (`createRuntime`, `createLightRuntime`) stay in lockstep.
 * `checklistDisplay` is display-only and never reaches the kernel.
 */
export const observabilityEngineFields = (o: ObservabilityOptions | undefined) => ({
  observabilityVerbosity: o?.verbosity,
  logModelIO: o?.logModelIO,
  logPrefix: o?.logPrefix,
  checklistDisplay: o?.checklist,
});
