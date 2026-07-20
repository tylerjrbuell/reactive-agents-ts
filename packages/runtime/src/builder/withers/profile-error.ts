/**
 * Profile + error-handler wither-body extractions
 * (WS-6 Phase 1 — profile/error bucket).
 *
 * Hosts:
 *   - `.withProfile(patch)` — apply a `HarnessProfilePatch` composition
 *     preset (MOVE-6). Multi-branch field flipping with lean-mode
 *     side-effects (sets `_leanHarness` when verifier or strategy-switch
 *     are explicitly disabled).
 *   - `.withErrorHandler(fn)` — store the handler AND return a harness
 *     registration callback (mirrors `applyHookRegistration`'s shape so the
 *     caller can chain `.withHarness(...)`).
 */
import type { ReactiveAgentBuilder } from "../../builder.js";
import type { HarnessProfilePatch } from "../../capabilities/profile.js";
import type { RuntimeErrors } from "../../errors.js";
import { asBuilderState } from "./_state.js";

/**
 * Apply `.withProfile(profile)` — composition preset. Patch fields are
 * applied additively; `undefined` means "no change", boolean values
 * explicitly set the corresponding capability. Lean is implied when either
 * `enableVerifier=false` or `enableStrategySwitching=false` — runtime.ts
 * gates on the resulting `_leanHarness` flag.
 */
export const applyWithProfile = (
  builder: ReactiveAgentBuilder,
  profile: HarnessProfilePatch,
): void => {
  const s = asBuilderState(builder);
  if (
    profile.enableVerifier === false ||
    profile.enableStrategySwitching === false
  ) {
    s._leanHarness = true;
  }
  if (profile.enableMemory === false) {
    s._enableMemory = false;
  } else if (profile.enableMemory === true) {
    s._enableMemory = true;
  }
  if (profile.enableReactiveIntelligence === false) {
    s._enableReactiveIntelligence = false;
  } else if (profile.enableReactiveIntelligence === true) {
    s._enableReactiveIntelligence = true;
  }
  if (profile.enableSkillPersistence === false) {
    s._skillPersistence = false;
  } else if (profile.enableSkillPersistence === true) {
    s._skillPersistence = true;
  }
};

/**
 * Apply `.withErrorHandler(handler)` — store the handler AND return a
 * harness registration callback that wires `h.onError('*', ...)` for the
 * Wave D+ error-handling pipeline. The caller passes the returned callback
 * into `.withHarness(...)` to preserve the chaining contract.
 */
export const applyWithErrorHandler = (
  builder: ReactiveAgentBuilder,
  handler: (
    error: RuntimeErrors | Error,
    context: {
      taskId: string;
      phase: string;
      iteration: number;
      lastStep?: string;
    },
  ) => void,
): ((h: import("@reactive-agents/core").Harness) => void) => {
  asBuilderState(builder)._errorHandler = handler;
  return (h) => {
    h.onError("*", (err, ctx) => {
      handler(err as RuntimeErrors | Error, {
        taskId: "",
        phase: ctx.phase as string,
        iteration: ctx.iteration,
      });
    });
  };
};

