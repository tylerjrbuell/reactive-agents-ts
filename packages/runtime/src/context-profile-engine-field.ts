import type { ReactiveAgentsConfig } from "./types.js";

/**
 * The engine config's `contextProfile`, derived once so both runtime
 * constructors (`createRuntime`, `buildLightRuntimeConfig`) stay in lockstep.
 * Moved verbatim from the two identical inline blocks in runtime.ts (2026-11-06).
 */
export const contextProfileEngineField = (options: {
  readonly numCtx?: number;
  readonly contextProfile?: ReactiveAgentsConfig["contextProfile"];
}): ReactiveAgentsConfig["contextProfile"] =>
  // When a user sets `numCtx` (provider context window), keep the
  // reasoning-side window in lockstep: seed `contextProfile.maxTokens` so the
  // kernel packs/sends within the SAME budget the provider will accept.
  // Otherwise narrowing numCtx silently truncates (kernel still packs to the
  // 32K capability default) and widening underdelivers. An explicit
  // contextProfile.maxTokens from the caller still wins.
  options.numCtx !== undefined
    ? {
        ...options.contextProfile,
        maxTokens: options.contextProfile?.maxTokens ?? options.numCtx,
        // GH #241 producer: thread the user-declared window
        // (`.withModel({ numCtx })`) into the kernel guard's explicit rung
        // (`resolveEffectiveNumCtx()` = explicit ?? maxTokens). An explicit
        // caller value wins (spread writes nothing); invalid
        // (non-positive/non-finite) numCtx writes nothing so the consumer
        // falls back to maxTokens. The maxTokens precedence above is
        // byte-identical legacy behavior — out of scope, do not touch.
        ...(options.contextProfile?.explicitNumCtx !== undefined
          ? {}
          : Number.isFinite(options.numCtx) && options.numCtx > 0
            ? { explicitNumCtx: options.numCtx }
            : {}),
      }
    : options.contextProfile;
